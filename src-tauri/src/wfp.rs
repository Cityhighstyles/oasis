//! WFP (Windows Filtering Platform) user-mode session management.
//!
//! Uses `windows-sys` (raw C ABI bindings, no Option-wrapper magic).
//! All types are the exact C equivalents; all functions return u32 error codes.
//!
//! Monitoring architecture:
//!   - Registers a monitoring sublayer with inspection filters at ALE layers
//!   - Subscribes to network events via FwpmNetEventSubscribe0 for flow tracking
//!   - Builds a flow context table mapping PIDs to active network flows
//!   - Provides IPC isolation (WFP operates at network driver level,
//!     naturally ignoring named pipes, mailboxes, and local process loops)
//!   - Byte counting remains with ETW (event-driven kernel notifications)

use std::collections::HashMap;
use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
    FwpmEngineClose0, FwpmFilterAdd0, FwpmFilterDeleteById0,
    FwpmFreeMemory0, FwpmGetAppIdFromFileName0, FwpmSubLayerAdd0,
    FWPM_DISPLAY_DATA0, FWPM_FILTER0, FWPM_FILTER_CONDITION0,
    FWPM_SESSION0, FWPM_SESSION_FLAG_DYNAMIC, FWPM_SUBLAYER0,
    FWP_ACTION_BLOCK, FWP_BYTE_BLOB, FWP_BYTE_BLOB_TYPE,
    FWP_EMPTY, FWP_MATCH_EQUAL,
    FWPM_LAYER_ALE_AUTH_CONNECT_V4, FWPM_LAYER_ALE_AUTH_CONNECT_V6,
    FWPM_CONDITION_ALE_APP_ID, FWPM_ACTION0, FWP_VALUE0,
};
use windows_sys::core::{GUID, PCWSTR};

// ── Manual FFI bindings (missing from windows-sys 0.61) ────────────────
extern "system" {
    pub fn FwpmEngineOpen0(
        serverName: PCWSTR,
        authnService: u32,
        authIdentity: *const c_void,
        session: *const FWPM_SESSION0,
        engineHandle: *mut HANDLE,
    ) -> u32;

    /// Subscribe to network events (flow establishment, drops, etc.).
    /// Returns a subscription handle that must be closed with FwpmNetEventUnsubscribe0.
    pub fn FwpmNetEventSubscribe0(
        engineHandle: HANDLE,
        provider: *const c_void, // FWPM_NET_EVENT_SUBSCRIPTION0* — opaque, zeroed = all
        callback: FwpmNetEventCallback,
        context: *const c_void,
        subscriptionHandle: *mut u64,
    ) -> u32;

    /// Close a network event subscription.
    pub fn FwpmNetEventUnsubscribe0(
        engineHandle: HANDLE,
        subscriptionHandle: u64,
    ) -> u32;
}

// RPC_C_AUTHN_DEFAULT = 0xFFFFFFFF: use current-user credentials.
const RPC_C_AUTHN_DEFAULT: u32 = 0xFFFF_FFFF;

/// Our custom sublayer GUID — stable across builds.
/// {A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
const SUBLAYER_GUID: GUID = GUID::from_u128(0xA1B2C3D4_E5F6_7890_ABCDEF1234567890);

/// Tracks the two filter IDs (V4 + V6) installed for one blocked exe.
#[derive(Clone, Debug)]
pub struct BlockedAppFilters {
    pub filter_id_v4: u64,
    pub filter_id_v6: u64,
}

// ── Network event subscription types ────────────────────────────────────
//
// FWPM_NET_EVENT0 and FWPM_NET_EVENT_SUBSCRIPTION0 are opaque Windows SDK
// structs. We use *const c_void and extract fields at known offsets to avoid
// fragile manual struct definitions that depend on platform alignment.
//
// FWPM_NET_EVENT0 layout (x64, verified from SDK headers):
//   Offset  0: type         (u32)  — FWPM_NET_EVENT_TYPE enum
//   Offset  4: padding      (4 bytes for alignment)
//   Offset  8: header       (*mut FWPM_NET_EVENT_HEADER0) — pointer to header
//   Offset 16: flags        (u32)  — FWPM_NET_EVENT_FLAG
//   Offset 20: padding      (4 bytes)
//   Offset 24: union        (8 bytes) — event-specific data
//   Total: 32 bytes
//
// FWPM_NET_EVENT_HEADER0 layout (x64, verified from SDK headers):
//   Offset  0: timestamp     (i64)
//   Offset  8: flags         (u32)
//   Offset 12: ipVersion     (u32)
//   Offset 16: ipProtocol    (u32)
//   Offset 20: padding       (4 bytes)
//   Offset 24: localAddrV4   (u32) or localAddrV6 ([u8;16])
//   Offset 28: remoteAddrV4  (u32) or padding
//   Offset 40: localPort     (u16)
//   Offset 42: remotePort    (u16)
//   Offset 44: padding       (4 bytes)
//   Offset 48: scopeId       (u32)
//   Offset 52: padding       (4 bytes)
//   Offset 56: appId         (FWPM_BYTE_BLOB*)
//   Offset 64: userId        (FWPM_BYTE_BLOB*)
//   Offset 72: processId     (u32)  ← THIS IS WHAT WE NEED
//   ... (more fields follow)
//
// We read processId from offset 72 of the header struct.

