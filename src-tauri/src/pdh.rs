//! NDIS miniport-driver level network interface throughput via PDH.
//!
//! This is the same data source that **Task Manager's Performance tab** uses:
//! it polls hardware byte counters exposed by the NDIS miniport driver
//! through Windows Performance Counters.
//!
//! Architecture:
//!   - First call expands the wildcard `\Network Interface(*)\Bytes Received/sec`
//!     with `PdhExpandWildCardPathW` to get the real interface instance names
//!     (e.g. "Realtek PCIe GbE Family Controller", "Wi-Fi", "Bluetooth" etc.)
//!   - For each interface we add a received and sent counter
//!   - On every `collect()` call we sum the values across ALL interfaces to
//!     produce the system-wide total throughput

use std::ffi::c_void;
use std::ptr;

// ── Manual FFI: PDH (Performance Data Helper) ───────────────────────────────

type HQUERY = *mut c_void;
type HCOUNTER = *mut c_void;

#[repr(C)]
struct PDH_FMT_COUNTERVALUE {
    c_status: u32,
    value: f64,
}

const PDH_FMT_DOUBLE: u32 = 0x0000_0200;

// ── Counter path constants ──────────────────────────────────────────────────

/// Wildcard counter path: receive bytes/sec across all network interfaces.
const COUNTER_RECEIVED: &str = "\\Network Interface(*)\\Bytes Received/sec";

extern "system" {
    fn PdhOpenQueryW(
        szDataSource: *const u16,
        dwUserData: usize,
        phQuery: *mut HQUERY,
    ) -> u32;

    fn PdhAddEnglishCounterW(
        hQuery: HQUERY,
        szFullCounterPath: *const u16,
        dwUserData: usize,
        phCounter: *mut HCOUNTER,
    ) -> u32;

    fn PdhCollectQueryData(hQuery: HQUERY) -> u32;

    fn PdhGetFormattedCounterValue(
        hCounter: HCOUNTER,
        dwFormat: u32,
        lpdwType: *mut u32,
        pValue: *mut PDH_FMT_COUNTERVALUE,
    ) -> u32;

    fn PdhCloseQuery(hQuery: HQUERY) -> u32;

    fn PdhExpandWildCardPathW(
        szDataSource: *const u16,
        szWildCardPath: *const u16,
        mszExpandedPathList: *mut u16,
        pcchPathListLength: *mut u32,
        dwFlags: u32,
    ) -> u32;
}

// ── Interface counter pair ──────────────────────────────────────────────────

/// A pair of PDH counters for one network interface (receive + send).
struct InterfaceCounters {
    _name: String,
    recv: HCOUNTER,
    send: HCOUNTER,
}

impl InterfaceCounters {
    /// Read both counters and return `(bytes_recv_per_sec, bytes_sent_per_sec)`.
    fn read_pair(&self) -> (f64, f64) {
        let recv = read_counter_value(self.recv).unwrap_or(0.0);
        let send = read_counter_value(self.send).unwrap_or(0.0);
        (recv, send)
    }
}

// ── Public interface ────────────────────────────────────────────────────────

/// Network interface throughput measured at the NDIS miniport driver layer.
///
/// This is the same data that the Task Manager Wi-Fi/Ethernet performance
/// graph displays — total bytes per second for the entire system, without
/// per-process attribution.
///
/// Internally we expand the wildcard counter path to discover all active
/// network interfaces and create one PDH counter pair per interface. Every
/// `collect()` call sums across all discovered interfaces.
///
/// # Thread safety
///
/// `InterfaceThroughput` holds raw PDH handles (`*mut c_void`), which do not
/// implement `Send` / `Sync` automatically. However, in practice:
///   - All PDH calls are made from behind the `NetworkEngine` mutex
///   - No two threads access the same PDH query concurrently
///   - The PDH query and counters are created/destroyed on the same thread
///
/// We therefore implement `Send` and `Sync` manually.
pub struct InterfaceThroughput {
    query: HQUERY,
    interfaces: Vec<InterfaceCounters>,
}

