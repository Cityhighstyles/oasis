//! Sandbox Engine — real-time process command detection, Groq AI download
//! estimation, and transparent overlay webview window management.
//!
//! Architecture:
//!  - `SandboxEngine` is registered as Tauri managed state behind `Arc<Mutex<>>`.
//!  - A background polling thread scans the Windows process table every 2 s.
//!  - When a supported command is detected (npm install, docker pull, etc.)
//!    it is stored in the engine and emitted as a Tauri event.
//!  - The Groq API client predicts download sizes based on the command and
//!    any available metadata (e.g. package.json contents).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use log;
use std::process::Command as StdCommand;

// ── Supported command types ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CommandType {
    // ── JavaScript / Node.js ────────────────────────────────────────
    NpmInstall,
    PnpmInstall,
    YarnInstall,
    NpxRun,
    // ── Containers ────────────────────────────────────────────────
    DockerPull,
    DockerBuild,
    DockerCompose,
    // ── Version control ────────────────────────────────────────────
    GitClone,
    GitPull,
    GitFetch,
    // ── VS Code ───────────────────────────────────────────────────
    VscodeExtInstall,
    VscodeExtUpdate,
    // ── Python ────────────────────────────────────────────────────
    PipInstall,
    PipenvInstall,
    PoetryInstall,
    // ── Rust ──────────────────────────────────────────────────────
    CargoInstall,
    CargoBuild,
    CargoTest,
    // ── Windows package managers ───────────────────────────────────
    WingetInstall,
    ChocoInstall,
    ScoopInstall,
    // ── Linux / cross-platform ─────────────────────────────────────
    BrewInstall,
    AptGetInstall,
    // ── .NET ───────────────────────────────────────────────────────
    NugetInstall,
    DotnetRestore,
    DotnetBuild,
    // ── Go ─────────────────────────────────────────────────────────
    GoModDownload,
    GoInstall,
    GoBuild,
    // ── Java / JVM ─────────────────────────────────────────────────
    MavenBuild,
    GradleBuild,
    AndroidStudioDownload,
    // ── Catch-all ──────────────────────────────────────────────────
    Other(String),
}

impl CommandType {
    /// Human-readable label for the frontend.
    pub fn label(&self) -> &str {
        match self {
            CommandType::NpmInstall => "npm install",
            CommandType::PnpmInstall => "pnpm install",
            CommandType::YarnInstall => "yarn install",
            CommandType::NpxRun => "npx run",
            CommandType::DockerPull => "docker pull",
            CommandType::DockerBuild => "docker build",
            CommandType::DockerCompose => "docker compose",
            CommandType::GitClone => "git clone",
            CommandType::GitPull => "git pull",
            CommandType::GitFetch => "git fetch",
            CommandType::VscodeExtInstall => "VS Code Extension Install",
            CommandType::VscodeExtUpdate => "VS Code Extension Update",
            CommandType::PipInstall => "pip install",
            CommandType::PipenvInstall => "pipenv install",
            CommandType::PoetryInstall => "poetry install",
            CommandType::CargoInstall => "cargo install",
            CommandType::CargoBuild => "cargo build",
            CommandType::CargoTest => "cargo test",
            CommandType::WingetInstall => "winget install",
            CommandType::ChocoInstall => "choco install",
            CommandType::ScoopInstall => "scoop install",
            CommandType::BrewInstall => "brew install",
            CommandType::AptGetInstall => "apt-get install",
            CommandType::NugetInstall => "nuget install",
            CommandType::DotnetRestore => "dotnet restore",
            CommandType::DotnetBuild => "dotnet build",
            CommandType::GoModDownload => "go mod download",
            CommandType::GoInstall => "go install",
            CommandType::GoBuild => "go build",
            CommandType::MavenBuild => "maven build",
            CommandType::GradleBuild => "Gradle build",
            CommandType::AndroidStudioDownload => "Android Studio Download",
            CommandType::Other(s) => s.as_str(),
        }
    }