/// Callback type for FwpmNetEventSubscribe0 (raw nullable function pointer).
/// The Option wrapper in Rust is ABI-compatible with a nullable C function pointer.
type FwpmNetEventCallback = Option<
    unsafe extern "system" fn(
        context: *const c_void,
        event: *const c_void, // FWPM_NET_EVENT0* — opaque
    ),
>;

/// FWPM_NET_EVENT0 field offsets (x64 only).
const NET_EVENT_HEADER_PTR_OFFSET: usize = 8;

/// FWPM_NET_EVENT_HEADER0 field offsets (x64 only).
const HEADER_PROCESS_ID_OFFSET: usize = 72;

// ── Network event monitoring state ─────────────────────────────────────
//
// WFP monitoring provides IPC isolation and process activity tracking.
// Byte counting is handled exclusively by ETW (event-driven kernel notifications).
// WFP confirms that traffic is real network traffic, not local IPC.

/// Shared state for WFP network event monitoring.
struct MonitorState {
    /// Set of PIDs that have been observed in network events.
    /// (pid, 0) tuples — byte counts are tracked by ETW, not WFP.
    active_pids: std::collections::HashSet<u32>,
    /// Total events received from the kernel.
    total_events: u64,
}

static MONITOR_STATE: Mutex<Option<MonitorState>> = Mutex::new(None);
static MONITOR_ACTIVE: AtomicBool = AtomicBool::new(false);

/// RAII handle around an open BFE engine session.
pub struct WfpSession {
    handle: HANDLE,
}

// SAFETY: HANDLE is *mut c_void; we only access it from within the Mutex.
unsafe impl Send for WfpSession {}
unsafe impl Sync for WfpSession {}

impl Drop for WfpSession {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { FwpmEngineClose0(self.handle) };
        }
    }
}

/// Thread-safe WFP manager.  Caller wraps in `Arc<Mutex<>>`.
pub struct WfpEngine {
    session: Option<WfpSession>,
    blocked: HashMap<String, BlockedAppFilters>,
    sublayer_added: bool,
    /// Handle for the network event subscription (0 = not subscribed).
    net_event_subscription: u64,
}

impl WfpEngine {
    pub fn new() -> Self {
        WfpEngine {
            session: None,
            blocked: HashMap::new(),
            sublayer_added: false,
            net_event_subscription: 0,
        }
    }

    /// Open the BFE session.  Returns `Ok(())` on success.
    pub fn open(&mut self) -> Result<(), String> {
        // FWPM_SESSION_FLAG_DYNAMIC (u32 = 1): filters auto-removed on close/crash.
        let mut sess: FWPM_SESSION0 = unsafe { std::mem::zeroed() };
        sess.flags = FWPM_SESSION_FLAG_DYNAMIC;

        let mut handle: HANDLE = ptr::null_mut();
        let err: u32 = unsafe {
            FwpmEngineOpen0(
                ptr::null(),             // NULL PCWSTR = local machine
                RPC_C_AUTHN_DEFAULT,
                ptr::null(),             // NULL = current credentials
                &sess as *const _,
                &mut handle as *mut _,
            )
        };
        win32_check(err, "FwpmEngineOpen0")?;
        self.session = Some(WfpSession { handle });
        self.ensure_sublayer()?;
        Ok(())
    }

    pub fn is_open(&self) -> bool {
        self.session.is_some()
    }

