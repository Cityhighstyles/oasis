//! IP Helper API wrappers for user-mode network telemetry.
//!
//! Uses `windows-sys` raw bindings.
//!
//! Key types:
//!   HANDLE      = *mut c_void
//!   BOOL        = i32   (TRUE = 1, FALSE = 0)
//!   BOOLEAN     = u8    (TRUE = 1, FALSE = 0)
//!   ADDRESS_FAMILY = u16 (AF_INET = 2u16)

use std::collections::HashMap;
use std::ffi::c_void;
use std::mem;
use std::ptr;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, GetExtendedUdpTable,
    GetPerTcpConnectionEStats, SetPerTcpConnectionEStats,
    MIB_TCPTABLE_OWNER_PID, MIB_TCPROW_OWNER_PID,
    MIB_UDPTABLE_OWNER_PID, MIB_UDPROW_OWNER_PID,
    MIB_TCPROW_LH,
    TCP_TABLE_OWNER_PID_ALL, UDP_TABLE_OWNER_PID,
    TcpConnectionEstatsData,
    TCP_ESTATS_DATA_ROD_v0, TCP_ESTATS_DATA_RW_v0,
};
use windows_sys::Win32::Networking::WinSock::AF_INET;
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

// ─────────────────────────────── public types ────────────────────────────────

/// Aggregate network metrics for a single process (one poll snapshot).
#[derive(Clone, Debug, Default)]
pub struct ProcessNetStats {
    pub pid: u32,
    /// Full Win32 path to the executable.
    pub exe_path: String,
    /// Application bytes received via TCP EStats (current snapshot value).
    pub bytes_in: u64,
    /// Application bytes sent via TCP EStats (current snapshot value).
    pub bytes_out: u64,
    pub tcp_connections: usize,
    pub udp_connections: usize,
}

#[derive(Hash, Eq, PartialEq, Clone)]
pub struct ConnectionKey {
    pub local_addr: u32,
    pub local_port: u32,
    pub remote_addr: u32,
    pub remote_port: u32,
}
/// Per-TCP-connection snapshot of EStats counters and owning PID.
pub struct TcpConnectionStats {
    pub pid: u32,
    pub exe_path: String,
    pub key: ConnectionKey,
    pub bytes_in: u64,
    pub bytes_out: u64,
}

// ──────────────────────────── public functions ───────────────────────────────

/// Enumerate all active IPv4 TCP connections and return per-connection EStats counters.
pub fn collect_tcp_connection_stats() -> Vec<TcpConnectionStats> {
    let rows = match get_tcp_table_rows() {
        Ok(r) => r,
        Err(e) => {
            log::warn!("collect_tcp_connection_stats: {e}");
            return Vec::new();
        }
    };

    let mut exe_path_cache: HashMap<u32, String> = HashMap::new();
    let mut result: Vec<TcpConnectionStats> = Vec::with_capacity(rows.len());

    for row in &rows {
        let pid = row.dwOwningPid;
        if pid <= 4 { continue; }

        let exe_path = exe_path_cache
            .entry(pid)
            .or_insert_with(|| resolve_process_path(pid).unwrap_or_default())
            .clone();

        let key = ConnectionKey {
            local_addr: row.dwLocalAddr,
            local_port: row.dwLocalPort,
            remote_addr: row.dwRemoteAddr,
            remote_port: row.dwRemotePort,
        };

        let mib = to_mib_tcprow_lh(row);
        enable_estats(&mib);
        if let Some(rod) = read_estats(&mib) {
            result.push(TcpConnectionStats {
                pid,
                exe_path,
                key,
                bytes_in: rod.DataBytesIn,
                bytes_out: rod.DataBytesOut,
            });
        }
    }

    result
}

/// Enumerate all active IPv4 UDP endpoints and add counts to the given map.
pub fn collect_udp_counts(stats: &mut HashMap<u32, ProcessNetStats>) {
    let rows = match get_udp_table_rows() {
        Ok(r) => r,
        Err(e) => {
            log::warn!("collect_udp_counts: {e}");
            return;
        }
    };
    for row in &rows {
        let pid = row.dwOwningPid;
        if pid <= 4 { continue; }
        let entry = stats.entry(pid).or_insert_with(|| {
            let exe_path = resolve_process_path(pid).unwrap_or_default();
            ProcessNetStats { pid, exe_path, ..Default::default() }
        });
        entry.udp_connections += 1;
    }
}

/// Resolve a PID to its full Win32 image path.
pub fn resolve_process_path(pid: u32) -> Option<String> {
    unsafe {
        // OpenProcess returns NULL on failure (not INVALID_HANDLE_VALUE here).
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut size);
        CloseHandle(handle);
        if ok != 0 {
            Some(String::from_utf16_lossy(&buf[..size as usize]))
        } else {
            None
        }
    }
}

