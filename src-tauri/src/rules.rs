//! Rules Engine — high-performance Ruleset & Auto-Block System.
//!
//! Architecture:
//!  - `RulesManager` is the thread-safe singleton registered as Tauri managed state.
//!  - Rules are stored in a `HashMap<String, Rule>` behind a `Mutex`.
//!  - An `AutoBlockRegistry` (`HashSet<String>`) is maintained as a flat O(1) lookup
//!    cache of all lowercase target executable names from all *enabled* rules.
//!  - Persistence is done asynchronously to `rules.json` in the AppData directory.
//!
//! Thread-safety contract:
//!  - All state is behind `Mutex` — short-lived locks only.
//!  - The registry is rebuilt atomically on every rule toggle.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

// ──────────────────────────── data types ─────────────────────────────────────

/// Risk level associated with a rule.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum Risk {
    #[serde(rename = "high")]
    High,
    #[serde(rename = "medium")]
    Medium,
    #[serde(rename = "low")]
    Low,
}

/// A single rule definition with its targets and telemetry data.
///
/// `data_blocked_bytes` tracks the cumulative number of bytes blocked as a
/// result of this rule since the counter was last reset. The front-end converts
/// this raw u64 into human-readable units (KB, MB, GB).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub risk: Risk,
    /// Executable / DLL names this rule targets (lowercase e.g. `"tiworker.exe"`).
    pub targets: Vec<String>,
    /// Cumulative bytes blocked by this rule.
    pub data_blocked_bytes: u64,
}

// ──────────────────────────── RulesManager ───────────────────────────────────

/// Thread-safe manager of all rules and the flat AutoBlockRegistry.
pub struct RulesManager {
    /// All known rules indexed by their string id.
    rules: Mutex<HashMap<String, Rule>>,
    /// Flat O(1) lookup cache: lowercase executable names from all *enabled* rules.
    auto_block_registry: Mutex<HashSet<String>>,
    /// Filesystem path to persist `rules.json`.
    persist_path: Mutex<PathBuf>,
}

impl RulesManager {
    /// Create a new `RulesManager` with a sensible default persist path.
    ///
    /// On Windows it uses `%LOCALAPPDATA%/com.tauri.dev/rules.json`;
    /// falls back to `rules.json` in the current directory.
    ///
    /// If a `rules.json` exists at that path it is loaded; otherwise the manager
    /// is initialised with a sensible set of default rules matching the original
    /// mock data in `RulesControls.tsx`.
    pub fn new() -> Self {
        let persist_path = Self::default_persist_path();
        Self::new_with_path(persist_path)
    }

    /// Create a new `RulesManager` rooted at the given persist path.
    pub fn new_with_path(persist_path: PathBuf) -> Self {
        let manager = RulesManager {
            rules: Mutex::new(HashMap::new()),
            auto_block_registry: Mutex::new(HashSet::new()),
            persist_path: Mutex::new(persist_path),
        };
        manager.load_or_init();
        manager
    }

    /// Resolve a default filesystem path for persisting `rules.json`.
    fn default_persist_path() -> PathBuf {
        // On Windows use %LOCALAPPDATA% (roaming user profile).
        if let Ok(dir) = std::env::var("LOCALAPPDATA") {
            PathBuf::from(dir).join("com.tauri.dev").join("rules.json")
        } else if let Ok(dir) = std::env::var("APPDATA") {
            PathBuf::from(dir).join("com.tauri.dev").join("rules.json")
        } else {
            PathBuf::from("rules.json")
        }
    }

    // ── initialisation ─────────────────────────────────────────────────────

    /// Attempt to deserialise rules from disk.  On any failure, fall back to
    /// the built-in default set.
    fn load_or_init(&self) {
        let path = self.persist_path.lock().unwrap().clone();
        if path.exists() {
            match std::fs::read_to_string(&path) {
                Ok(data) => match serde_json::from_str::<Vec<Rule>>(&data) {
                    Ok(rules_vec) => {
                        let mut map = HashMap::new();
                        for rule in rules_vec {
                            map.insert(rule.id.clone(), rule);
                        }
                        *self.rules.lock().unwrap() = map;
                        self.rebuild_registry();
                        return;
                    }
                    Err(e) => log::warn!("Failed to parse rules.json: {e} — recreating defaults"),
                },
                Err(e) => log::warn!("Failed to read rules.json: {e} — recreating defaults"),
            }
        }
        self.init_defaults();
    }

