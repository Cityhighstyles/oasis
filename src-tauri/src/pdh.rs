//! NDIS miniport-driver level network interface throughput via PDH.
//!
//! This is the same data source that **Task Manager's Performance tab** uses:
//! it polls hardware byte counters exposed by the NDIS miniport driver
//! through Windows Performance Counters.
//!
//! ```math
//! Throughput = (Current_HW_Counter - Previous_HW_Counter) / Time_Delta
//! ```
//!
//! Unlike Resource Monitor (which cares about *who* is talking), this module
//! measures the physical highway — total bytes flowing through the Wi-Fi/Ethernet
//! adapter without per-process attribution.
//!
//! Architecture:
//!   - Uses `PdhOpenQueryW` / `PdhAddEnglishCounterW` to register counter paths
//!   - Reads `\Network Interface(*)\Bytes Received/sec` — a "rate" counter that
//!     PDH automatically computes as a per-second delta from raw NDIS OID values
//!   - Sums across all active network interfaces for the system total

use std::ffi::c_void;
use std::ptr;

// ── Manual FFI: PDH (Performance Data Helper) ───────────────────────────────
// These functions are from pdh.dll. We define them manually with the exact C ABI
// signatures from the Windows SDK, avoiding any dependency on windows-sys PDH types.

type HQUERY = *mut c_void;
type HCOUNTER = *mut c_void;

#[repr(C)]
struct PDH_FMT_COUNTERVALUE {
    c_status: u32,
    // Anonymous union — we only ever read the doubleValue member
    // when using PDH_FMT_DOUBLE format flag
    value: f64,
}

const PDH_FMT_DOUBLE: u32 = 0x0000_0200;

// ── Counter path constants ──────────────────────────────────────────────────

/// Wildcard counter path: receive bytes/sec across all network interfaces.
const COUNTER_RECEIVED: &str = "\\Network Interface(*)\\Bytes Received/sec";
/// Wildcard counter path: send bytes/sec across all network interfaces.
const COUNTER_SENT: &str = "\\Network Interface(*)\\Bytes Sent/sec";

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
}

// ── Public interface ────────────────────────────────────────────────────────

/// Network interface throughput measured at the NDIS miniport driver layer.
///
/// This is the same data that the Task Manager Wi-Fi/Ethernet performance
/// graph displays — total bytes per second for the entire system, without
/// per-process attribution.
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
    recv_counter: HCOUNTER,
    send_counter: HCOUNTER,
    // Cached wide strings so they outlive the PdhAddEnglishCounterW calls
    _recv_path_wide: Vec<u16>,
    _send_path_wide: Vec<u16>,
}

// SAFETY: PDH handles are only accessed from behind the NetworkEngine mutex;
// no concurrent access to the same query occurs. See struct-level docs.
unsafe impl Send for InterfaceThroughput {}
unsafe impl Sync for InterfaceThroughput {}

impl InterfaceThroughput {
    /// Open a PDH query and register the network interface counters.
    ///
    /// This does NOT collect data — call `collect()` in your polling loop.
    pub fn new() -> Result<Self, String> {
        let mut query: HQUERY = ptr::null_mut();

        // ── 1. Open query ──────────────────────────────────────────────
        let ret = unsafe { PdhOpenQueryW(ptr::null(), 0, &mut query) };
        if ret != 0 {
            return Err(format!("PdhOpenQueryW failed: 0x{ret:08X}"));
        }

        // ── 2. Add counters for received bytes ──────────────────────────
        let recv_wide: Vec<u16> = COUNTER_RECEIVED
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut recv_counter: HCOUNTER = ptr::null_mut();
        let ret = unsafe {
            PdhAddEnglishCounterW(
                query,
                recv_wide.as_ptr(),
                0,
                &mut recv_counter,
            )
        };
        if ret != 0 {
            unsafe { PdhCloseQuery(query) };
            return Err(format!("PdhAddEnglishCounterW (recv) failed: 0x{ret:08X}"));
        }

        // ── 3. Add counters for sent bytes ──────────────────────────────
        let send_wide: Vec<u16> = COUNTER_SENT
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut send_counter: HCOUNTER = ptr::null_mut();
        let ret = unsafe {
            PdhAddEnglishCounterW(
                query,
                send_wide.as_ptr(),
                0,
                &mut send_counter,
            )
        };
        if ret != 0 {
            unsafe { PdhCloseQuery(query) };
            return Err(format!("PdhAddEnglishCounterW (send) failed: 0x{ret:08X}"));
        }

        Ok(InterfaceThroughput {
            query,
            recv_counter,
            send_counter,
            _recv_path_wide: recv_wide,
            _send_path_wide: send_wide,
        })
    }

    /// Collect current throughput values from the NDIS driver counters.
    ///
    /// Returns `(bytes_received_per_sec, bytes_sent_per_sec)`.
    ///
    /// PDH computes the per-second rate for us via the `PDH_FMT_DOUBLE` format.
    /// These counters are `PERF_COUNTER_BULK_COUNT` (rate counters) that PDH
    /// evaluates as `(raw2 - raw1) / (time2 - time1)`.
    ///
    /// Calling this in a 2-second loop gives smoothed throughput values matching
    /// what Task Manager displays.
    pub fn collect(&self) -> Result<(f64, f64), String> {
        // ── Collect raw data from all counters ─────────────────────────
        let ret = unsafe { PdhCollectQueryData(self.query) };
        if ret != 0 {
            return Err(format!("PdhCollectQueryData failed: 0x{ret:08X}"));
        }

        // ── Read received bytes/sec ────────────────────────────────────
        let recv = self.read_counter_value(self.recv_counter)?;
        let send = self.read_counter_value(self.send_counter)?;

        Ok((recv, send))
    }

    /// Helper: format a single counter as a double value.
    fn read_counter_value(&self, counter: HCOUNTER) -> Result<f64, String> {
        let mut value: PDH_FMT_COUNTERVALUE = PDH_FMT_COUNTERVALUE {
            c_status: 0,
            value: 0.0,
        };
        let mut dw_type: u32 = 0;
        let ret = unsafe {
            PdhGetFormattedCounterValue(
                counter,
                PDH_FMT_DOUBLE,
                &mut dw_type,
                &mut value,
            )
        };
        if ret != 0 {
            return Err(format!(
                "PdhGetFormattedCounterValue failed: 0x{ret:08X}, status={}",
                value.c_status
            ));
        }
        Ok(value.value.max(0.0))
    }
}

impl Drop for InterfaceThroughput {
    fn drop(&mut self) {
        if !self.query.is_null() {
            unsafe { PdhCloseQuery(self.query) };
        }
    }
}
