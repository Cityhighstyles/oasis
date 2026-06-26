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

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Local;
use serde::{Deserialize, Serialize};

use crate::carbon::{CarbonTracker, CarbonStats};
use crate::rules::RulesManager;

#[cfg(target_os = "windows")]
use crate::iphelper::{self, ProcessNetStats};

#[cfg(target_os = "windows")]
use crate::wfp::WfpEngine;

#[cfg(target_os = "windows")]
use crate::procctl;

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
    /// MB transferred during this app session (cumulative, all protocols via IO counters).
    pub session_data: f64,
    /// Real-time speed in bytes/sec (delta since last 2-second poll tick).
    /// 0 for dormant/monitoring processes.
    pub speed: f64,
    /// TCP + UDP socket count from the current snapshot.
    pub connections: usize,
    /// "now" while active, or last HH:MM:SS timestamp when dormant.
    pub last_seen: String,
}
// ────────────────────────────── engine state ─────────────────────────────────

/// Persisted per-exe-path metadata that survives across polling ticks.
/// No longer tracks bytes — cumulative IO is tracked per-PID in `per_pid_cumulative`.
#[derive(Clone, Debug, Default)]
struct ProcessAccumulator {
    /// Last display name resolved for this exe.
    display_name: String,
    /// Original (non-lowercased) exe path for accurate display.
    original_exe_path: String,
    /// Last time we saw this exe actively (used for last_seen field).
    last_seen: String,
}

pub struct NetworkEngine {
    pub wfp: WfpEngine,
    /// The RulesManager managing all rules and the AutoBlockRegistry.
    pub rules_manager: RulesManager,
    /// Whether the master shield is currently active (synced from frontend).
    pub is_shield_active: bool,
    /// Tracks auto-blocked executable paths: lowercase key → original path.
    /// Used so we can drain and unblock every filter when the shield is deactivated.
    auto_blocked_paths: HashMap<String, String>,
    /// Latest snapshot of process entries (replaced atomically each tick).
    entries: Vec<ProcessEntry>,
    /// Historical per-exe-path metadata for dormant process preservation.
    accumulators: HashMap<String, ProcessAccumulator>,
    /// Cumulative IO_COUNTERS.OtherTransferCount per PID (total since first seen).
    per_pid_cumulative: HashMap<u32, u64>,
    /// Previous IO_COUNTERS.OtherTransferCount per PID, used to compute byte deltas.
    #[cfg(target_os = "windows")]
    last_io_other_bytes: HashMap<u32, u64>,
    /// Set of PIDs that have been suspended by the user.
    #[cfg(target_os = "windows")]
    pub suspended_pids: std::collections::HashSet<u32>,
    /// Tracks cumulative carbon impact of network activity.
    pub carbon_tracker: CarbonTracker,
}

impl NetworkEngine {
    pub fn new() -> Self {
        NetworkEngine {
            wfp: WfpEngine::new(),
            rules_manager: RulesManager::new(),
            is_shield_active: true,
            auto_blocked_paths: HashMap::new(),
            entries: Vec::new(),
            accumulators: HashMap::new(),
            per_pid_cumulative: HashMap::new(),
            #[cfg(target_os = "windows")]
            last_io_other_bytes: HashMap::new(),
            #[cfg(target_os = "windows")]
            suspended_pids: std::collections::HashSet::new(),
            carbon_tracker: CarbonTracker::new(),
        }
    }

    /// Set the master shield active state.
    /// When deactivating:
    ///   - Drain all auto-blocked paths and unblock every WFP filter
    ///   - Resume every process that was suspended by the user
    pub fn set_shield_active(&mut self, active: bool) {
        self.is_shield_active = active;
        if !active {
            // Unblock WFP filters installed by the AutoBlockRegistry
            for (_lower, original) in self.auto_blocked_paths.drain() {
                if let Err(e) = self.wfp.unblock_app(&original) {
                    log::warn!("Shield deactivation WFP cleanup failed for {}: {e}", original);
                }
            }
            // Resume all processes that were suspended
            #[cfg(target_os = "windows")]
            {
                let pids: Vec<u32> = self.suspended_pids.drain().collect();
                for pid in pids {
                    if let Err(e) = procctl::resume_process(pid) {
                        log::warn!("Shield deactivation resume failed for PID {pid}: {e}");
                    }
                }
            }
        }
    }