// ──────────────────────────── internal helpers ───────────────────────────────

/// GetExtendedTcpTable with the double-buffer pattern.
/// `border: BOOL` = i32: 0 = unsorted, 1 = sorted ascending.
/// `ulaf` takes u32 but AF_INET is u16 — cast explicitly.
fn get_tcp_table_rows() -> Result<Vec<MIB_TCPROW_OWNER_PID>, String> {
    unsafe {
        let mut size: u32 = 0;
        // First call: size inquiry (returns ERROR_INSUFFICIENT_BUFFER = 122).
        GetExtendedTcpTable(
            ptr::null_mut(),
            &mut size,
            0, // border: BOOL = i32
            AF_INET as u32,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );

        let capacity = (size as usize) + 4096;
        let mut buf: Vec<u8> = vec![0u8; capacity];
        let mut buf_size = capacity as u32;

        let ret = GetExtendedTcpTable(
            buf.as_mut_ptr() as *mut c_void,
            &mut buf_size,
            0,
            AF_INET as u32,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );
        if ret != 0 {
            return Err(format!("GetExtendedTcpTable: 0x{ret:08X}"));
        }

        let table = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
        let count = table.dwNumEntries as usize;
        Ok(std::slice::from_raw_parts(table.table.as_ptr(), count).to_vec())
    }
}

/// GetExtendedUdpTable with the double-buffer pattern.
fn get_udp_table_rows() -> Result<Vec<MIB_UDPROW_OWNER_PID>, String> {
    unsafe {
        let mut size: u32 = 0;
        GetExtendedUdpTable(ptr::null_mut(), &mut size, 0, AF_INET as u32, UDP_TABLE_OWNER_PID, 0);

        let capacity = (size as usize) + 4096;
        let mut buf: Vec<u8> = vec![0u8; capacity];
        let mut buf_size = capacity as u32;

        let ret = GetExtendedUdpTable(
            buf.as_mut_ptr() as *mut c_void,
            &mut buf_size,
            0,
            AF_INET as u32,
            UDP_TABLE_OWNER_PID,
            0,
        );
        if ret != 0 {
            return Err(format!("GetExtendedUdpTable: 0x{ret:08X}"));
        }

        let table = &*(buf.as_ptr() as *const MIB_UDPTABLE_OWNER_PID);
        let count = table.dwNumEntries as usize;
        Ok(std::slice::from_raw_parts(table.table.as_ptr(), count).to_vec())
    }
}

/// Convert `MIB_TCPROW_OWNER_PID` to `MIB_TCPROW_LH` for the EStats API.
/// Both structs share the same four address/port DWORDs.
fn to_mib_tcprow_lh(src: &MIB_TCPROW_OWNER_PID) -> MIB_TCPROW_LH {
    let mut row: MIB_TCPROW_LH = unsafe { mem::zeroed() };
    row.dwLocalAddr = src.dwLocalAddr;
    row.dwLocalPort = src.dwLocalPort;
    row.dwRemoteAddr = src.dwRemoteAddr;
    row.dwRemotePort = src.dwRemotePort;
    row
}

/// Enable EStats data collection for one TCP connection.
/// `TCP_ESTATS_DATA_RW_v0::EnableCollection` is now `bool` in windows-sys 0.61+.
fn enable_estats(row: &MIB_TCPROW_LH) {
    let rw = TCP_ESTATS_DATA_RW_v0 { EnableCollection: true };
    unsafe {
        SetPerTcpConnectionEStats(
            row as *const MIB_TCPROW_LH,
            TcpConnectionEstatsData,
            &rw as *const _ as *const u8,
            0,
            mem::size_of::<TCP_ESTATS_DATA_RW_v0>() as u32,
            0,
        );
    }
}

/// Read EStats byte counters for one TCP connection.
fn read_estats(row: &MIB_TCPROW_LH) -> Option<TCP_ESTATS_DATA_ROD_v0> {
    let mut rod: TCP_ESTATS_DATA_ROD_v0 = unsafe { mem::zeroed() };
    let ret = unsafe {
        GetPerTcpConnectionEStats(
            row as *const MIB_TCPROW_LH,
            TcpConnectionEstatsData,
            ptr::null_mut(), // rw: NULL = read-only query
            0,
            0,
            ptr::null_mut(), // ros: not needed
            0,
            0,
            &mut rod as *mut _ as *mut u8,
            0,
            mem::size_of::<TCP_ESTATS_DATA_ROD_v0>() as u32,
        )
    };
    if ret == 0 { Some(rod) } else { None }
}
