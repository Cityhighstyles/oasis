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
use std::ptr;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, GetExtendedUdpTable,
    MIB_TCPTABLE_OWNER_PID, MIB_TCPROW_OWNER_PID,
    MIB_UDPTABLE_OWNER_PID, MIB_UDPROW_OWNER_PID,
    TCP_TABLE_OWNER_PID_ALL, UDP_TABLE_OWNER_PID,
};
use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

// ─────────────────────────────── Windows API declarations ────────────────────

// I/O counters struct (manually declared as windows-sys 0.61 doesn't expose it).
#[allow(non_snake_case)]
#[repr(C)]
pub struct IO_COUNTERS {
    pub ReadOperationCount: u64,
    pub WriteOperationCount: u64,
    pub OtherOperationCount: u64,
    pub ReadTransferCount: u64,
    pub WriteTransferCount: u64,
    pub OtherTransferCount: u64,
}

// GetProcessIoCounters FFI binding (manually declared).
extern "system" {
    pub fn GetProcessIoCounters(ProcessHandle: HANDLE, IoCounters: *mut IO_COUNTERS) -> i32;
}

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

/// Enumerate all active IPv4 TCP connections and return per-connection info.
/// Note: byte tracking is now done via GetProcessIoCounters (covers all protocols),
/// so this function only provides connection counts and process identity.
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

        result.push(TcpConnectionStats {
            pid,
            exe_path,
            key,
            bytes_in: 0,
            bytes_out: 0,
        });
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

/// Query GetProcessIoCounters for a process and return OtherTransferCount.
/// This captures all socket I/O (TCP + UDP + IPv4 + IPv6) as a single cumulative counter.
/// Returns None if the process cannot be opened or queried.
pub fn get_process_other_bytes(pid: u32) -> Option<u64> {
    unsafe {
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut io: IO_COUNTERS = std::mem::zeroed();
        let ok = GetProcessIoCounters(handle, &mut io);
        CloseHandle(handle);
        if ok != 0 {
            Some(io.OtherTransferCount)
        } else {
            None
        }
    }
}

/// Enumerate all active IPv6 TCP connections and return (pid, exe_path) pairs.
pub fn collect_tcp6_connection_stats() -> Vec<(u32, String)> {
    let rows = match get_tcp6_table_rows() {
        Ok(r) => r,
        Err(e) => {
            log::warn!("collect_tcp6_connection_stats: {e}");
            return Vec::new();
        }
    };

    let mut exe_path_cache: HashMap<u32, String> = HashMap::new();
    let mut result = Vec::with_capacity(rows.len());

    for row in &rows {
        let pid = row.owning_pid;
        if pid <= 4 {
            continue;
        }
        let exe_path = exe_path_cache
            .entry(pid)
            .or_insert_with(|| resolve_process_path(pid).unwrap_or_default())
            .clone();
        result.push((pid, exe_path));
    }

    result
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

/// ── IPv6 TCP row types (manually defined; not all exist in windows-sys) ──

#[derive(Clone)]
#[repr(C)]
pub struct MibTcp6RowOwnerPid {
    pub local_addr: [u8; 16],
    pub local_scope_id: u32,
    pub local_port: u32,
    pub remote_addr: [u8; 16],
    pub remote_scope_id: u32,
    pub remote_port: u32,
    pub owning_pid: u32,
}

#[repr(C)]
pub struct MibTcp6TableOwnerPid {
    pub num_entries: u32,
    pub table: [MibTcp6RowOwnerPid; 1],
}

/// GetExtendedTcpTable with AF_INET6 to enumerate IPv6 TCP connections.
fn get_tcp6_table_rows() -> Result<Vec<MibTcp6RowOwnerPid>, String> {
    unsafe {
        let mut size: u32 = 0;
        GetExtendedTcpTable(
            ptr::null_mut(),
            &mut size,
            0,
            AF_INET6 as u32,
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
            AF_INET6 as u32,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );
        if ret != 0 {
            return Err(format!("GetExtendedTcpTable (IPv6): 0x{ret:08X}"));
        }

        let table = &*(buf.as_ptr() as *const MibTcp6TableOwnerPid);
        let count = table.num_entries as usize;
        Ok(std::slice::from_raw_parts(table.table.as_ptr(), count).to_vec())
    }
}