    /// Icon identifier for the frontend.
    pub fn icon(&self) -> &str {
        match self {
            CommandType::NpmInstall | CommandType::PnpmInstall
                | CommandType::YarnInstall | CommandType::NpxRun => "package",
            CommandType::DockerPull | CommandType::DockerBuild
                | CommandType::DockerCompose => "container",
            CommandType::GitClone | CommandType::GitPull
                | CommandType::GitFetch => "git-branch",
            CommandType::VscodeExtInstall | CommandType::VscodeExtUpdate => "puzzle",
            CommandType::PipInstall | CommandType::PipenvInstall
                | CommandType::PoetryInstall => "snake",
            CommandType::CargoInstall | CommandType::CargoBuild
                | CommandType::CargoTest => "crab",
            CommandType::WingetInstall | CommandType::ChocoInstall
                | CommandType::ScoopInstall => "download",
            CommandType::BrewInstall => "beer",
            CommandType::AptGetInstall => "linux",
            CommandType::NugetInstall | CommandType::DotnetRestore
                | CommandType::DotnetBuild => "dotnet",
            CommandType::GoModDownload | CommandType::GoInstall
                | CommandType::GoBuild => "globe",
            CommandType::MavenBuild | CommandType::GradleBuild => "hard-hat",
            CommandType::AndroidStudioDownload => "bot",
            CommandType::Other(_) => "terminal",
        }
    }
}

// ── Detected operation ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedOperation {
    pub id: String,
    pub command_type: CommandType,
    pub command_line: String,
    pub executable: String,
    pub pid: u32,
    pub detected_at: String,
    pub estimated_mb: f64,
    pub estimated_range_min_mb: f64,
    pub estimated_range_max_mb: f64,
    pub confidence: f64,
    pub status: String,
    pub package_name: String,
    pub working_dir: String,
    pub ai_reasoning: String,
}

// ── Groq AI response types ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct GroqResponse {
    choices: Vec<GroqChoice>,
}

#[derive(Debug, Deserialize)]
struct GroqChoice {
    message: GroqMessage,
}

#[derive(Debug, Deserialize)]
struct GroqMessage {
    content: String,
}

#[derive(Debug, Serialize)]
struct GroqRequest {
    model: String,
    messages: Vec<GroqChatMessage>,
    response_format: GroqResponseFormat,
}

#[derive(Debug, Serialize)]
struct GroqChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct GroqResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
    json_schema: GroqJsonSchema,
}

#[derive(Debug, Serialize)]
struct GroqJsonSchema {
    name: String,
    strict: bool,
    schema: serde_json::Value,
}

// ── Sandbox engine state ──────────────────────────────────────────────────

/// Thread-safe engine that tracks detected developer operations.
pub struct SandboxEngine {
    /// Detected operations, newest first.
    pub detected_operations: Vec<DetectedOperation>,
    /// Map PID -> executable name to detect NEW processes.
    known_pids: HashMap<u32, String>,
    /// When the scanner last ran (for rate limiting).
    last_scan: Instant,
    /// Groq API key (set via env var or frontend).
    groq_api_key: Option<String>,
    /// Whether the sandbox scanner is actively running.
    pub is_running: bool,
    /// Counter for generating IDs.
    id_counter: u64,
}

impl SandboxEngine {
    pub fn new() -> Self {
        SandboxEngine {
            detected_operations: Vec::new(),
            known_pids: HashMap::new(),
            last_scan: Instant::now(),
            groq_api_key: std::env::var("GROQ_API_KEY").ok(),
            is_running: false,
            id_counter: 0,
        }
    }

    /// Set or update the Groq API key.
    pub fn set_groq_api_key(&mut self, key: String) {
        self.groq_api_key = Some(key);
    }

    /// Check if Groq API key is configured.
    pub fn has_groq_key(&self) -> bool {
        self.groq_api_key.is_some()
    }

    /// Get a reference to the Groq API key.
    pub fn groq_api_key_ref(&self) -> Option<&str> {
        self.groq_api_key.as_deref()
    }

    /// Return cloned list of detected operations (newest first).
    pub fn get_operations(&self) -> Vec<DetectedOperation> {
        let mut ops = self.detected_operations.clone();
        ops.reverse();
        ops
    }

    /// Clear all detected operations.
    pub fn clear_operations(&mut self) {
        self.detected_operations.clear();
        self.known_pids.clear();
    }

