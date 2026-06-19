//! NetworkEngine — the single source of truth for the application's network state.
//!
//! Architecture:
//!  - An `Arc<Mutex<NetworkEngine>>` is registered as Tauri `AppState`.
//!  - A long-running Tokio `spawn_blocking` task polls every 2 s and writes
//!    new `ProcessEntry` data into the shared state.
//!  - Tauri commands acquire the mutex for reads (get_live_processes) or
//!    writes (toggle_process_shield) without blocking the polling loop for long.
//!
//! Thread-safety contract:
//!  - The polling task locks the Mutex, performs a full snapshot replacement,
//!    then immediately releases.
//!  - Tauri commands hold the lock only as long as needed to clone the data or
//!    to call a single WFP API.
//!  - `WfpEngine` is `Send + Sync` (see wfp.rs).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Local;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
use crate::iphelper::{self, ProcessNetStats};

#[cfg(target_os = "windows")]
use crate::wfp::WfpEngine;

// ── Non-Windows stubs (CI / docs builds) ─────────────────────────────────────
#[cfg(not(target_os = "windows"))]
mod stub {
    use std::collections::HashMap;

    pub struct WfpEngine;
    impl WfpEngine {
        pub fn new() -> Self { WfpEngine }
        pub fn open(&mut self) -> Result<(), String> { Ok(()) }
        pub fn is_open(&self) -> bool { false }
        pub fn block_app(&mut self, _: &str) -> Result<(), String> {
            Err("WFP not available on this platform".into())
        }
        pub fn unblock_app(&mut self, _: &str) -> Result<(), String> {
            Err("WFP not available on this platform".into())
        }
        pub fn is_blocked(&self, _: &str) -> bool { false }
        pub fn blocked_paths(&self) -> Vec<String> { vec![] }
    }

    // Stub fallback version for non-Windows architectures
    #[derive(Clone, Debug, Default)]
    pub struct ProcessNetStats {
        pub pid: u32,
        pub exe_path: String,
        pub bytes_in: u64,
        pub bytes_out: u64,
        pub tcp_connections: usize,
        pub udp_connections: usize,
    }

    pub mod iphelper {
        use std::collections::HashMap;
        use super::ProcessNetStats;
        pub fn collect_udp_counts(_: &mut HashMap<u32, ProcessNetStats>) {}
    }
}

#[cfg(not(target_os = "windows"))]
use stub::{WfpEngine, iphelper, ProcessNetStats};

// ──────────────────────────── data contract ──────────────────────────────────

/// Serialized shape sent to the TypeScript front-end.
/// Field names are camelCased by serde to match the existing TS interface.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcessEntry {
    pub pid: u32,
    pub name: String,
    /// Absolute Win32 path to the binary (empty string if unresolvable).
    pub exe: String,
    /// "blocked" | "active" | "monitoring"
    pub status: String,
    /// MB transferred during this app session (cumulative, TCP only, from EStats).
    pub session_data: f64,
    /// TCP + UDP socket count from the current snapshot.
    pub connections: usize,
    /// "now" while active, or last HH:MM:SS timestamp when dormant.
    pub last_seen: String,
}
// ────────────────────────────── engine state ─────────────────────────────────

/// Persisted per-process accounting that survives across polling ticks.
#[derive(Clone, Debug, Default)]
struct ProcessAccumulator {
    /// Cumulative bytes received over the session lifetime (TCP EStats delta sum).
    cumulative_in: u64,
    /// Cumulative bytes sent over the session lifetime.
    cumulative_out: u64,
    /// Last EStats snapshot — needed to compute the delta between ticks.
    last_bytes_in: u64,
    last_bytes_out: u64,
    /// Last display name resolved for this exe.
    display_name: String,
    /// Original (non-lowercased) exe path for accurate display.
    original_exe_path: String,
    /// Last time we saw this process active (used for last_seen field).
    last_seen: String,
}

pub struct NetworkEngine {
    pub wfp: WfpEngine,
    /// Latest snapshot of process entries (replaced atomically each tick).
    entries: Vec<ProcessEntry>,
    /// Historical accumulators keyed by *lowercase exe path*.
    accumulators: HashMap<String, ProcessAccumulator>,
    #[cfg(target_os = "windows")]
    last_seen_connections: HashMap<iphelper::ConnectionKey, (u64, u64)>,
}