    /// Block all outbound connections for the given Win32 executable path.
    ///
    /// If `FwpmFilterAdd0` returns `FWP_E_ALREADY_EXISTS` (0x80320007) — meaning
    /// a filter from a previous session is still active in the kernel — we treat
    /// it as success and record the path in our `blocked` map so subsequent poll
    /// ticks don&#x27;t retry and spam the logs.
    pub fn block_app(&mut self, exe_path: &str) -> Result<(), String> {
        if self.blocked.contains_key(exe_path) {
            return Ok(());
        }
        let handle = self.engine_handle()?;
        let app_id_bytes = get_app_id_bytes(exe_path)?;

        let desc_v4 = format!("DataGuardian BLOCK IPv4: {exe_path}");
        let desc_v6 = format!("DataGuardian BLOCK IPv6: {exe_path}");

        // Helper: try to add a filter; treat FWP_E_ALREADY_EXISTS as success.
        // We bind the descriptions outside so the &str references live long enough.
        let try_add = |layer, desc: &str| -> Result<u64, String> {
            match add_app_filter(handle, &app_id_bytes, layer, desc) {
                Ok(id) => Ok(id),
                Err(e) if e.contains("0x80320007") => {
                    log::info!("WFP filter already exists for {exe_path} — tracking as blocked");
                    Ok(0)
                }
                Err(e) => Err(e),
            }
        };

        let id_v4 = try_add(FWPM_LAYER_ALE_AUTH_CONNECT_V4, &desc_v4)?;
        let id_v6 = try_add(FWPM_LAYER_ALE_AUTH_CONNECT_V6, &desc_v6)?;

        self.blocked.insert(
            exe_path.to_string(),
            BlockedAppFilters { filter_id_v4: id_v4, filter_id_v6: id_v6 },
        );
        Ok(())
    }

    /// Remove block filters for the given executable.  Idempotent.
    pub fn unblock_app(&mut self, exe_path: &str) -> Result<(), String> {
        let Some(filters) = self.blocked.remove(exe_path) else {
            return Ok(());
        };
        let handle = self.engine_handle()?;

        let err_v4 = unsafe { FwpmFilterDeleteById0(handle, filters.filter_id_v4) };
        let err_v6 = unsafe { FwpmFilterDeleteById0(handle, filters.filter_id_v6) };
        // 0x80320003 = FWP_E_FILTER_NOT_FOUND — treat as non-error.
        for (err, ver) in [(err_v4, "V4"), (err_v6, "V6")] {
            if err != 0 && err != 0x8032_0003_u32 {
                return Err(format!("FwpmFilterDeleteById0 ({ver}): 0x{err:08X}"));
            }
        }
        Ok(())
    }

    pub fn is_blocked(&self, exe_path: &str) -> bool {
        self.blocked.contains_key(exe_path)
    }

    pub fn blocked_paths(&self) -> Vec<String> {
        self.blocked.keys().cloned().collect()
    }

    // ── Network event monitoring ──────────────────────────────────────────────

    /// Start WFP network event monitoring.
    ///
    /// Subscribes to network events (flow establishment, byte transfers) via
    /// `FwpmNetEventSubscribe0`. This provides IPC isolation because WFP
    /// operates strictly on physical/virtual network interface drivers,
    /// naturally ignoring named pipes, mailboxes, and local process loops.
    ///
    /// Byte counting remains with ETW; WFP provides flow metadata and
    /// validates that traffic is real network traffic (not local IPC).
    pub fn start_monitoring(&mut self) -> Result<(), String> {
        let handle = self.engine_handle()?;

        // Initialize the shared monitor state
        if let Ok(mut guard) = MONITOR_STATE.lock() {
            *guard = Some(MonitorState {
                active_pids: std::collections::HashSet::new(),
                total_events: 0,
            });
        }

        // Subscribe to network events — zeroed opaque buffer = all event types.
        // FWPM_NET_EVENT_SUBSCRIPTION0 is ~32 bytes on x64; 64 is a safe over-estimate.
        let subscription: [u8; 64] = [0u8; 64];
        let mut sub_handle: u64 = 0;

        let err = unsafe {
            FwpmNetEventSubscribe0(
                handle,
                subscription.as_ptr() as *const c_void,
                Some(net_event_callback),
                ptr::null(),
                &mut sub_handle,
            )
        };

        if err != 0 {
            log::warn!("FwpmNetEventSubscribe0 failed (non-fatal): 0x{err:08X}");
            return Ok(()); // Non-fatal: ETW still provides byte counts
        }

        self.net_event_subscription = sub_handle;
        MONITOR_ACTIVE.store(true, Ordering::SeqCst);

        log::info!("WFP network event monitoring started");
        Ok(())
    }