    /// Run one scan of the process table. Returns any newly detected operations.
    /// Now fetches command lines for new processes so we can refine classification
    /// (e.g. distinguish "npm install" from "npm run build").
    pub fn scan(&mut self) -> Vec<DetectedOperation> {
        self.last_scan = Instant::now();
        let current_processes = Self::enumerate_processes();
        let mut new_ops = Vec::new();
        // Track newly-found PIDs that need command-line lookup
        let mut pids_needing_cmdline: Vec<u32> = Vec::new();

        for (pid, exe_name, _exe_path) in &current_processes {
            let known = self.known_pids.get(pid).map(|s| s.as_str());
            if known != Some(exe_name.as_str()) {
                // New process — check if it's a known executable
                if is_supported_exe(exe_name) {
                    pids_needing_cmdline.push(*pid);
                }
            }
            // Always update known PIDs
            self.known_pids.insert(*pid, exe_name.clone());
        }

        // Fetch command lines for new supported processes (batch via PowerShell)
        let cmdlines = if !pids_needing_cmdline.is_empty() {
            Self::fetch_command_lines(&pids_needing_cmdline)
        } else {
            HashMap::new()
        };

        // Now classify each new process with its command line
        for (pid, exe_name, _exe_path) in &current_processes {
            // Only process newly seen PIDs that are supported
            if !pids_needing_cmdline.contains(pid) {
                continue;
            }

            let cmdline = cmdlines.get(pid).cloned().unwrap_or_default();
            if let Some(cmd_type) = classify_process_cmdline(exe_name, &cmdline) {
                // Extract package name from command line if possible
                let package_name = extract_package_name(&cmd_type, &cmdline);

                self.id_counter += 1;
                let now = Local::now().format("%H:%M:%S%.3f").to_string();
                let op = DetectedOperation {
                    id: format!("op-{}", self.id_counter),
                    command_type: cmd_type.clone(),
                    command_line: cmdline,
                    executable: exe_name.clone(),
                    pid: *pid,
                    detected_at: now,
                    estimated_mb: 0.0,
                    estimated_range_min_mb: 0.0,
                    estimated_range_max_mb: 0.0,
                    confidence: 0.0,
                    status: "detected".to_string(),
                    package_name,
                    working_dir: String::new(),
                    ai_reasoning: String::new(),
                };
                self.detected_operations.push(op.clone());
                new_ops.push(op);
            }
        }

        // Clean up stale PIDs
        let current_pids: std::collections::HashSet<u32> =
            current_processes.iter().map(|(pid, _, _)| *pid).collect();
        self.known_pids.retain(|pid, _| current_pids.contains(pid));

        new_ops
    }

    /// Enumerate all running processes via Toolhelp32Snapshot (Windows).
    #[cfg(target_os = "windows")]
    fn enumerate_processes() -> Vec<(u32, String, String)> {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32First, Process32Next, TH32CS_SNAPPROCESS,
            PROCESSENTRY32,
        };

