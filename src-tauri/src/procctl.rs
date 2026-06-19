//! Process control utilities — suspend, resume, and terminate processes.
//!
//! On Windows these use the Toolhelp API for thread enumeration and the
//! Threading API for suspend/resume/kill.  On non-Windows they are stubs.

#![cfg(target_os = "windows")]

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD,
    THREADENTRY32,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, OpenThread, ResumeThread, SuspendThread, TerminateProcess,
    PROCESS_SUSPEND_RESUME, PROCESS_TERMINATE, THREAD_SUSPEND_RESUME,
};

// ──────────────────────────── public API ─────────────────────────────────────

/// Suspend every thread of the given process.
/// Returns the number of threads that were suspended, or an error string.
pub fn suspend_process(pid: u32) -> Result<usize, String> {
    let _proc_handle = open_process(PROCESS_SUSPEND_RESUME, pid)?;
    let tids = enumerate_threads(pid)?;
    let mut count = 0usize;
    for tid in &tids {
        let thread_handle = open_thread(*tid);
        if thread_handle.is_null() {
            continue;
        }
        unsafe {
            // SuspendThread returns previous suspend count; -1 on error.
            let prev = SuspendThread(thread_handle);
            if prev != 0xFFFF_FFFF {
                count += 1;
            }
            CloseHandle(thread_handle);
        }
    }
    unsafe { CloseHandle(_proc_handle) };
    Ok(count)
}

/// Resume every thread of the given process.
/// Returns the number of threads that were resumed, or an error string.
pub fn resume_process(pid: u32) -> Result<usize, String> {
    let _proc_handle = open_process(PROCESS_SUSPEND_RESUME, pid)?;
    let tids = enumerate_threads(pid)?;
    let mut count = 0usize;
    for tid in &tids {
        let thread_handle = open_thread(*tid);
        if thread_handle.is_null() {
            continue;
        }
        unsafe {
            // ResumeThread returns previous suspend count; -1 on error.
            let prev = ResumeThread(thread_handle);
            if prev != 0xFFFF_FFFF {
                count += 1;
            }
            CloseHandle(thread_handle);
        }
    }
    unsafe { CloseHandle(_proc_handle) };
    Ok(count)
}

/// Forcefully terminate the given process.
pub fn kill_process(pid: u32) -> Result<(), String> {
    let handle = open_process(PROCESS_TERMINATE, pid)?;
    unsafe {
        let ret = TerminateProcess(handle, 1);
        CloseHandle(handle);
        if ret == 0 {
            return Err(format!("TerminateProcess failed for PID {pid}"));
        }
    }
    Ok(())
}

// ──────────────────────────── internal helpers ───────────────────────────────

fn open_process(access: u32, pid: u32) -> Result<HANDLE, String> {
    let handle = unsafe { OpenProcess(access, 0, pid) };
    if handle.is_null() {
        Err(format!("OpenProcess failed for PID {pid} (access 0x{access:08X})"))
    } else {
        Ok(handle)
    }
}

/// Open a thread handle with suspend/resume access.
fn open_thread(tid: u32) -> HANDLE {
    unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, tid) }
}

/// Enumerate all threads belonging to the given process.
fn enumerate_threads(pid: u32) -> Result<Vec<u32>, String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot.is_null() || snapshot == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
        return Err("CreateToolhelp32Snapshot failed".to_string());
    }

    let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;

    let mut tids = Vec::new();

    if unsafe { Thread32First(snapshot, &mut entry) } == 0 {
        unsafe { CloseHandle(snapshot) };
        return Err("Thread32First failed".to_string());
    }

    loop {
        if entry.th32OwnerProcessID == pid {
            tids.push(entry.th32ThreadID);
        }
        if unsafe { Thread32Next(snapshot, &mut entry) } == 0 {
            break;
        }
    }

    unsafe { CloseHandle(snapshot) };
    Ok(tids)
}