    /// Auto-install or remove WFP filters for every active process based on the
    /// AutoBlockRegistry. Called once per poll tick before building process entries.
    ///
    /// Uses a deduplicated set of executable paths so that multi-process
    /// applications (e.g. Chrome with many child processes sharing the same
    /// binary) only trigger a single `wfp.block_app()` call, avoiding the
    /// `FWP_E_ALREADY_EXISTS` (0x80320007) log spam.
    ///
    /// - If a process&#x27;s exe name is in the registry **and** the shield is active
    ///   **and** it isn&#x27;t already WFP-blocked → install a BLOCK filter via `wfp.block_app()`.
    /// - If a process was previously auto-blocked but no longer matches → remove the filter.
    fn sync_auto_block_filters(&mut self, stats_map: &HashMap<u32, ProcessNetStats>) {
        // Deduplicate by executable path first — multiple PIDs can share the same binary
        let unique_paths: HashSet<&String> = stats_map.values().map(|s| &s.exe_path).collect();

        for exe_path in unique_paths {
            let exe_name = get_exe_name(exe_path);
            let exe_path_lower = exe_path.to_lowercase();
            let should_block = self.is_shield_active
                && self.rules_manager.is_target_blocked(&exe_name);

            if should_block {
                if !self.wfp.is_blocked(exe_path) {
                    if let Err(e) = self.wfp.block_app(exe_path) {
                        log::warn!("Auto-block failed for {exe_path}: {e}");
                    } else {
                        // Store mapping: lowercase key → original path for cleanup
                        self.auto_blocked_paths.insert(exe_path_lower, exe_path.to_string());
                    }
                }
            } else if self.auto_blocked_paths.contains_key(&exe_path_lower) {
                // Was previously auto-blocked but no longer matches — unblock
                if let Some(original) = self.auto_blocked_paths.remove(&exe_path_lower) {
                    if let Err(e) = self.wfp.unblock_app(&original) {
                        log::warn!("Auto-unblock failed for {original}: {e}");
                    }
                }
            }
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

    /// Return a snapshot of current carbon statistics.
    pub fn get_carbon_stats(&self) -> CarbonStats {
        self.carbon_tracker.get_stats()
    }

    /// Reset the carbon tracker (e.g. on user request).
    pub fn reset_carbon_tracker(&mut self) {
        self.carbon_tracker.reset();
    }

    /// Perform one full telemetry poll and update `self.entries`.
    /// Called from the background Tokio task.
    pub fn poll(&mut self) {
        let now = Local::now().format("%H:%M:%S").to_string();

        // 1. Collect connection counts for ALL protocols.
        //    Byte tracking uses GetProcessIoCounters (covers TCP+UDP+IPv4+IPv6).
        let mut stats_map: HashMap<u32, ProcessNetStats> = HashMap::new();

        // 1a. TCP IPv4 connections (for connection count only — EStats bytes not used)
        #[cfg(target_os = "windows")]
        {
            for conn in iphelper::collect_tcp_connection_stats() {
                let entry = stats_map.entry(conn.pid).or_insert_with(|| ProcessNetStats {
                    pid: conn.pid,
                    exe_path: conn.exe_path.clone(),
                    ..Default::default()
                });
                entry.tcp_connections += 1;
            }

            // 1b. TCP IPv6 connections (for connection count only)
            for (pid, exe_path) in iphelper::collect_tcp6_connection_stats() {
                let entry = stats_map.entry(pid).or_insert_with(|| ProcessNetStats {
                    pid,
                    exe_path,
                    ..Default::default()
                });
                entry.tcp_connections += 1;
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = &stats_map;
        }

        // 2. Add UDP connection counts to the same map
        iphelper::collect_udp_counts(&mut stats_map);

        // 3. Query IO_COUNTERS.OtherTransferCount for per-process byte tracking.
        //    This captures all socket I/O (TCP + UDP + IPv4 + IPv6) as a cumulative
        //    counter from process start. We compute a delta from the previous poll
        //    value and store it in bytes_in as a per-tick delta.
        #[cfg(target_os = "windows")]
        {
            let pids: Vec<u32> = stats_map.keys().copied().collect();
            for pid in &pids {
                if let Some(current_other) = iphelper::get_process_other_bytes(*pid) {
                    let prev = self.last_io_other_bytes.get(pid).copied();
                    let delta = match prev {
                        // Already seen this PID — compute bytes since last poll
                        Some(p) => current_other.saturating_sub(p),
                        // First time — skip historical bytes, just set baseline
                        None => 0,
                    };
                    if let Some(entry) = stats_map.get_mut(pid) {
                        entry.bytes_in = delta;
                        entry.bytes_out = 0;
                    }
                    self.last_io_other_bytes.insert(*pid, current_other);

                    // Track per-PID cumulative bytes (independent of exe_path)
                    *self.per_pid_cumulative.entry(*pid).or_insert(0) += delta;
                }
            }
        }

        // 4. Auto-block via registry — before building entries, sync WFP filters
        //    for any process whose exe name matches the AutoBlockRegistry.
        self.sync_auto_block_filters(&stats_map);

        // 5. Build entries — each PID gets its own session_data from per-PID cumulative tracking.
        let mut new_entries: Vec<ProcessEntry> = Vec::with_capacity(stats_map.len());

        for (pid, net_stats) in &stats_map {
            let exe_key = net_stats.exe_path.to_lowercase();
            let exe_name = get_exe_name(&net_stats.exe_path);

            // Check both WFP and the AutoBlockRegistry when shield is active
            let registry_blocked =
                self.is_shield_active && self.rules_manager.is_target_blocked(&exe_name);
            let is_blocked = self.wfp.is_blocked(&net_stats.exe_path) || registry_blocked;
            let connections = net_stats.tcp_connections + net_stats.udp_connections;

            let display_name = display_name_for(&net_stats.exe_path);

            // Update accumulator metadata for dormant preservation (no byte tracking here)
            let acc = self
                .accumulators
                .entry(exe_key.clone())
                .or_insert_with(|| ProcessAccumulator {
                    display_name: display_name.clone(),
                    original_exe_path: net_stats.exe_path.clone(),
                    last_seen: now.clone(),
                });

            acc.display_name = display_name.clone();
            acc.original_exe_path = net_stats.exe_path.clone();
            acc.last_seen = now.clone();

            // Session data from per-PID cumulative bytes (NOT shared across PIDs)
            let pid_cumulative = self.per_pid_cumulative.get(pid).copied().unwrap_or(0);
            let session_mb = round2(bytes_to_mb(pid_cumulative));

            // Speed in bytes/sec from the delta (poll interval is 2 seconds)
            let speed = net_stats.bytes_in as f64 / 2.0;

            let status = if is_blocked {
                "blocked"
            } else if connections > 0 {
                "active"
            } else {
                "monitoring"
            };

            // Track carbon: record the bytes transferred this tick
            let delta_bytes = net_stats.bytes_in;
            self.carbon_tracker.record_bytes(
                &net_stats.exe_path,
                &display_name,
                delta_bytes,
                is_blocked,
            );

            // Attribute blocked bytes to matching rules so that
            // rule.data_blocked_bytes reflects real traffic, not hardcoded defaults.
            if registry_blocked && delta_bytes > 0 {
                let matching_ids = self.rules_manager.get_matching_rule_ids(&exe_name);
                for rule_id in matching_ids {
                    self.rules_manager.add_blocked_bytes(&rule_id, delta_bytes);
                }
            }

            new_entries.push(ProcessEntry {
                pid: *pid,
                name: display_name,
                exe: net_stats.exe_path.clone(),
                status: status.to_string(),
                session_data: session_mb,
                speed,
                connections,
                last_seen: if status == "active" {
                    "now".to_string()
                } else {
                    acc.last_seen.clone()
                },
            });
        }

        // 6. Preserve dormant processes — only when the *specific PID* (not just exe_path)
        //    is no longer in the current snapshot. This prevents a new PID for the same
        //    executable from suppressing the old PID's historical entry.
        for (exe_key, acc) in &self.accumulators {
            // Find the PID from the previous poll's entries for this exe_path
            let prev_entry = self
                .entries
                .iter()
                .find(|e| e.exe.to_lowercase() == *exe_key);
            let prev_pid = prev_entry.map(|e| e.pid);

            // Only add dormant entry if this specific PID is NOT in the current snapshot
            let pid_still_active = prev_pid.is_some_and(|pid| stats_map.contains_key(&pid));

            if !pid_still_active {
                let pid_cumulative = prev_pid
                    .and_then(|pid| self.per_pid_cumulative.get(&pid))
                    .copied()
                    .unwrap_or(0);

                if pid_cumulative > 0 {
                    let session_mb = round2(bytes_to_mb(pid_cumulative));
                    let exe_display = if acc.original_exe_path.is_empty() {
                        exe_key.clone()
                    } else {
                        acc.original_exe_path.clone()
                    };
                    // Preserve the last_seen from the previous entries (frozen at dormancy)
                    let prev_last_seen = prev_entry
                        .map(|e| e.last_seen.clone())
                        .unwrap_or_else(|| acc.last_seen.clone());

                    new_entries.push(ProcessEntry {
                        pid: prev_pid.unwrap_or(0),
                        name: acc.display_name.clone(),
                        exe: exe_display,
                        status: "monitoring".to_string(),
                        session_data: session_mb,
                        speed: 0.0,
                        connections: 0,
                        last_seen: prev_last_seen,
                    });
                }
            }
        }

        // 7. Sort by session data descending (highest consumers first)
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

/// Extract the file name portion from a Win32 or Unix path.
fn get_exe_name(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .to_string()
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