        let mut processes = Vec::new();
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return processes;
            }

            let mut entry: PROCESSENTRY32 = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32>() as u32;

            if Process32First(snapshot, &mut entry as *mut PROCESSENTRY32) == 0 {
                CloseHandle(snapshot);
                return processes;
            }

            loop {
                // szExeFile is [i8; 260] in windows-sys (ANSI), convert to String
                let exe_cstr = std::ffi::CStr::from_ptr(entry.szExeFile.as_ptr());
                let exe_name = exe_cstr.to_string_lossy().to_string();
                let pid = entry.th32ProcessID;

                // Get full path (may be empty if API unavailable)
                let exe_path = Self::get_process_path(pid);

                processes.push((pid, exe_name, exe_path));

                if Process32Next(snapshot, &mut entry as *mut PROCESSENTRY32) == 0 {
                    break;
                }
            }

            CloseHandle(snapshot);
        }
        processes
    }

    #[cfg(not(target_os = "windows"))]
    fn enumerate_processes() -> Vec<(u32, String, String)> {
        // Non-Windows stub — return empty
        vec![]
    }

    #[cfg(target_os = "windows")]
    fn get_process_path(pid: u32) -> String {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return String::new();
            }
            // Full path via QueryFullProcessImageNameW isn't available in
            // windows-sys 0.61 — the exe name from the snapshot is sufficient.
            CloseHandle(handle);
        }
        String::new()
    }

    #[cfg(not(target_os = "windows"))]
    fn get_process_path(_pid: u32) -> String {
        String::new()
    }

    // ── Command-line fetching via PowerShell (Windows) ───────────────────

    /// Batch-fetch command lines for a set of PIDs using PowerShell / WMI.
    /// Returns a map of PID → command_line string.
    #[cfg(target_os = "windows")]
    fn fetch_command_lines(pids: &[u32]) -> HashMap<u32, String> {
        if pids.is_empty() {
            return HashMap::new();
        }

        // Build a comma-separated PID list for PowerShell
        let pid_list: Vec<String> = pids.iter().map(|p| p.to_string()).collect();
        let pid_filter = pid_list.join(",");

        let script = format!(
            r#"Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -in ({0}) }} | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"#,
            pid_filter
        );

        let output = StdCommand::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output();

        let mut result = HashMap::new();

        match output {
            Ok(out) if out.status.success() => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let trimmed = stdout.trim();
                if trimmed.is_empty() || trimmed == "null" {
                    return result;
                }

                // PowerShell returns either a single object or an array
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    let entries = match &parsed {
                        serde_json::Value::Array(arr) => arr.clone(),
                        serde_json::Value::Object(_) => vec![parsed.clone()],
                        _ => return result,
                    };

                    for entry in entries {
                        if let Some(obj) = entry.as_object() {
                            let pid = obj.get("ProcessId")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0) as u32;
                            let cmdline = obj.get("CommandLine")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if pid > 0 {
                                result.insert(pid, cmdline);
                            }
                        }
                    }
                }
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                log::warn!("PowerShell command failed (exit {}): {}", out.status.code().unwrap_or(-1), stderr);
            }
            Err(e) => {
                log::warn!("Failed to run PowerShell: {e}");
            }
        }

        result
    }

    #[cfg(not(target_os = "windows"))]
    fn fetch_command_lines(_pids: &[u32]) -> HashMap<u32, String> {
        HashMap::new()
    }

    /// Call Groq AI to predict download size for a detected operation.
    /// Returns (estimated_mb, range_min_mb, range_max_mb, confidence, reasoning)
    pub async fn predict_download_size(&self, op: &DetectedOperation) -> Option<(f64, f64, f64, f64, String)> {
        let api_key = self.groq_api_key_ref()?.to_string();

        let prompt = format!(
            r#"You are a download size estimator for developer tools.
Given this command type and executable name, predict the total download size in megabytes (MB).

Command type: {command_type}
Executable: {executable}

Respond with a JSON object containing:
- estimated_mb: best estimate in MB
- range_min_mb: minimum likely download in MB  
- range_max_mb: maximum likely download in MB
- confidence: 0.0 to 1.0 confidence score
- reasoning: short explanation for the estimate"#,
            command_type = op.command_type.label(),
            executable = op.executable,
        );

        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "estimated_mb": { "type": "number" },
                "range_min_mb": { "type": "number" },
                "range_max_mb": { "type": "number" },
                "confidence": { "type": "number" },
                "reasoning": { "type": "string" }
            },
            "required": ["estimated_mb", "range_min_mb", "range_max_mb", "confidence", "reasoning"],
            "additionalProperties": false
        });

        let request = GroqRequest {
            model: "llama-3.3-70b-versatile".to_string(),
            messages: vec![GroqChatMessage {
                role: "user".to_string(),
                content: prompt,
            }],
            response_format: GroqResponseFormat {
                format_type: "json_schema".to_string(),
                json_schema: GroqJsonSchema {
                    name: "download_estimate".to_string(),
                    strict: true,
                    schema,
                },
            },
        };

        let client = reqwest::Client::new();
        let response = client
            .post("https://api.groq.com/openai/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .ok()?;

        let groq_resp: GroqResponse = response.json().await.ok()?;
        let content = groq_resp.choices.first()?.message.content.clone();

        // Parse the JSON response
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
            let estimated = parsed.get("estimated_mb").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let range_min = parsed.get("range_min_mb").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let range_max = parsed.get("range_max_mb").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let conf = parsed.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let reasoning = parsed.get("reasoning").and_then(|v| v.as_str()).map(|s| s.to_string()).unwrap_or_default();
            Some((estimated, range_min, range_max, conf, reasoning))
        } else {
            None
        }
    }

    /// Estimate download size locally (fallback when no Groq API key).
    pub fn local_estimate(&self, cmd_type: &CommandType) -> (f64, f64, f64, f64, String) {
        match cmd_type {
            // ── JS / Node ──────────────────────────────────────────────────
            CommandType::NpmInstall => (15.0, 1.0, 200.0, 0.5,
                "npm install: single packages ~1MB, large projects with dependencies up to 200MB".into()),
            CommandType::PnpmInstall => (12.0, 1.0, 180.0, 0.5,
                "pnpm install: typically smaller than npm due to content-addressable storage".into()),
            CommandType::YarnInstall => (14.0, 1.0, 190.0, 0.5,
                "yarn install: similar to npm, ranges from 1MB to ~190MB".into()),
            CommandType::NpxRun => (5.0, 0.1, 100.0, 0.3,
                "npx run: downloads and caches the specified package ephemerally".into()),
            // ── Docker ────────────────────────────────────────────────────
            CommandType::DockerPull => (300.0, 10.0, 2000.0, 0.4,
                "Docker images: alpine ~10MB, Ubuntu ~200MB, ML images ~2GB+".into()),
            CommandType::DockerBuild => (100.0, 5.0, 1000.0, 0.3,
                "Docker builds pull base layers and add build artifacts".into()),
            CommandType::DockerCompose => (200.0, 10.0, 1500.0, 0.3,
                "docker compose pulls all services defined in compose file".into()),
            // ── Git ───────────────────────────────────────────────────────
            CommandType::GitClone => (50.0, 0.1, 500.0, 0.5,
                "Git clones: small repos ~100KB, monorepos ~500MB".into()),
            CommandType::GitPull => (5.0, 0.01, 100.0, 0.6,
                "git pull: downloads only new commits and objects".into()),
            CommandType::GitFetch => (3.0, 0.01, 80.0, 0.6,
                "git fetch: downloads new refs and objects without merging".into()),
            // ── VS Code ───────────────────────────────────────────────────
            CommandType::VscodeExtInstall => (5.0, 0.5, 50.0, 0.6,
                "VS Code extensions average 2-10MB, some with language servers up to 50MB".into()),
            CommandType::VscodeExtUpdate => (3.0, 0.5, 30.0, 0.6,
                "Extension updates are typically smaller than full installs".into()),
            // ── Python ────────────────────────────────────────────────────
            CommandType::PipInstall => (10.0, 0.5, 150.0, 0.5,
                "pip install: small pure-Python packages to large ML libs (torch ~150MB)".into()),
            CommandType::PipenvInstall => (12.0, 1.0, 160.0, 0.5,
                "pipenv install: installs from Pipfile.lock, similar to pip ranges".into()),
            CommandType::PoetryInstall => (11.0, 1.0, 150.0, 0.5,
                "poetry install: installs from poetry.lock, similar range to pip".into()),
            // ── Rust ──────────────────────────────────────────────────────
            CommandType::CargoInstall => (20.0, 1.0, 200.0, 0.4,
                "cargo install: downloads + compiles crate; ripgrep ~5MB, game engines ~200MB".into()),
            CommandType::CargoBuild => (30.0, 1.0, 500.0, 0.3,
                "cargo build: downloads and compiles all dependencies from scratch".into()),
            CommandType::CargoTest => (25.0, 1.0, 400.0, 0.3,
                "cargo test: same as build but also compiles test binaries".into()),
            // ── Windows package managers ───────────────────────────────────
            CommandType::WingetInstall => (50.0, 1.0, 500.0, 0.4,
                "winget install: downloads application installer; varies by app size".into()),
            CommandType::ChocoInstall => (40.0, 1.0, 400.0, 0.4,
                "choco install: downloads package + dependencies".into()),
            CommandType::ScoopInstall => (30.0, 1.0, 300.0, 0.4,
                "scoop install: portable apps with varying download sizes".into()),
            // ── Linux / cross-platform ─────────────────────────────────────
            CommandType::BrewInstall => (25.0, 1.0, 300.0, 0.4,
                "brew install: downloads formula + dependencies from source/bottles".into()),
            CommandType::AptGetInstall => (30.0, 1.0, 400.0, 0.4,
                "apt-get install: downloads .deb packages + dependencies".into()),
            // ── .NET ───────────────────────────────────────────────────────
            CommandType::NugetInstall => (10.0, 0.5, 100.0, 0.5,
                "nuget install: downloads NuGet packages + dependencies".into()),
            CommandType::DotnetRestore => (15.0, 1.0, 200.0, 0.4,
                "dotnet restore: downloads NuGet dependencies defined in project".into()),
            CommandType::DotnetBuild => (20.0, 1.0, 300.0, 0.3,
                "dotnet build: restores + compiles; large solutions can pull 300MB+".into()),
            // ── Go ────────────────────────────────────────────────────────
            CommandType::GoModDownload => (10.0, 0.5, 150.0, 0.5,
                "go mod download: downloads module dependencies; ranges from small to monorepo-size".into()),
            CommandType::GoInstall => (8.0, 0.5, 100.0, 0.5,
                "go install: downloads + compiles a single Go tool".into()),
            CommandType::GoBuild => (12.0, 1.0, 200.0, 0.4,
                "go build: downloads deps + compiles; large projects up to 200MB".into()),
            // ── Java / JVM ─────────────────────────────────────────────────
            CommandType::MavenBuild => (100.0, 5.0, 500.0, 0.3,
                "mvn build: downloads all Maven dependencies; large projects ~500MB".into()),
            CommandType::GradleBuild => (150.0, 10.0, 500.0, 0.3,
                "Gradle build: downloads Gradle wrapper + dependencies; Android heaviest".into()),
            CommandType::AndroidStudioDownload => (800.0, 500.0, 1500.0, 0.7,
                "Android Studio + SDK components: typically 500MB - 1.5GB".into()),
            // ── Catch-all ──────────────────────────────────────────────────
            CommandType::Other(_) => (50.0, 1.0, 500.0, 0.2,
                "Unknown operation — generic estimate".into()),
        }
    }
}

