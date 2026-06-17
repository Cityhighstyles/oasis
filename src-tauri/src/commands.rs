//! Tauri command handlers — the IPC bridge between the WebView and the engine.
//!
//! All commands are thin wrappers: they acquire the AppState mutex, delegate to
//! the appropriate engine method, and return a JSON-serialisable result.

use std::sync::{Arc, Mutex};
use tauri::State;

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
/// The front-end can use this to indicate whether live blocking is available.
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