    /// Populate the manager with the canonical set of default rules.
    fn init_defaults(&self) {
        let defaults = vec![
            // ── OS-Level Rules ──────────────────────────────────────────
            Rule {
                id: "windows-update".into(),
                name: "Windows Update".into(),
                description: "Background OS update downloads and delta patches".into(),
                enabled: true,
                risk: Risk::High,
                targets: vec![
                    "wuauserv.dll".into(),
                    "wuaueng.dll".into(),
                    "TrustedInstaller.exe".into(),
                ],
                data_blocked_bytes: 1_200_000_000, // 1.2 GB
            },
            Rule {
                id: "delivery-opt".into(),
                name: "Delivery Optimization".into(),
                description: "P2P update sharing with other Windows devices".into(),
                enabled: true,
                risk: Risk::High,
                targets: vec!["dosvc.dll".into(), "DeliveryOptimization.exe".into()],
                data_blocked_bytes: 420_000_000, // 420 MB
            },
            Rule {
                id: "windows-store".into(),
                name: "Microsoft Store".into(),
                description: "App auto-updates from the Windows Store".into(),
                enabled: true,
                risk: Risk::Medium,
                targets: vec!["winstore.app.exe".into(), "WinStore.App.exe".into()],
                data_blocked_bytes: 180_000_000, // 180 MB
            },
            Rule {
                id: "telemetry".into(),
                name: "Telemetry & Diagnostics".into(),
                description: "Windows diagnostic data uploads to Microsoft servers".into(),
                enabled: false,
                risk: Risk::Low,
                targets: vec!["diagtrack.dll".into(), "CompatTelRunner.exe".into()],
                data_blocked_bytes: 28_000_000, // 28 MB
            },
            // ── Application Rules ───────────────────────────────────────
            Rule {
                id: "chrome-update".into(),
                name: "Chrome / Brave Updater".into(),
                description: "Background browser binary auto-update service".into(),
                enabled: true,
                risk: Risk::Medium,
                targets: vec!["chrome.exe".into(), "brave.exe".into(), "chromium.exe".into()],
                data_blocked_bytes: 240_000_000, // 240 MB
            },
            Rule {
                id: "onedrive".into(),
                name: "OneDrive Sync".into(),
                description: "Automatic file synchronization to cloud storage".into(),
                enabled: true,
                risk: Risk::High,
                targets: vec!["onedrive.exe".into()],
                data_blocked_bytes: 680_000_000, // 680 MB
            },
            Rule {
                id: "dropbox".into(),
                name: "Dropbox Sync".into(),
                description: "Background Dropbox file sync and indexing".into(),
                enabled: false,
                risk: Risk::Medium,
                targets: vec!["dropbox.exe".into()],
                data_blocked_bytes: 110_000_000, // 110 MB
            },
            Rule {
                id: "teams-update".into(),
                name: "Microsoft Teams".into(),
                description: "Teams background auto-updates and presence sync".into(),
                enabled: true,
                risk: Risk::Medium,
                targets: vec!["teams.exe".into(), "ms-teams.exe".into()],
                data_blocked_bytes: 95_000_000, // 95 MB
            },
        ];

        let mut map = HashMap::new();
        for rule in defaults {
            map.insert(rule.id.clone(), rule);
        }
        *self.rules.lock().unwrap() = map;
        self.rebuild_registry();
        self.persist();
    }

    // ── registry management ─────────────────────────────────────────────

    /// Rebuild the flat `AutoBlockRegistry` from all currently-enabled rules.
    ///
    /// Called automatically after every `toggle_rule` and on init.  The registry
    /// is a simple `HashSet<String>` of lowercase target names, enabling O(1)
    /// membership checks for the WFP intercept loop.
    fn rebuild_registry(&self) {
        let rules = self.rules.lock().unwrap();
        let mut registry = HashSet::new();
        for rule in rules.values() {
            if rule.enabled {
                for target in &rule.targets {
                    registry.insert(target.to_lowercase());
                }
            }
        }
        *self.auto_block_registry.lock().unwrap() = registry;
    }

    // ── persistence ─────────────────────────────────────────────────────