// ── Process classification ────────────────────────────────────────────────

/// Quick check: is this executable name one we care about?
/// Used to avoid expensive PowerShell calls for irrelevant processes.
fn is_supported_exe(exe_name: &str) -> bool {
    let lower = exe_name.to_lowercase();
    matches!(
        lower.as_str(),
        "node.exe" | "node"
            | "npm.exe" | "npm"
            | "pnpm.exe" | "pnpm"
            | "yarn.exe" | "yarn"
            | "npx.exe" | "npx"
            | "docker.exe" | "docker"
            | "git.exe" | "git"
            | "code.exe" | "code"
            | "pip.exe" | "pip" | "pip3.exe" | "pip3"
            | "pipenv.exe" | "pipenv"
            | "poetry.exe" | "poetry"
            | "cargo.exe" | "cargo"
            | "rustc.exe" | "rustc"
            | "winget.exe" | "winget"
            | "choco.exe" | "chocolatey.exe"
            | "scoop.exe" | "scoop"
            | "brew.exe" | "brew"
            | "apt.exe" | "apt-get.exe"
            | "nuget.exe" | "nuget"
            | "dotnet.exe" | "dotnet"
            | "go.exe" | "go"
            | "mvn.exe" | "mvn" | "mvnw.bat" | "mvnw"
            | "gradle.exe" | "gradle" | "gradlew.bat" | "gradlew"
            | "studio64.exe" | "studio64" | "androidstudio.exe" | "androidstudio"
    )
}

