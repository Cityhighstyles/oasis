//! Data Guardian — lib.rs
//!
//! Module tree:
//!   wfp        — Windows Filtering Platform user-mode session + filter management
//!   iphelper   — IP Helper telemetry (TCP/UDP table enumeration, EStats bytes)
//!   engine     — NetworkEngine: shared state, background polling, ProcessEntry schema
//!   commands   — Tauri IPC command handlers
//!   sandbox    — Developer sandbox: process detection, Groq AI, overlay windows

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
pub mod sandbox;

use std::sync::{Arc, Mutex};

use engine::NetworkEngine;
use commands::{AppState, SandboxState};
use sandbox::SandboxEngine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Build the shared engine ──────────────────────────────────────────────
    let engine = Arc::new(Mutex::new(NetworkEngine::new()));

    // ── Build the sandbox engine ────────────────────────────────────────────
    let sandbox_engine = Arc::new(Mutex::new(SandboxEngine::new()));

    // ── Initialise WFP (attempt; non-fatal on permission deny) ───────────────
    {
        if let Ok(mut eng) = engine.lock() {
            eng.init_wfp();
        }
    }

    // ── Capture AppHandle for sandbox event emission ────────────────────────
    let sandbox_for_scanner = Arc::clone(&sandbox_engine);

    // ── Start the background polling task ───────────────────────────────────
    engine::start_polling_task(Arc::clone(&engine));

    // ── Build Tauri app ──────────────────────────────────────────────────────
    tauri::Builder::default()
        .manage(AppState(Arc::clone(&engine)))
        .manage(SandboxState(Arc::clone(&sandbox_engine)))
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Start the sandbox process scanner with the app handle for events
            sandbox::start_scanner(sandbox_for_scanner, Some(app.handle().clone()));

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
            // ── Sandbox commands ───────────────────────────────────────────
            commands::get_sandbox_operations,
            commands::clear_sandbox_operations,
            commands::set_groq_api_key,
            commands::estimate_command_size,
            commands::create_sandbox_overlay,
            commands::close_sandbox_overlay,
            commands::get_sandbox_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