    /// Write the current set of rules to `rules.json` inside AppData.
    fn persist(&self) {
        let path = {
            let guard = self.persist_path.lock().unwrap();
            guard.clone()
        };
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                let _ = std::fs::create_dir_all(parent);
            }
        }
        let rules = self.rules.lock().unwrap();
        let rules_vec: Vec<&Rule> = rules.values().collect();
        match serde_json::to_string_pretty(&rules_vec) {
            Ok(data) => {
                if let Err(e) = std::fs::write(&path, &data) {
                    log::error!("Failed to persist rules.json: {e}");
                }
            }
            Err(e) => log::error!("Failed to serialise rules: {e}"),
        }
    }

    // ── public query API ────────────────────────────────────────────────

    /// Return all rules, sorted in the canonical display order (OS rules first,
    /// then application rules, each group in the original definition order).
    pub fn get_all_rules(&self) -> Vec<Rule> {
        let rules = self.rules.lock().unwrap();
        let mut vec: Vec<Rule> = rules.values().cloned().collect();

        // Canonical sort order matching the mock UI layout.
        let order: &[&str] = &[
            "windows-update",
            "delivery-opt",
            "windows-store",
            "telemetry",
            "chrome-update",
            "onedrive",
            "dropbox",
            "teams-update",
        ];
        vec.sort_by(|a, b| {
            let ai = order.iter().position(|id| *id == a.id).unwrap_or(usize::MAX);
            let bi = order.iter().position(|id| *id == b.id).unwrap_or(usize::MAX);
            ai.cmp(&bi)
        });
        vec
    }

    /// Toggle the `enabled` state of a rule and rebuild the registry.
    ///
    /// Returns `Err` if the rule id is unknown.
    pub fn toggle_rule(&self, id: &str, enabled: bool) -> Result<(), String> {
        {
            let mut rules = self
                .rules
                .lock()
                .map_err(|e| format!("Rules lock poisoned: {e}"))?;
            let rule = rules
                .get_mut(id)
                .ok_or_else(|| format!("Rule '{id}' not found"))?;
            rule.enabled = enabled;
        } // MutexGuard dropped here
        self.rebuild_registry();
        self.persist();
        Ok(())
    }

    /// Increment the `data_blocked_bytes` counter for a rule.  Called by the
    /// engine when it detects a blocked connection matching this rule's targets.
    pub fn add_blocked_bytes(&self, id: &str, bytes: u64) {
        if let Ok(mut rules) = self.rules.lock() {
            if let Some(rule) = rules.get_mut(id) {
                rule.data_blocked_bytes = rule.data_blocked_bytes.saturating_add(bytes);
            }
        }
    }

    /// Return a snapshot of the AutoBlockRegistry for O(1) lookups.
    /// The caller can check exe name membership without holding the lock.
    pub fn get_registry_snapshot(&self) -> HashSet<String> {
        self.auto_block_registry.lock().unwrap().clone()
    }

    /// O(1) check — is the given executable name (case-insensitive) in the
    /// block registry?
    pub fn is_target_blocked(&self, exe_name: &str) -> bool {
        let registry = self.auto_block_registry.lock().unwrap();
        registry.contains(&exe_name.to_lowercase())
    }

    /// Delete a rule by id. Removes it from the map, rebuilds the registry,
    /// persists, and returns the deleted rule&#x27;s data.
    ///
    /// Returns `Err` if the rule id is unknown.
    pub fn delete_rule(&self, id: &str) -> Result<Rule, String> {
        let rule = {
            let mut rules = self
                .rules
                .lock()
                .map_err(|e| format!("Rules lock poisoned: {e}"))?;
            rules
                .remove(id)
                .ok_or_else(|| format!("Rule '{id}' not found"))?
        };
        self.rebuild_registry();
        self.persist();
        Ok(rule)
    }

    /// Add a new custom rule with the given parameters.
    ///
    /// Generates a unique id from the name (slugified), validates that targets
    /// are non-empty, inserts the rule, rebuilds the registry, and persists.
    pub fn add_rule(
        &self,
        name: String,
        description: String,
        risk: Risk,
        targets: Vec<String>,
    ) -> Result<Rule, String> {
        if name.trim().is_empty() {
            return Err("Rule name cannot be empty".into());
        }
        if targets.is_empty() {
            return Err("At least one target executable is required".into());
        }

        // Slugify the name to create a stable id
        let id = name
            .to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
            .filter(|&c| c != ' ')
            .collect::<String>();

        let rule = Rule {
            id,
            name: name.trim().to_string(),
            description: description.trim().to_string(),
            enabled: true,
            risk,
            targets: targets.into_iter().map(|t| t.trim().to_lowercase()).collect(),
            data_blocked_bytes: 0,
        };

        {
            let mut rules = self
                .rules
                .lock()
                .map_err(|e| format!("Rules lock poisoned: {e}"))?;
            rules.insert(rule.id.clone(), rule.clone());
        }

        self.rebuild_registry();
        self.persist();
        Ok(rule)
    }
}

// The compiler will not auto-derive Debug because of Mutex, so we manual impl.
impl std::fmt::Debug for RulesManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RulesManager")
            .field("rules_count", &self.rules.lock().map(|r| r.len()).unwrap_or(0))
            .field("registry_size", &self.auto_block_registry.lock().map(|r| r.len()).unwrap_or(0))
            .field("persist_path", &self.persist_path.lock().unwrap().clone())
            .finish()
    }
}