/// Given an executable name AND its command line, classify the exact
/// developer operation (distinguishes "npm install" from "npm run build").
fn classify_process_cmdline(exe_name: &str, cmdline: &str) -> Option<CommandType> {
    let lower_exe = exe_name.to_lowercase();
    let lower_cmd = cmdline.to_lowercase();

    // Helper: check if the command line contains a keyword after the exe name
    let has_arg = |keyword: &str| lower_cmd.contains(keyword);

    // Helper: detect which package manager wraps around node.exe
    let pm_from_node_cmdline = || -> Option<CommandType> {
        if has_arg("pnpm") {
            if has_arg("install") || has_arg("add ") || has_arg("i ") { Some(CommandType::PnpmInstall) }
            else { Some(CommandType::PnpmInstall) }
        } else if has_arg("yarn") {
            if has_arg("install") || has_arg("add ") { Some(CommandType::YarnInstall) }
            else { Some(CommandType::YarnInstall) }
        } else if has_arg("npx") {
            Some(CommandType::NpxRun)
        } else if has_arg("npm") {
            if has_arg("install") || has_arg("i ") || has_arg("add ") || has_arg("ci") { Some(CommandType::NpmInstall) }
            else { Some(CommandType::NpmInstall) }
        } else {
            Some(CommandType::NpmInstall)
        }
    };

    match lower_exe.as_str() {
        // ── Node.js / npm / pnpm / yarn / npx ─────────────────────
        "node.exe" | "node" => pm_from_node_cmdline(),
        "npm.exe" | "npm" => {
            if has_arg("install") || has_arg("i ") || has_arg("add ") || has_arg("ci") {
                Some(CommandType::NpmInstall)
            } else {
                Some(CommandType::NpmInstall)
            }
        }
        "pnpm.exe" | "pnpm" => Some(CommandType::PnpmInstall),
        "yarn.exe" | "yarn" => Some(CommandType::YarnInstall),
        "npx.exe" | "npx" => Some(CommandType::NpxRun),

        // ── Docker ───────────────────────────────────────────────
        "docker.exe" | "docker" => {
            if has_arg("pull") && !has_arg("push") { Some(CommandType::DockerPull) }
            else if has_arg("build") || has_arg("compose build") { Some(CommandType::DockerBuild) }
            else if has_arg("compose") && !has_arg("build") { Some(CommandType::DockerCompose) }
            else if has_arg("pull") { Some(CommandType::DockerPull) }
            else { Some(CommandType::DockerBuild) }
        }

        // ── Git ──────────────────────────────────────────────────
        "git.exe" | "git" => {
            if has_arg("clone") { Some(CommandType::GitClone) }
            else if has_arg("pull") { Some(CommandType::GitPull) }
            else if has_arg("fetch") { Some(CommandType::GitFetch) }
            else { Some(CommandType::GitClone) }
        }

        // ── VS Code ──────────────────────────────────────────────
        "code.exe" | "code" => {
            if has_arg("--install-extension") { Some(CommandType::VscodeExtInstall) }
            else if has_arg("--update-extensions") || has_arg("--list-extensions") { Some(CommandType::VscodeExtUpdate) }
            else { Some(CommandType::VscodeExtInstall) }
        }

        // ── Python / pip ─────────────────────────────────────────
        "pip.exe" | "pip" | "pip3.exe" | "pip3" => {
            if has_arg("install") { Some(CommandType::PipInstall) }
            else { Some(CommandType::PipInstall) }
        }
        "pipenv.exe" | "pipenv" => Some(CommandType::PipenvInstall),
        "poetry.exe" | "poetry" => Some(CommandType::PoetryInstall),

        // ── Rust ─────────────────────────────────────────────────
        "cargo.exe" | "cargo" => {
            if has_arg("install") { Some(CommandType::CargoInstall) }
            else if has_arg("build") || has_arg("b ") { Some(CommandType::CargoBuild) }
            else if has_arg("test") || has_arg("t ") { Some(CommandType::CargoTest) }
            else { Some(CommandType::CargoBuild) }
        }
        "rustc.exe" | "rustc" => Some(CommandType::CargoBuild),

        // ── Windows package managers ─────────────────────────────
        "winget.exe" | "winget" => Some(CommandType::WingetInstall),
        "choco.exe" | "chocolatey.exe" => Some(CommandType::ChocoInstall),
        "scoop.exe" | "scoop" => Some(CommandType::ScoopInstall),

        // ── Linux / cross-platform ───────────────────────────────
        "brew.exe" | "brew" => Some(CommandType::BrewInstall),
        "apt.exe" | "apt-get.exe" => Some(CommandType::AptGetInstall),

        // ── .NET ─────────────────────────────────────────────────
        "nuget.exe" | "nuget" => Some(CommandType::NugetInstall),
        "dotnet.exe" | "dotnet" => {
            if has_arg("restore") { Some(CommandType::DotnetRestore) }
            else if has_arg("build") { Some(CommandType::DotnetBuild) }
            else { Some(CommandType::DotnetRestore) }
        }

        // ── Go ───────────────────────────────────────────────────
        "go.exe" | "go" => {
            if has_arg("mod download") || has_arg("mod tidy") { Some(CommandType::GoModDownload) }
            else if has_arg("install") { Some(CommandType::GoInstall) }
            else if has_arg("build") || has_arg("run") { Some(CommandType::GoBuild) }
            else { Some(CommandType::GoModDownload) }
        }

        // ── Java / JVM ───────────────────────────────────────────
        "mvn.exe" | "mvn" | "mvnw.bat" | "mvnw" => Some(CommandType::MavenBuild),
        "gradle.exe" | "gradle" | "gradlew.bat" | "gradlew" => Some(CommandType::GradleBuild),
        "studio64.exe" | "studio64" | "androidstudio.exe" | "androidstudio" => Some(CommandType::AndroidStudioDownload),

        _ => None,
    }
}

