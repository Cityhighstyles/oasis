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

#[cfg(target_os = "windows")]
pub mod pdh;

pub mod carbon;
pub mod engine;
pub mod commands;
pub mod rules;
pub mod sandbox;

use std::sync::{Arc, Mutex};

use engine::NetworkEngine;
use commands::{AppState, SandboxState};
use sandbox::SandboxEngine;

use tauri::{
    tray::{TrayIconBuilder, TrayIconEvent},
    menu::{MenuBuilder, MenuItemBuilder},
    Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Load environment variables from .env file (if present) ─────────────
    // This makes GROQ_API_KEY available to SandboxEngine::new() below.
    dotenvy::dotenv().ok();

    // ── Build the shared engine ──────────────────────────────────────────────
    let engine = Arc::new(Mutex::new(NetworkEngine::new()));

    // ── Build the sandbox engine ────────────────────────────────────────────
    let sandbox_engine = Arc::new(Mutex::new(SandboxEngine::new()));

    // ── Initialise WFP (attempt; non-fatal on permission deny) ───────────────
    {
        if let Ok(mut eng) = engine.lock() {
            eng.init_wfp_and_ndis();
        }
    }

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

            // ── Register autostart plugin ───────────────────────────────────
            // Allows the frontend to enable/disable launch-at-login via
            // `@tauri-apps/plugin-autostart`.
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--minimized"]),
            ))?;

            // ── Build the system tray ───────────────────────────────────────
            let show_item = MenuItemBuilder::with_id("show", "Show Window")
                .build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Data Guardian")
                .build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // Use the app's default icon for the tray
            let icon = app
                .default_window_icon()
                .cloned()
                .unwrap_or_else(|| {
                    // Fallback: a small transparent 32x32 image
                    tauri::image::Image::new(&[0u8; 32 * 32 * 4], 32, 32)
                });

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Data Guardian — Monitoring Network Activity")
                .menu(&menu)
                .on_menu_event(|app_handle, event| {
                    match event.id.as_ref() {
                        "show" => {
                            // Show and focus the main window
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.unminimize();
                            }
                        }
                        "quit" => {
                            // Fully exit the application
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        // Double-click tray icon → show window
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                    }
                })
                .build(app)?;

            // ── Handle close-to-tray ────────────────────────────────────────
            // When the user clicks the close button, hide the window instead of
            // quitting. The app continues running in the background.
            // The user can fully quit via the tray menu.
            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win.hide();
                    }
                });
            }

            // ── Handle --minimized startup flag ─────────────────────────────
            // When launched via autostart with `--minimized`, hide the window
            // immediately so it starts in the background.
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            // Note: sandbox scanner is NOT auto-started here.
            // The frontend calls start_sandbox_scanner / stop_sandbox_scanner
            // commands to control when the background process scanner runs.

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_live_processes,
            commands::toggle_process_shield,
            commands::get_total_throughput,
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
            commands::estimate_command_size,
            commands::get_sandbox_status,
            commands::start_sandbox_scanner,
            commands::stop_sandbox_scanner,
            // ── Carbon commands ────────────────────────────────────────────
            commands::get_carbon_stats,
            commands::reset_carbon_tracker,
            // ── Spike detection commands ───────────────────────────────────
            commands::get_spike_events,
            commands::clear_spike_events,
            commands::get_spike_settings,
            commands::set_spike_threshold,
            commands::set_spike_min_speed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