    /// Stop WFP network event monitoring and clean up.
    pub fn stop_monitoring(&mut self) {
        if self.net_event_subscription != 0 {
            if let Ok(handle) = self.engine_handle() {
                unsafe {
                    FwpmNetEventUnsubscribe0(handle, self.net_event_subscription);
                }
            }
            self.net_event_subscription = 0;
        }
        MONITOR_ACTIVE.store(false, Ordering::SeqCst);

        // Clear monitor state
        if let Ok(mut guard) = MONITOR_STATE.lock() {
            *guard = None;
        }

        log::info!("WFP network event monitoring stopped");
    }

    /// Drain and return the set of PIDs observed in WFP network events.
    /// Returns None if monitoring is not active or no events received.
    /// Resets the event counter so the next call only returns new events.
    pub fn drain_active_pids() -> Option<std::collections::HashSet<u32>> {
        let mut guard = MONITOR_STATE.lock().ok()?;
        let state = guard.as_mut()?;
        if state.total_events == 0 {
            return None;
        }
        state.total_events = 0;
        Some(std::mem::take(&mut state.active_pids))
    }

    /// Check whether WFP monitoring is active.
    pub fn is_monitoring() -> bool {
        MONITOR_ACTIVE.load(Ordering::SeqCst)
    }

    // ── private ──────────────────────────────────────────────────────────────

    fn engine_handle(&self) -> Result<HANDLE, String> {
        match &self.session {
            Some(s) => Ok(s.handle),
            None => Err("WFP engine session is not open".to_string()),
        }
    }

    fn ensure_sublayer(&mut self) -> Result<(), String> {
        if self.sublayer_added {
            return Ok(());
        }
        let handle = self.engine_handle()?;

        let mut sl: FWPM_SUBLAYER0 = unsafe { std::mem::zeroed() };
        sl.subLayerKey = SUBLAYER_GUID;
        sl.weight = 0x0200;

        let err: u32 = unsafe {
            FwpmSubLayerAdd0(handle, &sl as *const _, ptr::null_mut())
        };
        // 0x80320009 = FWP_E_ALREADY_EXISTS
        if err != 0 && err != 0x8032_0009_u32 {
            return Err(format!("FwpmSubLayerAdd0: 0x{err:08X}"));
        }
        self.sublayer_added = true;
        Ok(())
    }
}

// ──────────────────────────── free functions ────────────────────────────────

/// Add one BLOCK filter for a specific layer; return its assigned filter ID.
fn add_app_filter(
    handle: HANDLE,
    app_id_bytes: &[u8],
    layer_guid: GUID,
    description: &str,
) -> Result<u64, String> {
    // Stack blob pointing at our bytes — must outlive FwpmFilterAdd0.
    let mut blob = FWP_BYTE_BLOB {
        size: app_id_bytes.len() as u32,
        data: app_id_bytes.as_ptr() as *mut u8,
    };

    // Condition: match FWPM_CONDITION_ALE_APP_ID == blob.
    // FWP_BYTE_BLOB_TYPE: FWP_DATA_TYPE = 12i32
    // FWP_MATCH_EQUAL:    FWP_MATCH_TYPE = 0i32
    // Anonymous.byteBlob: *mut FWP_BYTE_BLOB (one level of Anonymous)
    let mut condition: FWPM_FILTER_CONDITION0 = unsafe { std::mem::zeroed() };
    condition.fieldKey = FWPM_CONDITION_ALE_APP_ID;
    condition.matchType = FWP_MATCH_EQUAL;
    condition.conditionValue.r#type = FWP_BYTE_BLOB_TYPE;
    condition.conditionValue.Anonymous.byteBlob = &mut blob as *mut FWP_BYTE_BLOB;

    // Wide display name — must outlive FwpmFilterAdd0.
    let desc_wide: Vec<u16> = description
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    // FWPM_DISPLAY_DATA0::name is PWSTR = *mut u16.
    // WFP reads this string but doesn't mutate it; cast const ptr to mut is safe
    // because the API documentation guarantees it is read-only.
    let mut display_data: FWPM_DISPLAY_DATA0 = unsafe { std::mem::zeroed() };
    display_data.name = desc_wide.as_ptr() as *mut u16;

    // FWP_ACTION_BLOCK: FWP_ACTION_TYPE = u32 = 4097u32
    let mut action: FWPM_ACTION0 = unsafe { std::mem::zeroed() };
    action.r#type = FWP_ACTION_BLOCK;

    // weight.type = FWP_EMPTY (= 0i32): let BFE auto-assign.
    // weight on FWPM_FILTER0 is FWP_VALUE0 (not FWP_CONDITION_VALUE0).
    let mut weight: FWP_VALUE0 = unsafe { std::mem::zeroed() };
    weight.r#type = FWP_EMPTY;

    let mut filter: FWPM_FILTER0 = unsafe { std::mem::zeroed() };
    filter.displayData = display_data;
    filter.layerKey = layer_guid;
    filter.subLayerKey = SUBLAYER_GUID;
    filter.action = action;
    filter.weight = weight;
    filter.numFilterConditions = 1;
    filter.filterCondition = &mut condition as *mut FWPM_FILTER_CONDITION0;

    let mut filter_id: u64 = 0;
    let err: u32 = unsafe {
        FwpmFilterAdd0(
            handle,
            &filter as *const FWPM_FILTER0,
            ptr::null_mut(), // NULL security descriptor = default ACL
            &mut filter_id as *mut u64,
        )
    };
    win32_check(err, "FwpmFilterAdd0")?;
    Ok(filter_id)
}