// SAFETY: PDH handles are only accessed from behind the NetworkEngine mutex;
// no concurrent access to the same query occurs. See struct-level docs.
unsafe impl Send for InterfaceThroughput {}
unsafe impl Sync for InterfaceThroughput {}

impl InterfaceThroughput {
    /// Open a PDH query, expand the wildcard counter paths to discover all
    /// active network interfaces, and add a recv + send counter for each.
    pub fn new() -> Result<Self, String> {
        let mut query: HQUERY = ptr::null_mut();

        // ── 1. Open query ──────────────────────────────────────────────
        let ret = unsafe { PdhOpenQueryW(ptr::null(), 0, &mut query) };
        if ret != 0 {
            return Err(format!("PdhOpenQueryW failed: 0x{ret:08X}"));
        }

        // ── 2. Expand wildcard to find actual interface names ──────────
        let interfaces = match expand_network_interfaces(query) {
            Ok(list) if list.is_empty() => {
                // No interfaces found — log a warning but still create the
                // struct (collect() will just return 0.0, 0.0).
                log::warn!("PDH: no network interface instances found via wildcard expansion");
                Vec::new()
            }
            Ok(list) => list,
            Err(e) => {
                unsafe { PdhCloseQuery(query) };
                return Err(format!("PDH wildcard expansion failed: {e}"));
            }
        };

        log::info!(
            "PDH: monitoring {} network interface(s)",
            interfaces.len()
        );

        Ok(InterfaceThroughput {
            query,
            interfaces,
        })
    }

    /// Collect current throughput values from all NDIS driver counters.
    ///
    /// Returns `(bytes_received_per_sec, bytes_sent_per_sec)` summed across
    /// all network interfaces.
    pub fn collect(&self) -> Result<(f64, f64), String> {
        // ── Collect raw data from all counters ─────────────────────────
        let ret = unsafe { PdhCollectQueryData(self.query) };
        if ret != 0 {
            return Err(format!("PdhCollectQueryData failed: 0x{ret:08X}"));
        }

        // ── Sum across all interfaces ──────────────────────────────────
        let mut total_recv = 0.0_f64;
        let mut total_send = 0.0_f64;

        if self.interfaces.is_empty() {
            log::debug!("PDH collect: no network interfaces to read");
        }

        for iface in &self.interfaces {
            let (r, s) = iface.read_pair();
            total_recv += r;
            total_send += s;
        }

        Ok((total_recv.max(0.0), total_send.max(0.0)))
    }
}

impl Drop for InterfaceThroughput {
    fn drop(&mut self) {
        if !self.query.is_null() {
            unsafe { PdhCloseQuery(self.query) };
        }
    }
}

// ── Helper: expand wildcard counter path ────────────────────────────────────

