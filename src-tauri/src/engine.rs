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
use crate::pdh::InterfaceThroughput;

#[cfg(target_os = "windows")]
use crate::etw;

#[cfg(not(target_os = "windows"))]
pub struct InterfaceThroughput;

#[cfg(target_os = "windows")]
use crate::iphelper::{self, ProcessNetStats};

// winrt-toast-reborn is a [target.'cfg(windows)'.dependencies] in Cargo.toml,
// so it must be gated behind cfg(windows) to avoid non-Windows compile errors.
#[cfg(target_os = "windows")]
use winrt_toast_reborn::{Toast, ToastManager, Action};

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

    pub struct InterfaceThroughput;
    impl InterfaceThroughput {
        pub fn new() -> Result<Self, String> { Err("PDH not available on this platform".into()) }
        pub fn collect(&self) -> Result<(f64, f64), String> { Err("PDH not available on this platform".into()) }
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
use stub::{WfpEngine, iphelper, ProcessNetStats, InterfaceThroughput};

// ──────────────────── spike detection types ──────────────────────────────────

/// A detected network traffic spike event emitted when a process suddenly
/// starts consuming significantly more data than its recent average.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpikeEvent {
    /// ISO-8601 timestamp when the spike was detected.
    pub timestamp: String,
    /// PID of the spiking process.
    pub pid: u32,
    /// Human-readable display name of the process.
    pub name: String,
    /// Full executable path.
    pub exe: String,
    /// Current transfer speed in bytes/sec.
    pub current_speed_bytes: f64,
    /// Rolling average speed in bytes/sec (over last N samples).
    pub average_speed_bytes: f64,
    /// Ratio of current speed to average (e.g. 5.0 = 5x spike).
    pub ratio: f64,
}

/// Configurable parameters for the spike detection algorithm.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpikeSettings {
    /// Multiplier above the rolling average that triggers a spike alert.
    /// Default: 3.0 (current speed must be >= 3x the average).
    pub threshold: f64,
    /// Minimum speed in bytes/sec below which a spike is never emitted.
    /// This prevents false alerts from very low-traffic processes.
    /// Default: 102_400 (100 KB/s).
    pub min_speed_bytes: f64,
    /// Number of recent speed samples to keep in the rolling window.
    /// Default: 6 (covers 12 seconds at 2-second poll interval).
    pub window_size: usize,
    /// Maximum number of spike events to retain in memory.
    pub max_events: usize,
}