impl NetworkEngine {
    pub fn new() -> Self {
        NetworkEngine {
            wfp: WfpEngine::new(),
            entries: Vec::new(),
            accumulators: HashMap::new(),
            #[cfg(target_os = "windows")]
            last_seen_connections: HashMap::new(),
        }
    }

    /// Attempt to open the WFP BFE session.  Non-fatal on failure — the engine
    /// will still provide telemetry data; blocking/unblocking will return errors.
    pub fn init_wfp(&mut self) {
        match self.wfp.open() {
            Ok(()) => log::info!("WFP engine session opened successfully"),
            Err(e) => log::warn!("WFP engine session failed to open (non-fatal): {e}"),
        }
    }

    /// Clone the current process entry snapshot for the Tauri command handler.
    pub fn get_entries(&self) -> Vec<ProcessEntry> {
        self.entries.clone()
    }

    /// Perform one full telemetry poll and update `self.entries`.
    /// Called from the background Tokio task.
    pub fn poll(&mut self) {
        let now = Local::now().format("%H:%M:%S").to_string();

        // 1. Collect TCP stats (byte counts + connection counts) via connection deltas
        let mut stats_map: HashMap<u32, ProcessNetStats> = HashMap::new();

        #[cfg(target_os = "windows")]
        let mut current_connections: HashMap<iphelper::ConnectionKey, (u64, u64)> =
            HashMap::new();

        #[cfg(target_os = "windows")]
        {
            for conn in iphelper::collect_tcp_connection_stats() {
                let prev_counters = self
                    .last_seen_connections
                    .get(&conn.key)
                    .unwrap_or(&(0, 0));

                let delta_in = conn.bytes_in.saturating_sub(prev_counters.0);
                let delta_out = conn.bytes_out.saturating_sub(prev_counters.1);

                let entry = stats_map.entry(conn.pid).or_insert_with(|| ProcessNetStats {
                    pid: conn.pid,
                    exe_path: conn.exe_path.clone(),
                    ..Default::default()
                });

                entry.bytes_in += delta_in;
                entry.bytes_out += delta_out;
                entry.tcp_connections += 1;
                current_connections.insert(conn.key, (conn.bytes_in, conn.bytes_out));
            }

            self.last_seen_connections = current_connections;
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = &stats_map;
        }

        // 2. Add UDP connection counts to the same map
        iphelper::collect_udp_counts(&mut stats_map);

        // 3. Build entries
        let mut new_entries: Vec<ProcessEntry> = Vec::with_capacity(stats_map.len());

        for (pid, net_stats) in &stats_map {
            let exe_key = net_stats.exe_path.to_lowercase();
            let is_blocked = self.wfp.is_blocked(&net_stats.exe_path);
            let connections = net_stats.tcp_connections + net_stats.udp_connections;

            // Determine display name from exe path
            let display_name = display_name_for(&net_stats.exe_path);

            // Accumulate bytes using delta computation
            let acc = self
                .accumulators
                .entry(exe_key.clone())
                .or_insert_with(|| ProcessAccumulator {
                    display_name: display_name.clone(),
                    original_exe_path: net_stats.exe_path.clone(),
                    last_seen: now.clone(),
                    ..Default::default()
                });

            acc.display_name = display_name.clone();
            acc.original_exe_path = net_stats.exe_path.clone();

            // Delta bytes since last tick (EStats resets on connection open,
            // so we guard against negative deltas by clamping to 0).
            let delta_in = net_stats.bytes_in.saturating_sub(acc.last_bytes_in);
            let delta_out = net_stats.bytes_out.saturating_sub(acc.last_bytes_out);
            acc.cumulative_in += delta_in;
            acc.cumulative_out += delta_out;
            acc.last_bytes_in = net_stats.bytes_in;
            acc.last_bytes_out = net_stats.bytes_out;
            acc.last_seen = now.clone();

            let session_mb = round2(bytes_to_mb(acc.cumulative_in + acc.cumulative_out));

            let status = if is_blocked {
                "blocked"
            } else if connections > 0 {
                "active"
            } else {
                "monitoring"
            };

            new_entries.push(ProcessEntry {
                pid: *pid,
                name: display_name,
                exe: net_stats.exe_path.clone(),
                status: status.to_string(),
                session_data: session_mb,
                connections,
                last_seen: if status == "active" {
                    "now".to_string()
                } else {
                    acc.last_seen.clone()
                },
            });
        }

        // 4. Preserve dormant processes (were active before, not in current snapshot)
        //    so their historical data stays visible in the UI.
        for (exe_key, acc) in &self.accumulators {
            let still_present = stats_map.values().any(|s| {
                s.exe_path.to_lowercase() == *exe_key
            });
            if !still_present && acc.cumulative_in + acc.cumulative_out > 0 {
                // Find original entry's pid from previous entries list
                let prev_pid = self
                    .entries
                    .iter()
                    .find(|e| e.exe.to_lowercase() == *exe_key)
                    .map(|e| e.pid)
                    .unwrap_or(0);

                let session_mb = round2(bytes_to_mb(acc.cumulative_in + acc.cumulative_out));
                // Use the stored original exe path for accurate casing,
                // falling back to the lowercased key if not available.
                let exe_display = if acc.original_exe_path.is_empty() {
                    exe_key.clone()
                } else {
                    acc.original_exe_path.clone()
                };
                new_entries.push(ProcessEntry {
                    pid: prev_pid,
                    name: acc.display_name.clone(),
                    exe: exe_display,
                    status: "monitoring".to_string(),
                    session_data: session_mb,
                    connections: 0,
                    last_seen: acc.last_seen.clone(),
                });
            }
        }

        // 5. Sort by session data descending (highest consumers first)
        new_entries.sort_by(|a, b| {
            b.session_data
                .partial_cmp(&a.session_data)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        self.entries = new_entries;
    }
}

// ──────────────────────────── background task ────────────────────────────────

/// Spawn the background 2-second polling loop.
/// Runs as a `spawn_blocking` thread so blocking Win32 calls don't stall Tokio.
pub fn start_polling_task(engine: Arc<Mutex<NetworkEngine>>) {
    std::thread::spawn(move || {
        log::info!("NetworkEngine polling task started");
        loop {
            {
                match engine.lock() {
                    Ok(mut eng) => eng.poll(),
                    Err(e) => log::error!("Engine mutex poisoned: {e}"),
                }
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

// ──────────────────────────── utility helpers ────────────────────────────────

fn bytes_to_mb(bytes: u64) -> f64 {
    bytes as f64 / (1024.0 * 1024.0)
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Map executable file names to readable display names.
fn display_name_for(path: &str) -> String {
    let lower = path.to_lowercase();
    let file_name = lower
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&lower)
        .to_string();

    match file_name.as_str() {
        "svchost.exe" => "Windows Service Host".to_string(),
        "chrome.exe" => "Google Chrome".to_string(),
        "brave.exe" => "Brave Browser".to_string(),
        "msedge.exe" => "Microsoft Edge".to_string(),
        "firefox.exe" => "Mozilla Firefox".to_string(),
        "onedrive.exe" => "Microsoft OneDrive".to_string(),
        "dropbox.exe" => "Dropbox".to_string(),
        "teams.exe" => "Microsoft Teams".to_string(),
        "wuauserv.exe" => "Windows Update".to_string(),
        "msmpeng.exe" => "Windows Defender".to_string(),
        "code.exe" => "VS Code".to_string(),
        "slack.exe" => "Slack".to_string(),
        "discord.exe" => "Discord".to_string(),
        "node.exe" => "Node.js".to_string(),
        "python.exe" | "python3.exe" => "Python".to_string(),
        "winstore.app.exe" => "Microsoft Store".to_string(),
        "backgroundtransferhost.exe" => "Background Transfer".to_string(),
        _ => {
            // Strip .exe and title-case
            let base = file_name.trim_end_matches(".exe");
            let mut chars = base.chars();
            match chars.next() {
                None => base.to_string(),
                Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
            }
        }
    }
}