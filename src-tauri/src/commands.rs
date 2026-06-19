//! Tauri command handlers — the IPC bridge between the WebView and the engine.
//!
//! All commands are thin wrappers: they acquire the AppState mutex, delegate to
//! the appropriate engine method, and return a JSON-serialisable result.

use std::sync::{Arc, Mutex};
use tauri::State;

#[cfg(target_os = "windows")]
use crate::procctl;
use crate::engine::{NetworkEngine, ProcessEntry};

/// Managed state type registered with Tauri.
pub struct AppState(pub Arc<Mutex<NetworkEngine>>);

// ──────────────────────────── commands ───────────────────────────────────────

/// Returns the latest snapshot of process entries.
/// The background task updates this every ~2 seconds; the frontend polls at
/// whatever interval it needs (the existing 2-second tick is fine).
#[tauri::command]
pub fn get_live_processes(state: State<'_, AppState>) -> Result<Vec<ProcessEntry>, String> {
    let engine = state
        .0
        .lock()
        .map_err(|e| format!("state lock poisoned: {e}"))?;
    Ok(engine.get_entries())
}

/// Block or unblock a process by its full Win32 executable path.
///
/// `block == true`  → add WFP BLOCK filter for IPv4 + IPv6 outbound
/// `block == false` → remove the previously-added filters
///
/// Returns `Ok(())` on success.  The caller is responsible for re-querying
/// `get_live_processes` to observe the status change.
#[tauri::command]
pub fn toggle_process_shield(
    exe_path: String,
    block: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut engine = state
        .0
        .lock()
        .map_err(|e| format!("state lock poisoned: {e}"))?;

    if block {
        engine.wfp.block_app(&exe_path)
    } else {
        engine.wfp.unblock_app(&exe_path)
    }
}

/// Returns whether the WFP engine session is currently open.
#[tauri::command]
pub fn get_wfp_status(state: State<'_, AppState>) -> bool {
    match state.0.lock() {
        Ok(engine) => engine.wfp.is_open(),
        Err(_) => false,
    }
}

/// Returns the list of currently-blocked exe paths.
#[tauri::command]
pub fn get_blocked_apps(state: State<'_, AppState>) -> Vec<String> {
    match state.0.lock() {
        Ok(engine) => engine.wfp.blocked_paths(),
        Err(_) => vec![],
    }
}

/// Suspend all threads of a process by PID.
#[tauri::command]
pub fn suspend_process(
    pid: u32,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    #[cfg(target_os = "windows")]
    {
        let result = procctl::suspend_process(pid)?;
        if let Ok(mut engine) = state.0.lock() {
            engine.suspended_pids.insert(pid);
        }
        Ok(result)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&state, pid);
        Err("Process control not available on this platform".into())
    }
}

/// Resume all threads of a suspended process by PID.
#[tauri::command]
pub fn resume_process(
    pid: u32,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    #[cfg(target_os = "windows")]
    {
        let result = procctl::resume_process(pid)?;
        if let Ok(mut engine) = state.0.lock() {
            engine.suspended_pids.remove(&pid);
        }
        Ok(result)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&state, pid);
        Err("Process control not available on this platform".into())
    }
}

/// Forcefully terminate a process by PID.
#[tauri::command]
pub fn kill_process(
    pid: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = &state;
        procctl::kill_process(pid)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&state, pid);
        Err("Process control not available on this platform".into())
    }
}

/// Returns the set of currently-suspended PIDs.
#[tauri::command]
pub fn get_suspended_pids(state: State<'_, AppState>) -> Vec<u32> {
    #[cfg(target_os = "windows")]
    {
        match state.0.lock() {
            Ok(engine) => engine.suspended_pids.iter().copied().collect(),
            Err(_) => vec![],
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = &state;
        vec![]
    }
}
