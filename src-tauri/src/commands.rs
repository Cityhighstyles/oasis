//! Tauri command handlers — the IPC bridge between the WebView and the engine.
//!
//! All commands are thin wrappers: they acquire the AppState mutex, delegate to
//! the appropriate engine method, and return a JSON-serialisable result.

use std::sync::{Arc, Mutex};
use tauri::State;

#[cfg(target_os = "windows")]
use crate::procctl;
use crate::carbon::CarbonStats;
use crate::engine::{NetworkEngine, ProcessEntry};
use crate::rules::Rule;
use crate::sandbox::{CommandType, DetectedOperation, SandboxEngine};
use serde::{Deserialize, Serialize};

/// Managed state type registered with Tauri (networking engine).
pub struct AppState(pub Arc<Mutex<NetworkEngine>>);

/// Managed state type for the sandbox engine.
pub struct SandboxState(pub Arc<Mutex<SandboxEngine>>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    pub is_running: bool,
    pub has_groq_key: bool,
    pub operations_count: usize,
}

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

// ═══════════════════════════ Rules Commands ═══════════════════════════════════

/// Returns all tracked rules, ordered by the canonical display order.
#[tauri::command]
pub fn get_rules(state: State<'_, AppState>) -> Result<Vec<Rule>, String> {
    let engine = state
        .0
        .lock()
        .map_err(|e| format!("state lock poisoned: {e}"))?;
    Ok(engine.rules_manager.get_all_rules())
}

/// Toggle a rule's active state, rebuild the block index cache, and persist.
///
/// The front-end applies an optimistic UI pattern before calling this command;
/// on error the caller should rollback the optimistic state.
#[tauri::command]
pub fn toggle_rule_state(
    id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let engine = state
        .0
        .lock()
        .map_err(|e| format!("state lock poisoned: {e}"))?;
    engine.rules_manager.toggle_rule(&id, enabled)
}

/// Set the master shield active state on the engine.
/// This controls whether the AutoBlockRegistry filters are enforced during polling.
#[tauri::command]
pub fn set_shield_active(
    active: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut engine = state
        .0
        .lock()
        .map_err(|e| format!("state lock poisoned: {e}"))?;
    engine.set_shield_active(active);
    Ok(())
}

/// Add a new custom rule with the given name, description, risk, and targets.
/// Returns the newly created `Rule` (with generated id).
#[tauri::command]
pub fn add_rule(
    name: String,
    description: String,
    risk: String,
    targets: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Rule, String> {
    let risk_enum = match risk.to_lowercase().as_str() {
        "high" => crate::rules::Risk::High,
        "medium" => crate::rules::Risk::Medium,
        "low" => crate::rules::Risk::Low,
        _ => return Err(format!("Invalid risk level '{risk}'. Use 'high', 'medium', or 'low'")),
    };

    let engine = state
        .0
        .lock()
        .map_err(|e| format!("state lock poisoned: {e}"))?;
    engine.rules_manager.add_rule(name, description, risk_enum, targets)
}

/// Delete a rule by id. Rebuilds the registry and persists.
/// Returns the deleted rule for confirmation.
#[tauri::command]
pub fn delete_rule(
    id: String,
    state: State<'_, AppState>,
) -> Result<Rule, String> {
    let engine = state
        .0
        .lock()
        .map_err(|e| format!("state lock poisoned: {e}"))?;
    engine.rules_manager.delete_rule(&id)
}

// ═══════════════════════════ Sandbox Commands ═══════════════════════════════

/// Returns the list of detected developer operations from the sandbox scanner.
#[tauri::command]
pub fn get_sandbox_operations(
    state: State<'_, SandboxState>,
) -> Result<Vec<DetectedOperation>, String> {
    let engine = state
        .0
        .lock()
        .map_err(|e| format!("sandbox state lock poisoned: {e}"))?;
    Ok(engine.get_operations())
}

/// Clear all detected sandbox operations.
#[tauri::command]
pub fn clear_sandbox_operations(
    state: State<'_, SandboxState>,
) -> Result<(), String> {
    let mut engine = state
        .0
        .lock()
        .map_err(|e| format!("sandbox state lock poisoned: {e}"))?;
    engine.clear_operations();
    Ok(())
}

// ═══════════════════════════ Carbon Commands ═══════════════════════════════

/// Returns the current carbon statistics (cumulative CO₂ saved/footprint).
#[tauri::command]
pub fn get_carbon_stats(
    state: State<'_, AppState>,
) -> Result<CarbonStats, String> {
    let engine = state
        .0
        .lock()
        .map_err(|e| format!("state lock poisoned: {e}"))?;
    Ok(engine.get_carbon_stats())
}

/// Reset the carbon tracker (zero out all counters).
#[tauri::command]
pub fn reset_carbon_tracker(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut engine = state
        .0
        .lock()
        .map_err(|e| format!("state lock poisoned: {e}"))?;
    engine.reset_carbon_tracker();
    Ok(())
}

// ═══════════════════════════ Sandbox Commands ═══════════════════════════════

/// Request a local size estimate for a specific operation type.
/// Used when Groq is not configured.
#[tauri::command]
pub fn estimate_command_size(
    command_type: String,
    state: State<'_, SandboxState>,
) -> Result<serde_json::Value, String> {
    let _engine = state
        .0
        .lock()
        .map_err(|e| format!("sandbox state lock poisoned: {e}"))?;
    // Parse command type string back to enum
    let cmd_type = CommandType::from_label(&command_type);
    let (est, rmin, rmax, conf, reasoning) = SandboxEngine::local_estimate(&cmd_type);
    Ok(serde_json::json!({
        "estimatedMb": est,
        "rangeMinMb": rmin,
        "rangeMaxMb": rmax,
        "confidence": conf,
        "reasoning": reasoning
    }))
}


/// Start the sandbox process scanner. If already running, this is a no-op.
#[tauri::command]
pub fn start_sandbox_scanner(
    app: tauri::AppHandle,
    state: State<'_, SandboxState>,
) -> Result<(), String> {
    let engine = state
        .0
        .lock()
        .map_err(|e| format!("sandbox state lock poisoned: {e}"))?;

    if engine.is_running {
        log::info!("start_sandbox_scanner: scanner already running, ignoring");
        return Ok(());
    }
    drop(engine); // release lock before spawning

    let engine_clone = Arc::clone(&state.0);
    crate::sandbox::start_scanner(engine_clone, Some(app));
    Ok(())
}

/// Stop the sandbox process scanner. If not running, this is a no-op.
#[tauri::command]
pub fn stop_sandbox_scanner(
    state: State<'_, SandboxState>,
) -> Result<(), String> {
    let engine = state.0.lock()
        .map_err(|e| format!("sandbox state lock poisoned: {e}"))?;

    if !engine.is_running {
        log::info!("stop_sandbox_scanner: scanner not running, ignoring");
        return Ok(());
    }
    drop(engine);

    crate::sandbox::stop_scanner(&state.0);
    Ok(())
}

/// Get the sandbox scanner status.
#[tauri::command]
pub fn get_sandbox_status(
    state: State<'_, SandboxState>,
) -> Result<SandboxStatus, String> {
    let engine = state
        .0
        .lock()
        .map_err(|e| format!("sandbox state lock poisoned: {e}"))?;
    Ok(SandboxStatus {
        is_running: engine.is_running,
        has_groq_key: engine.has_groq_key(),
        operations_count: engine.detected_operations.len(),
    })
}

// ── helpers ───────────────────────────────────────────────────────────────
// Note: parse_command_type was removed — CommandType::from_label() on the enum
// provides the equivalent functionality with less duplication.
