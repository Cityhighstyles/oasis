//! Data Guardian — lib.rs
//!
//! Module tree:
//!   wfp        — Windows Filtering Platform user-mode session + filter management
//!   iphelper   — IP Helper telemetry (TCP/UDP table enumeration, EStats bytes)
//!   engine     — NetworkEngine: shared state, background polling, ProcessEntry schema
//!   commands   — Tauri IPC command handlers

// Platform-gated modules: WFP and IP Helper are Windows-only.
// On non-Windows (CI, docs builds), these modules are replaced by stubs so
// `cargo check` and `cargo build` succeed without Windows toolchain.
#[cfg(target_os = "windows")]
pub mod wfp;

#[cfg(target_os = "windows")]
pub mod iphelper;

#[cfg(target_os = "windows")]
pub mod procctl;

pub mod engine;
pub mod commands;
pub mod rules;

use std::sync::{Arc, Mutex};

use engine::NetworkEngine;
use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Build the shared engine ──────────────────────────────────────────────
    let engine = Arc::new(Mutex::new(NetworkEngine::new()));

    // ── Initialise WFP (attempt; non-fatal on permission deny) ───────────────
    {
        if let Ok(mut eng) = engine.lock() {
            eng.init_wfp();
        }
    }

    // ── Start the background polling task ───────────────────────────────────
    engine::start_polling_task(Arc::clone(&engine));

    // ── Build Tauri app ──────────────────────────────────────────────────────
    tauri::Builder::default()
        .manage(AppState(Arc::clone(&engine)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_live_processes,
            commands::toggle_process_shield,
            commands::get_wfp_status,
            commands::get_blocked_apps,
            commands::suspend_process,
            commands::resume_process,
            commands::kill_process,
            commands::get_suspended_pids,
            commands::get_rules,
            commands::toggle_rule_state,
            commands::set_shield_active,
            commands::add_rule,
            commands::delete_rule,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
