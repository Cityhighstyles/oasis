//! WFP (Windows Filtering Platform) user-mode session management.
//!
//! Uses `windows-sys` (raw C ABI bindings, no Option-wrapper magic).
//! All types are the exact C equivalents; all functions return u32 error codes.

use std::collections::HashMap;
use std::ffi::c_void;
use std::ptr;

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

// Manual FFI binding for FwpmEngineOpen0 (missing from windows-sys)
extern "system" {
    pub fn FwpmEngineOpen0(
        serverName: PCWSTR,
        authnService: u32,
        authIdentity: *const c_void,
        session: *const FWPM_SESSION0,
        engineHandle: *mut HANDLE,
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
}

impl WfpEngine {
    pub fn new() -> Self {
        WfpEngine {
            session: None,
            blocked: HashMap::new(),
            sublayer_added: false,
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

fn win32_check(code: u32, context: &str) -> Result<(), String> {
    if code == 0 {
        Ok(())
    } else {
        Err(format!("{context} failed: 0x{code:08X}"))
    }
}