impl Default for SpikeSettings {
    fn default() -> Self {
        SpikeSettings {
            threshold: 3.0,
            min_speed_bytes: 102_400.0,  // 100 KB/s
            window_size: 6,
            max_events: 100,
        }
    }
}

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
    /// Cumulative TCP bytes per PID from EStats (total since first seen).
    per_pid_cumulative: HashMap<u32, u64>,
    /// Previous TCP EStats cumulative bytes per PID, used to compute byte deltas.
    #[cfg(target_os = "windows")]
    last_tcp_estats_bytes: HashMap<u32, u64>,
    /// Previous IO_COUNTERS.OtherTransferCount per PID (fallback for UDP-only PIDs).
    #[cfg(target_os = "windows")]
    last_io_other_bytes: HashMap<u32, u64>,
    /// Set of PIDs that have been suspended by the user.
    #[cfg(target_os = "windows")]
    pub suspended_pids: std::collections::HashSet<u32>,
    /// Tracks cumulative carbon impact of network activity.
    pub carbon_tracker: CarbonTracker,
    /// Per-PID speed history (rolling window of recent speed samples).
    pid_speed_history: HashMap<u32, Vec<f64>>,
    /// Recent data spike events (newest first, capped at max_events).
    spike_events: Vec<SpikeEvent>,
    /// Spikes that the frontend has already been notified about via polling.
    /// Keyed by a composite string "pid:timestamp" to avoid duplicates.
    acknowledged_spikes: HashSet<String>,
    /// Configurable spike detection parameters.
    spike_settings: SpikeSettings,
    /// NDIS-level network interface throughput via PDH performance counters.
    /// `(bytes_received_per_sec, bytes_sent_per_sec)` — total across all adapters.
    /// This is the same data source as the Task Manager Performance tab.
    total_throughput: (f64, f64),
    /// PDH performance counter reader for NDIS miniport driver throughput.
    #[cfg(target_os = "windows")]
    ndis_throughput: Option<InterfaceThroughput>,
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
            last_tcp_estats_bytes: HashMap::new(),
            #[cfg(target_os = "windows")]
            last_io_other_bytes: HashMap::new(),
            #[cfg(target_os = "windows")]
            suspended_pids: std::collections::HashSet::new(),
            carbon_tracker: CarbonTracker::new(),
            pid_speed_history: HashMap::new(),
            spike_events: Vec::new(),
            acknowledged_spikes: HashSet::new(),
            spike_settings: SpikeSettings::default(),
            total_throughput: (0.0, 0.0),
            #[cfg(target_os = "windows")]
            ndis_throughput: None,
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
    pub fn init_wfp_and_ndis(&mut self) {
        match self.wfp.open() {
            Ok(()) => log::info!("WFP engine session opened successfully"),
            Err(e) => log::warn!("WFP engine session failed to open (non-fatal): {e}"),
        }

        // Initialize NDIS performance counters for total interface throughput.
        // Uses PDH to read the same counters as the Task Manager Performance tab.
        // Non-fatal: if PDH fails, we simply report 0 throughput.
        self.init_ndis_throughput();
    }

    /// Initialize the PDH-based NDIS throughput reader.
    /// Reads total network interface bytes/sec from miniport driver counters.
    fn init_ndis_throughput(&mut self) {
        #[cfg(target_os = "windows")]
        {
            match InterfaceThroughput::new() {
                Ok(tp) => {
                    log::info!("NDIS throughput reader initialized via PDH");
                    self.ndis_throughput = Some(tp);
                }
                Err(e) => {
                    log::warn!("NDIS throughput reader init failed (non-fatal): {e}");
                }
            }
        }

        // Start ETW (Event Tracing for Windows) network event consumer.
        // This provides Resource Monitor-grade real-time per-PID byte tracking.
        // Non-fatal: if ETW fails, we fall back to the polling-based approach.
        self.start_etw();
    }

    /// Start the ETW network event consumer for real-time per-PID byte tracking.
    ///
    /// ETW gives us event-driven kernel notifications every time a process
    /// sends or receives data — exactly like Resource Monitor.
    fn start_etw(&mut self) {
        #[cfg(target_os = "windows")]
        {
            match etw::start() {
                Ok(()) => log::info!("ETW network event trace started successfully"),
                Err(e) => log::warn!("ETW start failed (non-fatal, falling back to polling): {e}"),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = &self;
        }
    }

    /// Clone the current process entry snapshot for the Tauri command handler.
    pub fn get_entries(&self) -> Vec<ProcessEntry> {
        self.entries.clone()
    }

    /// Return the current total network interface throughput.
    /// Returns `(bytes_received_per_sec, bytes_sent_per_sec)`.
    /// This is the aggregate across all network adapters, read from NDIS
    /// miniport driver performance counters — the same data as the
    /// Task Manager Performance tab's network graph.
    pub fn get_total_throughput(&self) -> (f64, f64) {
        self.total_throughput
    }

    /// Return a snapshot of current carbon statistics.
    pub fn get_carbon_stats(&self) -> CarbonStats {
        self.carbon_tracker.get_stats()
    }

    /// Reset the carbon tracker (e.g. on user request).
    pub fn reset_carbon_tracker(&mut self) {
        self.carbon_tracker.reset();
    }

    // ── Spike detection API ────────────────────────────────────────────────

    /// Return all recent spike events (newest first).
    pub fn get_spike_events(&self) -> Vec<SpikeEvent> {
        self.spike_events.clone()
    }

    /// Get the current spike detection settings.
    pub fn get_spike_settings(&self) -> SpikeSettings {
        self.spike_settings.clone()
    }

    /// Update the spike detection threshold multiplier.
    pub fn set_spike_threshold(&mut self, threshold: f64) {
        let clamped = threshold.max(1.5).min(50.0);
        self.spike_settings.threshold = clamped;
        log::info!("Spike detection threshold set to {}", clamped);
    }

    /// Update the minimum speed (bytes/sec) required to trigger a spike alert.
    pub fn set_spike_min_speed(&mut self, min_speed: f64) {
        let clamped = min_speed.max(1024.0).min(1_000_000_000.0); // 1 KB/s .. 1 GB/s
        self.spike_settings.min_speed_bytes = clamped;
        log::info!("Spike detection min speed set to {} B/s", clamped);
    }

    /// Clear all stored spike events.
    pub fn clear_spike_events(&mut self) {
        self.spike_events.clear();
        self.acknowledged_spikes.clear();
    }

    /// Check for data spikes by comparing each PID's current speed against
    /// its rolling average. Called at the end of each poll cycle.
    fn detect_spikes(&mut self, new_entries: &[ProcessEntry]) {
        let now = chrono::Utc::now().to_rfc3339();
        let settings = &self.spike_settings;
        let max_events = settings.max_events;

        for entry in new_entries {
            let pid = entry.pid;
            if pid == 0 || entry.speed <= 0.0 {
                continue;
            }

            // Skip if the process is blocked (very low speed expected)
            if entry.status == "blocked" {
                continue;
            }

            // Update rolling speed history
            let history = self
                .pid_speed_history
                .entry(pid)
                .or_default();

            history.push(entry.speed);
            if history.len() > settings.window_size {
                history.remove(0);
            }

            // Need at least 3 samples to compute a meaningful average
            if history.len() < 3 {
                continue;
            }

            let avg: f64 = history.iter().sum::<f64>() / history.len() as f64;

            // Minimum speed threshold — don't alert on very low traffic
            if entry.speed < settings.min_speed_bytes && avg < settings.min_speed_bytes {
                continue;
            }

            if avg <= 0.0 {
                continue;
            }

            let ratio = entry.speed / avg;

            // Only emit a spike if the ratio exceeds the configured threshold
            if ratio >= settings.threshold {
                // Create a dedup key to avoid duplicate events for the same spike
                let dedup_key = format!("{}:{}", pid, now);

                if !self.acknowledged_spikes.contains(&dedup_key) {
                    self.acknowledged_spikes.insert(dedup_key);

                    let event = SpikeEvent {
                        timestamp: now.clone(),
                        pid,
                        name: entry.name.clone(),
                        exe: entry.exe.clone(),
                        current_speed_bytes: entry.speed,
                        average_speed_bytes: avg,
                        ratio,
                    };

                    log::info!(
                        "SPIKE DETECTED: {} (PID {}) — {:.1}x avg ({:.1} KB/s vs {:.1} KB/s avg)",
                        entry.name, pid, ratio,
                        entry.speed / 1024.0,
                        avg / 1024.0,
                    );

                    // Show native Windows toast notification on its own thread
                    // to prevent any toast-related panics from killing the polling loop.
                    #[cfg(target_os = "windows")]
                    {
                        let event_for_toast = event.clone();
                        std::thread::spawn(move || {
                            show_spike_notification(&event_for_toast);
                        });
                    }

                    self.spike_events.insert(0, event);
                    if self.spike_events.len() > max_events {
                        self.spike_events.pop();
                    }
                }
            }
        }
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

        // 2. Poll NDIS miniport driver throughput via PDH performance counters.
        //    This gives us the total interface bandwidth consumed at the hardware level,
        //    just like the Task Manager Performance tab's network graph.
        #[cfg(target_os = "windows")]
        {
            if let Some(ref tp) = self.ndis_throughput {
                match tp.collect() {
                    Ok((recv, send)) => {
                        self.total_throughput = (recv, send);
                    }
                    Err(e) => {
                        log::warn!("NDIS throughput collect failed: {e}");
                        self.total_throughput = (0.0, 0.0);
                    }
                }
            }
        }

        // 3. Add UDP connection counts to the same map
        iphelper::collect_udp_counts(&mut stats_map);

        // 3. Track bytes per PID.
        //
        //    Strategy: use GetProcessIoCounters.OtherTransferCount as the
        //    AUTHORITATIVE cumulative counter because it captures ALL socket I/O
        //    (TCP, UDP, IPv4, IPv6 including QUIC/HTTP/3). TCP EStats (below) only
        //    covers IPv4 TCP and would miss QUIC/UDP or IPv6 traffic.
        //
        //    For the per-tick speed we take the MAX of:
        //    - IO counters delta (authoritative but may not update every tick)
        //    - TCP EStats delta (more responsive for active TCP connections)
        #[cfg(target_os = "windows")]
        {
            let tcp_bytes = iphelper::collect_tcp_bytes_by_pid();
            let pids: Vec<u32> = stats_map.keys().copied().collect();

            for pid in &pids {
                // ── Authoritative cumulative counter ────────────────────────
                if let Some(current_other) = iphelper::get_process_other_bytes(*pid) {
                    let prev = self.last_io_other_bytes.get(pid).copied();
                    let io_delta = match prev {
                        Some(p) => current_other.saturating_sub(p),
                        None => 0,
                    };

                    // ── TCP EStats delta for accurate per-tick speed ────────
                    let estats_delta = tcp_bytes
                        .get(pid)
                        .map(|&(cum_in, _)| {
                            let prev_estats = self
                                .last_tcp_estats_bytes
                                .get(pid)
                                .copied()
                                .unwrap_or(0);
                            cum_in.saturating_sub(prev_estats)
                        })
                        .unwrap_or(0);

                    // Use the best available per-tick byte count for speed
                    let best_delta = io_delta.max(estats_delta);

                    if let Some(entry) = stats_map.get_mut(pid) {
                        entry.bytes_in = best_delta;
                        entry.bytes_out = 0;
                    }

                    // Cumulative tracking always uses IO counters (all protocols)
                    self.last_io_other_bytes.insert(*pid, current_other);
                    *self.per_pid_cumulative.entry(*pid).or_insert(0) += io_delta;

                    // Keep EStats baseline for next tick's speed comparison
                    if let Some(&(cum_in, _)) = tcp_bytes.get(pid) {
                        self.last_tcp_estats_bytes.insert(*pid, cum_in);
                    }
                }
            }
        }

        // 4. Integrate ETW real-time per-PID byte counts.
        //    ETW (Event Tracing for Windows) gives us event-driven kernel
        //    notifications — exactly like Resource Monitor — for every
        //    send/receive operation. These byte counts are more accurate
        //    and responsive than polling-based EStats/IO counters.
        //
        //    ETW data is merged into stats_map, taking priority over the
        //    polling-based data for the current tick's delta.
        #[cfg(target_os = "windows")]
        if let Some(etw_snapshot) = etw::take_snapshot() {
            let tracked = etw_snapshot.tracked_events;
            let pid_count = etw_snapshot.per_pid.len();

            for (pid, (etw_recv, etw_send)) in etw_snapshot.per_pid {
                if let Some(entry) = stats_map.get_mut(&pid) {
                    // ETW data overrides the polling-based byte delta.
                    // This gives us true event-driven per-process accuracy.
                    if etw_recv > 0 || etw_send > 0 {
                        entry.bytes_in = etw_recv;
                        entry.bytes_out = etw_send;
                    }
                } else {
                    // PID from ETW not in stats_map yet — add it
                    let exe_path = crate::iphelper::resolve_process_path(pid)
                        .unwrap_or_default();
                    stats_map.insert(pid, ProcessNetStats {
                        pid,
                        exe_path,
                        bytes_in: etw_recv,
                        bytes_out: etw_send,
                        ..Default::default()
                    });
                }
            }

            if tracked > 0 {
                log::debug!(
                    "ETW: {} events, {} PIDs tracked",
                    tracked,
                    pid_count,
                );
            }
        }

        // 5. Auto-block via registry — before building entries, sync WFP filters
        //    for any process whose exe name matches the AutoBlockRegistry.
        self.sync_auto_block_filters(&stats_map);

        // 6. Build entries — each PID gets its own session_data from per-PID cumulative tracking.
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

        // 7. Preserve dormant processes — only when the *specific PID* (not just exe_path)
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

        // 8. Sort by session data descending (highest consumers first)
        new_entries.sort_by(|a, b| {
            b.session_data
                .partial_cmp(&a.session_data)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // 9. Detect data spikes before finalising the entries
        self.detect_spikes(&new_entries);

        self.entries = new_entries;
    }
}

// ── ETW cleanup on drop ────────────────────────────────────────────────

/// Clean up the ETW trace session when the engine is dropped.
/// Orphaned sessions cause `ERROR_ALREADY_EXISTS` on next launch.
impl Drop for NetworkEngine {
    fn drop(&mut self) {
        #[cfg(target_os = "windows")]
        crate::etw::stop();
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

// ── Native Windows toast notification for spike events ────────────────────

/// Show a native Windows toast notification when a data spike is detected.
/// Uses the same `winrt-toast-reborn` crate as the sandbox notifications.
#[cfg(target_os = "windows")]
fn show_spike_notification(event: &SpikeEvent) {
    let manager = ToastManager::new(ToastManager::POWERSHELL_AUM_ID);
    let mut toast = Toast::new();

    let speed_text = if event.current_speed_bytes >= 1024.0 * 1024.0 {
        format!("{:.1} MB/s", event.current_speed_bytes / (1024.0 * 1024.0))
    } else {
        format!("{:.0} KB/s", event.current_speed_bytes / 1024.0)
    };

    let avg_speed_text = if event.average_speed_bytes >= 1024.0 * 1024.0 {
        format!("{:.1} MB/s", event.average_speed_bytes / (1024.0 * 1024.0))
    } else {
        format!("{:.0} KB/s", event.average_speed_bytes / 1024.0)
    };

    let title = format!("🚨 Data Spike: {}", event.name);
    let body = format!(
        "{0} is consuming {1} — {2:.1}x its normal rate!\nAverage: {3}",
        event.name, speed_text, event.ratio, avg_speed_text
    );

    toast
        .text1(title)
        .text2(body)
        .launch("action=open_spikes")
        .action(Action::new("View Spikes", "action=open_spikes", ""))
        .action(Action::new("Dismiss", "action=dismiss", ""));

    if let Err(e) = manager.show(&toast) {
        log::error!("Failed to show spike toast notification: {:?}", e);
    }
}

#[cfg(not(target_os = "windows"))]
fn show_spike_notification(_event: &SpikeEvent) {
    // No-op on non-Windows platforms
}

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