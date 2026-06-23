//! Carbon Tracker — estimates the carbon footprint of network activity.
//!
//! Conversion methodology:
//!  - Network transfer: 0.06 kWh per GB (source: Andrae & Edler 2015,
//!    telecom energy studies). At the 2023 global average grid carbon
//!    intensity of ~475 g CO₂/kWh (IEA), this yields ~0.0285 g CO₂ per MB.
//!  - We round to **0.03 g CO₂ per MB** as a conservative, defensible factor.
//!  - Blocked data is counted as "carbon saved" (the traffic that didn't
//!    need to be transmitted/received).
//!  - Tree equivalence: one mature tree absorbs ~21 kg CO₂ per year
//!    (EPA estimate), so carbon_saved_g / 21000 = trees_equivalent.
//!
//! The tracker is embedded in `NetworkEngine` and updated on each poll tick.

use std::collections::HashMap;
use serde::Serialize;

// ── Conversion constants ─────────────────────────────────────────────────────

/// Grams of CO₂ per MB of data transferred (conservative global average).
const GRAMS_CO2_PER_MB: f64 = 0.03;

/// Grams of CO₂ a mature tree absorbs per year (EPA).
const GRAMS_PER_TREE_PER_YEAR: f64 = 21_000.0;

// ── Data types ───────────────────────────────────────────────────────────────

/// Per-process carbon tracking entry returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessCarbonEntry {
    /// Display name of the process.
    pub name: String,
    /// Executable path.
    pub exe: String,
    /// Cumulative carbon footprint in grams (data that was allowed through).
    pub footprint_grams: f64,
    /// Cumulative carbon saved in grams (data that was blocked).
    pub saved_grams: f64,
}

/// Carbon statistics snapshot returned via Tauri command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarbonStats {
    /// Total grams of CO₂ saved by blocking network traffic (cumulative).
    pub carbon_saved_grams: f64,
    /// Total grams of CO₂ emitted by allowed network traffic (cumulative).
    pub carbon_footprint_grams: f64,
    /// Equivalent number of trees worth of CO₂ saved per year.
    pub trees_equivalent: f64,
    /// Per-process carbon breakdown.
    pub processes: Vec<ProcessCarbonEntry>,
}

// ── Internal per-process state ──────────────────────────────────────────────

#[derive(Debug, Clone)]
pub(crate) struct CarbonProcessState {
    /// Display name for the process.
    pub name: String,
    /// Executable path (original casing).
    pub exe: String,
    /// Cumulative bytes that were allowed (counted toward footprint).
    pub allowed_bytes: u64,
    /// Cumulative bytes that were blocked (counted toward saved).
    pub blocked_bytes: u64,
}

// ── CarbonTracker ────────────────────────────────────────────────────────────

/// Tracks cumulative carbon impact of network activity.
///
/// This is embedded in `NetworkEngine` and updated on each poll tick.
/// Every byte that a process sends/receives is classified as either
/// "allowed" (counted toward carbon footprint) or "blocked" (counted
/// toward carbon saved).
#[derive(Debug)]
pub struct CarbonTracker {
    /// Cumulative carbon footprint (g CO₂) from allowed network traffic.
    footprint_g: f64,
    /// Cumulative carbon saved (g CO₂) from blocked network traffic.
    saved_g: f64,
    /// Per-process state, keyed by lowercase exe path.
    per_process: HashMap<String, CarbonProcessState>,
}

impl CarbonTracker {
    pub fn new() -> Self {
        CarbonTracker {
            footprint_g: 0.0,
            saved_g: 0.0,
            per_process: HashMap::new(),
        }
    }

    /// Record a batch of bytes for a process, classifying them as allowed
    /// (footprint) or blocked (saved).
    pub fn record_bytes(
        &mut self,
        exe_path: &str,
        display_name: &str,
        bytes_transferred: u64,
        is_blocked: bool,
    ) {
        let mb = bytes_to_mb(bytes_transferred);
        let co2_g = mb * GRAMS_CO2_PER_MB;

        if is_blocked {
            self.saved_g += co2_g;
        } else {
            self.footprint_g += co2_g;
        }

        let key = exe_path.to_lowercase();
        let state = self.per_process.entry(key).or_insert_with(|| CarbonProcessState {
            name: display_name.to_string(),
            exe: exe_path.to_string(),
            allowed_bytes: 0,
            blocked_bytes: 0,
        });

        // Update display name in case it changed
        state.name = display_name.to_string();
        state.exe = exe_path.to_string();

        if is_blocked {
            state.blocked_bytes = state.blocked_bytes.saturating_add(bytes_transferred);
        } else {
            state.allowed_bytes = state.allowed_bytes.saturating_add(bytes_transferred);
        }
    }

    /// Get a snapshot of current carbon statistics for the frontend.
    pub fn get_stats(&self) -> CarbonStats {
        let processes: Vec<ProcessCarbonEntry> = self
            .per_process
            .values()
            .map(|s| {
                let footprint_mb = bytes_to_mb(s.allowed_bytes);
                let saved_mb = bytes_to_mb(s.blocked_bytes);
                ProcessCarbonEntry {
                    name: s.name.clone(),
                    exe: s.exe.clone(),
                    footprint_grams: footprint_mb * GRAMS_CO2_PER_MB,
                    saved_grams: saved_mb * GRAMS_CO2_PER_MB,
                }
            })
            .collect();

        CarbonStats {
            carbon_saved_grams: round2(self.saved_g),
            carbon_footprint_grams: round2(self.footprint_g),
            trees_equivalent: round2(self.saved_g / GRAMS_PER_TREE_PER_YEAR),
            processes,
        }
    }

    /// Reset all carbon tracking data.
    pub fn reset(&mut self) {
        self.footprint_g = 0.0;
        self.saved_g = 0.0;
        self.per_process.clear();
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn bytes_to_mb(bytes: u64) -> f64 {
    bytes as f64 / (1024.0 * 1024.0)
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