/// Attempt to extract a package/tool name from the command line.
/// e.g. "npm install express" → "express", "pip install torch" → "torch"
fn extract_package_name(cmd_type: &CommandType, cmdline: &str) -> String {
    if cmdline.is_empty() {
        return String::new();
    }
    let lower = cmdline.to_lowercase();

    // For install commands, try to grab the first argument after "install"
    let install_keywords = ["install", "add", "i "];
    for kw in &install_keywords {
        if let Some(pos) = lower.find(kw) {
            let after = &cmdline[pos + kw.len()..].trim();
            // Take the first word that isn't a flag
            let first_word = after.split_whitespace()
                .find(|w| !w.starts_with('-') && !w.starts_with('.'))
                .unwrap_or("");
            if !first_word.is_empty() {
                return first_word.to_string();
            }
        }
    }

    // For clone commands, extract the repo URL/name
    if matches!(cmd_type, CommandType::GitClone) {
        if let Some(pos) = lower.find("clone") {
            let after = &cmdline[pos + 5..].trim();
            let url = after.split_whitespace().next().unwrap_or("");
            // Extract the repo name from the URL
            let repo_name = url.rsplit('/').next().unwrap_or(url);
            let repo_name = repo_name.trim_end_matches(".git");
            if !repo_name.is_empty() && repo_name != url {
                return repo_name.to_string();
            }
            if !url.is_empty() && !url.starts_with('-') {
                return url.to_string();
            }
        }
    }

    String::new()
}