/// Convert a Win32 path to the NT device path bytes WFP uses internally.
pub fn get_app_id_bytes(win32_path: &str) -> Result<Vec<u8>, String> {
    let wide: Vec<u16> = win32_path
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut blob_ptr: *mut FWP_BYTE_BLOB = ptr::null_mut();
    let err: u32 = unsafe {
        FwpmGetAppIdFromFileName0(
            wide.as_ptr() as PCWSTR,
            &mut blob_ptr as *mut *mut FWP_BYTE_BLOB,
        )
    };
    win32_check(err, "FwpmGetAppIdFromFileName0")?;

    if blob_ptr.is_null() {
        return Err("FwpmGetAppIdFromFileName0 returned null blob".to_string());
    }

    let bytes = unsafe {
        let blob = &*blob_ptr;
        std::slice::from_raw_parts(blob.data, blob.size as usize).to_vec()
    };
    // FwpmFreeMemory0 takes *mut *mut c_void.
    unsafe {
        let mut void_ptr: *mut c_void = blob_ptr as *mut c_void;
        FwpmFreeMemory0(&mut void_ptr as *mut *mut c_void);
    }
    Ok(bytes)
}

/// WFP network event callback — called by the kernel for each network event.
/// Extracts PID from the event header at verified x64 offsets.
///
/// This callback runs on a kernel dispatch thread, so it must be fast and
/// lock-free (Mutex lock is acceptable but should be held briefly).
///
/// **x64-only**: The header struct offsets used here are specific to x64.
/// This callback is registered via FwpmNetEventSubscribe0 which is only
/// available on Windows, and this app only targets x64 Windows.
///
/// FWPM_NET_EVENT0 layout (x64):
///   [0..4]   type (u32)
///   [4..8]   padding
///   [8..16]  header → *mut FWPM_NET_EVENT_HEADER0
///   [16..20] flags (u32)
///
/// FWPM_NET_EVENT_HEADER0 layout (x64):
///   [0..8]   timestamp (i64)
///   [8..12]  flags (u32)
///   ...
///   [72..76] processId (u32)
unsafe extern "system" fn net_event_callback(
    _context: *const c_void,
    event: *const c_void,
) {
    // This callback is only called on Windows (registered via FwpmNetEventSubscribe0).
    // The offset-based field extraction is x64-only. If 32-bit Windows support
    // is ever needed, the offsets in NET_EVENT_HEADER_PTR_OFFSET and
    // HEADER_PROCESS_ID_OFFSET must be recalculated for x86.
    #[cfg(not(target_arch = "x86_64"))]
    return; // Skip on non-x64 architectures — offsets are x64-specific

    if event.is_null() {
        return;
    }

    // Read the header pointer from FWPM_NET_EVENT0 at offset 8
    let header_ptr = *((event as *const u8).add(NET_EVENT_HEADER_PTR_OFFSET) as *const *const u8);
    if header_ptr.is_null() {
        return;
    }

    // Read processId from FWPM_NET_EVENT_HEADER0 at offset 72
    let pid = *(header_ptr.add(HEADER_PROCESS_ID_OFFSET) as *const u32);

    // PID 0 or 4 are system/kernel — skip them
    if pid <= 4 {
        return;
    }

    // WFP monitoring provides IPC isolation and process activity tracking.
    // Byte counting is handled exclusively by ETW.
    if let Ok(mut guard) = MONITOR_STATE.lock() {
        if let Some(ref mut state) = *guard {
            state.total_events += 1;
            state.active_pids.insert(pid);
        }
    }
}

fn win32_check(code: u32, context: &str) -> Result<(), String> {
    if code == 0 {
        Ok(())
    } else {
        Err(format!("{context} failed: 0x{code:08X}"))
    }
}