/// Enumerate all active network interfaces via `PdhExpandWildCardPathW`
/// and add a recv + send counter pair for each discovered interface.
///
/// Returns a vector of `InterfaceCounters` — one per interface.
fn expand_network_interfaces(query: HQUERY) -> Result<Vec<InterfaceCounters>, String> {
    // ── 1. Determine buffer size for expanded paths ───────────────────
    let wild_wide: Vec<u16> = COUNTER_RECEIVED
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut buf_size: u32 = 0;
    let ret = unsafe {
        PdhExpandWildCardPathW(
            ptr::null(),
            wild_wide.as_ptr(),
            ptr::null_mut(),
            &mut buf_size,
            0,
        )
    };

    // Expected: PDH_MORE_DATA (0x800007D2) when called with null buffer
    // If it returns 0 (success) with size 0, no interfaces exist.
    if ret == 0 && buf_size == 0 {
        return Ok(Vec::new());
    }

    // ── 2. Allocate buffer and expand ─────────────────────────────────
    let mut buffer: Vec<u16> = vec![0u16; buf_size as usize];

    let ret = unsafe {
        PdhExpandWildCardPathW(
            ptr::null(),
            wild_wide.as_ptr(),
            buffer.as_mut_ptr(),
            &mut buf_size,
            0,
        )
    };

    if ret != 0 {
        return Err(format!("PdhExpandWildCardPathW failed: 0x{ret:08X}"));
    }

    // ── 3. Parse multi-string (NUL-separated double-NULL-terminated) ──
    let mut interfaces: Vec<InterfaceCounters> = Vec::new();
    let mut pos = 0_usize;

    while pos < buffer.len() {
        // Find the end of the current string
        let end = buffer[pos..]
            .iter()
            .position(|&c| c == 0)
            .map(|offset| pos + offset)
            .unwrap_or(buffer.len());

        if end == pos {
            // Double-NUL terminator — end of list
            break;
        }

        // Decode the counter path
        let path: String = buffer[pos..end]
            .iter()
            .map(|&c| c as u8 as char)
            .filter(|&c| c != '\0')
            .collect();

        pos = end + 1; // skip NUL

        // Skip empty strings
        if path.trim().is_empty() {
            continue;
        }

        // Extract the interface name from the full counter path
        // Path looks like: \Network Interface(Realtek...)\Bytes Received/sec
        // We extract the name inside the parentheses
        let iface_name = extract_instance_name(&path)
            .unwrap_or_else(|| path.clone());

        // Add a receive counter for this interface
        let recv_wide: Vec<u16> = path
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut recv_counter: HCOUNTER = ptr::null_mut();
        let ret = unsafe {
            PdhAddEnglishCounterW(query, recv_wide.as_ptr(), 0, &mut recv_counter)
        };
        if ret != 0 {
            log::warn!("PDH: failed to add recv counter for {iface_name}: 0x{ret:08X}");
            continue;
        }

        // Build the send counter path by replacing "Received" with "Sent"
        let send_path_str = path.replace("Bytes Received/sec", "Bytes Sent/sec");
        let send_wide: Vec<u16> = send_path_str
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut send_counter: HCOUNTER = ptr::null_mut();
        let ret = unsafe {
            PdhAddEnglishCounterW(query, send_wide.as_ptr(), 0, &mut send_counter)
        };
        if ret != 0 {
            log::warn!("PDH: failed to add send counter for {iface_name}: 0x{ret:08X}");
            continue;
        }

        log::debug!("PDH: monitoring interface \"{iface_name}\"");
        interfaces.push(InterfaceCounters {
            _name: iface_name,
            recv: recv_counter,
            send: send_counter,
        });
    }

    Ok(interfaces)
}

/// Extract the interface instance name from a full PDH counter path.
///
/// Example input: `\Network Interface(Realtek PCIe GbE)\Bytes Received/sec`
/// Example output: `Realtek PCIe GbE`
fn extract_instance_name(path: &str) -> Option<String> {
    let open = path.find('(')?;
    let close = path[open..].find(')')?;
    Some(path[open + 1..open + close].to_string())
}

// ── Helper: read a single PDH counter value ─────────────────────────────────

/// Format a single counter as a double value.
/// `PdhCollectQueryData` must already have been called on the query before
/// calling this function — it reads pre-sampled counter data.
fn read_counter_value(counter: HCOUNTER) -> Result<f64, String> {
    let mut value: PDH_FMT_COUNTERVALUE = PDH_FMT_COUNTERVALUE {
        c_status: 0,
        value: 0.0,
    };
    let mut dw_type: u32 = 0;
    let ret = unsafe {
        PdhGetFormattedCounterValue(counter, PDH_FMT_DOUBLE, &mut dw_type, &mut value)
    };
    if ret != 0 {
        return Err(format!(
            "PdhGetFormattedCounterValue failed: 0x{ret:08X}, status={}",
            value.c_status
        ));
    }
    Ok(value.value.max(0.0))
}