// ── Background scanner thread ─────────────────────────────────────────────

/// Start the background process scanner. Periodically polls the process table
/// and stores newly detected operations in the engine.
///
/// When a new operation is detected, a "sandbox-operation-detected" Tauri event
/// is emitted with the operation payload.
pub fn start_scanner(
    engine: Arc<Mutex<SandboxEngine>>,
    app_handle: Option<tauri::AppHandle>,
) {
    std::thread::spawn(move || {
        log::info!("Sandbox process scanner started");
        loop {
            let new_ops = {
                match engine.lock() {
                    Ok(mut eng) => {
                        eng.is_running = true;
                        eng.scan()
                    }
                    Err(e) => {
                        log::error!("Sandbox engine mutex poisoned: {e}");
                        Vec::new()
                    }
                }
            };

            // Emit Tauri events for newly detected operations
            if let Some(ref handle) = app_handle {
                for op in &new_ops {
                    if let Ok(payload) = serde_json::to_value(op) {
                        let _ = handle.emit("sandbox-operation-detected", payload);
                    }
                }
            }

            // For new operations, estimate download sizes synchronously.
            // local_estimate() is a cheap match — no async needed.
            if !new_ops.is_empty() {
                // Brief pause to let the process settle
                std::thread::sleep(Duration::from_millis(300));

                // Collect estimates first to avoid borrow conflict
                let mut estimates: Vec<(String, f64, f64, f64, f64, String)> = Vec::new();
                if let Ok(eng) = engine.lock() {
                    for op in &eng.detected_operations {
                        if op.status == "detected" {
                            let (est, rmin, rmax, conf, reasoning) = eng.local_estimate(&op.command_type);
                            estimates.push((op.id.clone(), est, rmin, rmax, conf, reasoning));
                        }
                    }
                }

                // Apply estimates and emit events
                if !estimates.is_empty() {
                    if let Ok(mut eng) = engine.lock() {
                        for (id, est, rmin, rmax, conf, reasoning) in &estimates {
                            if let Some(op) = eng.detected_operations.iter_mut().find(|o| o.id == *id) {
                                op.estimated_mb = *est;
                                op.estimated_range_min_mb = *rmin;
                                op.estimated_range_max_mb = *rmax;
                                op.confidence = *conf;
                                op.ai_reasoning = reasoning.clone();
                                op.status = "estimated".to_string();

                                if let Some(ref handle) = app_handle {
                                    if let Ok(payload) = serde_json::to_value(&*op) {
                                        let _ = handle.emit("sandbox-operation-updated", payload);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            std::thread::sleep(Duration::from_secs(2));
        }
    });
}
