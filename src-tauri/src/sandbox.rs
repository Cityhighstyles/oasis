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

use std::collections::{HashMap, HashSet};
use std::io::BufRead;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use log;

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

    /// Parse a command type from its lowercase string label.
    pub fn from_label(label: &str) -> Self {
        match label.to_lowercase().as_str() {
            "npm install" => CommandType::NpmInstall,
            "pnpm install" => CommandType::PnpmInstall,
            "yarn install" => CommandType::YarnInstall,
            "npx run" => CommandType::NpxRun,
            "docker pull" => CommandType::DockerPull,
            "docker build" => CommandType::DockerBuild,
            "docker compose" => CommandType::DockerCompose,

            "vscode extension install" => CommandType::VscodeExtInstall,
            "vscode extension update" => CommandType::VscodeExtUpdate,
            "pip install" => CommandType::PipInstall,
            "pipenv install" => CommandType::PipenvInstall,
            "poetry install" => CommandType::PoetryInstall,
            "cargo install" => CommandType::CargoInstall,
            "cargo build" => CommandType::CargoBuild,
            "cargo test" => CommandType::CargoTest,
            "winget install" => CommandType::WingetInstall,
            "choco install" | "chocolatey install" => CommandType::ChocoInstall,
            "scoop install" => CommandType::ScoopInstall,
            "brew install" => CommandType::BrewInstall,
            "apt-get install" => CommandType::AptGetInstall,
            "nuget install" => CommandType::NugetInstall,
            "dotnet restore" => CommandType::DotnetRestore,
            "dotnet build" => CommandType::DotnetBuild,
            "go mod download" => CommandType::GoModDownload,
            "go install" => CommandType::GoInstall,
            "go build" => CommandType::GoBuild,
            "maven build" | "mvn build" => CommandType::MavenBuild,
            "gradle build" => CommandType::GradleBuild,
            "android studio download" => CommandType::AndroidStudioDownload,
            other => CommandType::Other(other.to_string()),
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
    /// Stop signal for the background scanner thread.
    scanner_stop_signal: Option<Arc<AtomicBool>>,
    /// Set of (pid, cmdline_hash) for operations already detected (dedup).
    seen_operations: HashSet<(u32, u64)>,
    /// PID of the Node.js systeminformation detector child process (used to kill it on shutdown).
    detector_pid: Option<u32>,
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
            scanner_stop_signal: None,
            seen_operations: HashSet::new(),
            detector_pid: None,
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

    /// Set the stop signal for the background scanner thread.
    pub fn set_stop_signal(&mut self, signal: Arc<AtomicBool>) {
        self.scanner_stop_signal = Some(signal);
    }

    /// Take the stop signal (moves it out), used when stopping the scanner.
    pub fn take_stop_signal(&mut self) -> Option<Arc<AtomicBool>> {
        self.scanner_stop_signal.take()
    }

    /// Return cloned list of detected operations (newest first).
    /// Check if a process+cmdline combo has already been seen (dedup).
    pub fn is_seen(&self, pid: u32, cmdline: &str) -> bool {
        self.seen_operations.contains(&(pid, fxhash(cmdline)))
    }

    /// Mark a process+cmdline as seen.
    pub fn mark_seen(&mut self, pid: u32, cmdline: &str) {
        self.seen_operations.insert((pid, fxhash(cmdline)));
    }

    /// Generate a new unique operation ID.
    pub fn next_id(&mut self) -> String {
        self.id_counter += 1;
        let epoch_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        format!("op-{}-{}", epoch_ms, self.id_counter)
    }

    /// Add a fully-formed operation to the engine and return it.
    pub fn push_operation(&mut self, op: DetectedOperation) -> DetectedOperation {
        self.detected_operations.push(op.clone());
        op
    }

    pub fn get_operations(&self) -> Vec<DetectedOperation> {
        let mut ops = self.detected_operations.clone();
        ops.reverse();
        ops
    }

    /// Clear all detected operations.
    pub fn clear_operations(&mut self) {
        self.detected_operations.clear();
        self.known_pids.clear();
        self.seen_operations.clear();
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
                // Also check shell processes (cmd.exe, powershell.exe) which may
                // run developer commands via batch files or shell invocations.
                if is_supported_shell(exe_name) {
                    pids_needing_cmdline.push(*pid);
                }
            }
            // Always update known PIDs
            self.known_pids.insert(*pid, exe_name.clone());
        }            // Fetch command lines + working dirs for new supported processes
            // Uses native Win32 when possible, falls back gracefully.
        let (cmdlines, workdirs) = if !pids_needing_cmdline.is_empty() {
            Self::fetch_process_details(&pids_needing_cmdline)
        } else {
            (HashMap::new(), HashMap::new())
        };

        // Now classify each new process with its command line
        for (pid, exe_name, exe_path) in &current_processes {
            // Only process newly seen PIDs that are supported
            if !pids_needing_cmdline.contains(pid) {
                continue;
            }

            let cmdline = cmdlines.get(pid).cloned().unwrap_or_default();
            if let Some(cmd_type) = classify_process_cmdline(exe_name, exe_path, &cmdline) {
                // Build a dedup key: (pid, hash of cmdline)
                let cmd_hash = fxhash(&cmdline);
                let dedup_key = (*pid, cmd_hash);
                if self.seen_operations.contains(&dedup_key) {
                    continue; // Skip duplicate operation
                }
                self.seen_operations.insert(dedup_key);

                // Extract package name and working directory
                let package_name = extract_package_name(&cmd_type, &cmdline);
                let working_dir = workdirs.get(pid).cloned().unwrap_or_default();

                let now = Local::now().format("%H:%M:%S%.3f").to_string();
                let op_id = self.next_id();
                let op = DetectedOperation {
                    id: op_id,
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
                    working_dir,
                    ai_reasoning: String::new(),
                };
                self.detected_operations.push(op.clone());
                new_ops.push(op);
            }
        }

        // Clean up stale PIDs from seen set
        let current_pids: HashSet<u32> =
            current_processes.iter().map(|(pid, _, _)| *pid).collect();
        self.known_pids.retain(|pid, _| current_pids.contains(pid));
        self.seen_operations.retain(|(pid, _)| current_pids.contains(pid));

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

    /// Get process path via native kernel32 QueryFullProcessImageNameW.
    /// Stub retained for enumerate_processes compatibility.
    #[cfg(target_os = "windows")]
    fn get_process_path(pid: u32) -> String {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        #[link(name = "kernel32")]
        extern "system" {
            fn QueryFullProcessImageNameW(
                h_process: HANDLE,
                dw_flags: u32,
                lp_exe_name: *mut u16,
                lpdw_size: *mut u32,
            ) -> i32;
        }

        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return String::new();
            }
            let mut buf = [0u16; 260];
            let mut size = buf.len() as u32;
            let path = if QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size) != 0 {
                let slice = std::slice::from_raw_parts(buf.as_ptr(), size as usize);
                String::from_utf16_lossy(slice)
            } else {
                String::new()
            };
            CloseHandle(handle);
            path
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn get_process_path(_pid: u32) -> String {
        String::new()
    }

    // ── Native Win32 process detail fetching ────────────────────────────
    //
    // Replaces the old PowerShell-based approach with direct Win32 API calls
    // via OpenProcess + QueryFullProcessImageNameW for the exe path (and
    // working directory) and NtQueryInformationProcess for the command line.

    /// Batch-fetch command lines AND working directories for a set of PIDs
    /// using native Win32 APIs. Returns (cmdlines, workdirs) maps.
    #[cfg(target_os = "windows")]
    fn fetch_process_details(pids: &[u32]) -> (HashMap<u32, String>, HashMap<u32, String>) {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
        };

        #[link(name = "kernel32")]
        extern "system" {
            fn QueryFullProcessImageNameW(
                h_process: HANDLE,
                dw_flags: u32,
                lp_exe_name: *mut u16,
                lpdw_size: *mut u32,
            ) -> i32;
        }

        let mut cmdlines = HashMap::new();
        let mut workdirs = HashMap::new();

        for &pid in pids {
            unsafe {
                let handle = OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
                    0,
                    pid,
                );
                if handle.is_null() {
                    continue;
                }

                // Get the executable path via native API
                let mut buf = [0u16; 260];
                let mut size = buf.len() as u32;
                let path = if QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size) != 0 {
                    let slice = std::slice::from_raw_parts(buf.as_ptr(), size as usize);
                    String::from_utf16_lossy(slice)
                } else {
                    CloseHandle(handle);
                    continue;
                };

                // Derive working directory as the parent of the exe path
                if let Some(parent) = std::path::Path::new(&path).parent() {
                    workdirs.insert(pid, parent.to_string_lossy().to_string());
                }

                // Fetch command line + actual working directory via PEB reading
                if let Some((cmdline, cwd)) = read_process_cmdline_and_cwd(handle) {
                    cmdlines.insert(pid, cmdline);
                    if !cwd.is_empty() {
                        workdirs.insert(pid, cwd);
                    }
                }

                CloseHandle(handle);
            }
        }

        (cmdlines, workdirs)
    }

    #[cfg(not(target_os = "windows"))]
    fn fetch_process_details(_pids: &[u32]) -> (HashMap<u32, String>, HashMap<u32, String>) {
        (HashMap::new(), HashMap::new())
    }

    /// Estimate download size locally (fallback when no Groq API key).
    pub fn local_estimate(cmd_type: &CommandType) -> (f64, f64, f64, f64, String) {
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

// ── Standalone Groq API helper ───────────────────────────────────────────

/// Call the Groq API to predict download size for a detected operation.
/// Standalone free function so it can be called from the sync scanner thread
/// via `tokio::runtime::Runtime::block_on` without holding the engine mutex.
async fn groq_predict(api_key: &str, op: &DetectedOperation) -> Option<(f64, f64, f64, f64, String)> {
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

// ── Native Win32 command-line reader (replaces PowerShell) ─────────────

/// Simple 64-bit hash for deduplication (FNV-1a style).
fn fxhash(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in s.as_bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Read a process command line using native Win32 NtQueryInformationProcess.
/// Reads the Process Environment Block (PEB) from the target process to get
/// the RTL_USER_PROCESS_PARAMETERS.CommandLine UNICODE_STRING.
/// Also returns the working directory (CurrentDirectory) from the same PEB.
#[cfg(target_os = "windows")]
fn read_process_cmdline_and_cwd(handle: *mut std::ffi::c_void) -> Option<(String, String)> {
    use windows_sys::Win32::Foundation::HANDLE;

    #[repr(C)]
    struct UNICODE_STRING {
        length: u16,
        maximum_length: u16,
        buffer: *mut u16,
    }

    #[repr(C)]
    struct CURDIR {
        _dummy: *mut std::ffi::c_void,
        path: UNICODE_STRING,
    }

    #[repr(C)]
    struct RTL_USER_PROCESS_PARAMETERS {
        maximum_length: u32,
        length: u32,
        flags: u32,
        debug_flags: u32,
        console_handle: HANDLE,
        console_flags: u32,
        std_input_handle: HANDLE,
        std_output_handle: HANDLE,
        std_error_handle: HANDLE,
        current_directory: CURDIR,
        image_path_name: UNICODE_STRING,
        command_line: UNICODE_STRING,
    }

    #[repr(C)]
    struct PEB {
        reserved: [u8; 2],
        being_debugged: u8,
        _reserved1: [u8; 1],
        _reserved2: [*mut std::ffi::c_void; 2],
        _ldr: *mut std::ffi::c_void,
        process_parameters: *mut RTL_USER_PROCESS_PARAMETERS,
    }

    #[repr(C)]
    struct PROCESS_BASIC_INFORMATION {
        exit_status: i32,
        peb_base_address: *mut PEB,
        affinity_mask: usize,
        base_priority: i32,
        unique_process_id: usize,
        inherited_from_unique_process_id: usize,
    }

    // NtQueryInformationProcess is in ntdll, ReadProcessMemory is in kernel32.
    // Using separate extern blocks for each DLL to avoid link errors.
    #[link(name = "ntdll")]
    extern "system" {
        fn NtQueryInformationProcess(
            process_handle: HANDLE,
            information_class: u32,
            information: *mut std::ffi::c_void,
            information_length: u32,
            return_length: *mut u32,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn ReadProcessMemory(
            h_process: HANDLE,
            lp_base_address: *const std::ffi::c_void,
            lp_buffer: *mut std::ffi::c_void,
            dw_size: usize,
            lp_number_of_bytes_read: *mut usize,
        ) -> i32;
    }

    /// Helper to read a UNICODE_STRING buffer from the target process.
    unsafe fn read_ustr(handle: HANDLE, us: &UNICODE_STRING) -> Option<String> {
        let len = us.length as usize;
        if len == 0 || us.buffer.is_null() {
            return None;
        }
        let mut buf = vec![0u16; len / 2 + 1];
        let mut bytes_read = 0usize;
        let ret = ReadProcessMemory(
            handle,
            us.buffer as *const std::ffi::c_void,
            buf.as_mut_ptr() as *mut std::ffi::c_void,
            len,
            &mut bytes_read,
        );
        if ret == 0 {
            return None;
        }
        buf[len / 2] = 0;
        Some(String::from_utf16_lossy(&buf[..len / 2]))
    }

    const PROCESS_BASIC_INFORMATION_CLASS: u32 = 0;

    unsafe {
        let mut pbi = std::mem::zeroed::<PROCESS_BASIC_INFORMATION>();
        let mut ret_len = 0u32;

        let status = NtQueryInformationProcess(
            handle,
            PROCESS_BASIC_INFORMATION_CLASS,
            &mut pbi as *mut _ as *mut std::ffi::c_void,
            std::mem::size_of::<PROCESS_BASIC_INFORMATION>() as u32,
            &mut ret_len,
        );

        if status != 0 || pbi.peb_base_address.is_null() {
            return None;
        }

        // Read the PEB from the target process
        let mut peb = std::mem::zeroed::<PEB>();
        let mut bytes_read = 0usize;
        ReadProcessMemory(
            handle,
            pbi.peb_base_address as *const std::ffi::c_void,
            &mut peb as *mut _ as *mut std::ffi::c_void,
            std::mem::size_of::<PEB>(),
            &mut bytes_read,
        );
        if peb.process_parameters.is_null() {
            return None;
        }

        // Read RTL_USER_PROCESS_PARAMETERS from the target process
        let mut params = std::mem::zeroed::<RTL_USER_PROCESS_PARAMETERS>();
        ReadProcessMemory(
            handle,
            peb.process_parameters as *const std::ffi::c_void,
            &mut params as *mut _ as *mut std::ffi::c_void,
            std::mem::size_of::<RTL_USER_PROCESS_PARAMETERS>(),
            &mut bytes_read,
        );

        // Read command line and current directory from the target process
        let cmdline = read_ustr(handle, &params.command_line)?;
        let cwd = read_ustr(handle, &params.current_directory.path)
            .unwrap_or_default();

        Some((cmdline, cwd))
    }
}

#[cfg(not(target_os = "windows"))]
fn read_process_cmdline_and_cwd(_handle: *mut std::ffi::c_void) -> Option<(String, String)> {
    None
}

// ── Process classification ────────────────────────────────────────────────

/// Quick check: is this executable name one we care about?
/// Used to avoid expensive system calls for irrelevant processes.
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

/// Check if the executable is a shell (cmd.exe, powershell.exe) that may
/// run developer commands indirectly via batch files or -Command flags.
/// Shells are detected separately so they can be scanned for embedded
/// developer commands in their command line without causing false positives
/// for idle terminal windows.
fn is_supported_shell(exe_name: &str) -> bool {
    let lower = exe_name.to_lowercase();
    matches!(
        lower.as_str(),
        "cmd.exe" | "cmd"
            | "powershell.exe" | "powershell" | "pwsh.exe" | "pwsh"
    )
}

/// Given an executable name, its full path, and its command line, classify the
/// exact developer operation (distinguishes "npm install" from "npm run build").
///
/// Classification strategy (by priority):
///   1. Exe-name-only match — for single-purpose package managers (npm.exe,
///      pip.exe, winget.exe, etc.), the executable name alone is sufficient.
///   2. Cmdline-enriched match — for multi-purpose tools (cargo, docker, etc.),
///      use the command line for finer-grained sub-type classification.
///   3. Shell-proxy match — for cmd.exe / powershell.exe, parse embedded
///      commands from the shell's command line (e.g. "cmd /c npm install").
///
fn classify_process_cmdline(exe_name: &str, _exe_path: &str, cmdline: &str) -> Option<CommandType> {
    let lower_exe = exe_name.to_lowercase();
    let lower_cmd = cmdline.to_lowercase();

    // Helper: check if the command line contains a keyword
    let has_arg = |keyword: &str| lower_cmd.contains(keyword);

    // ────────────────────────────────────────────────────────────────────
    // Phase 1: Exe-name-only match — for single-purpose package managers.
    // These tools have no purpose other than installing/updating packages,
    // so any invocation should be detected regardless of cmdline content.
    // ────────────────────────────────────────────────────────────────────

    let exe_only = || -> Option<CommandType> {
        match lower_exe.as_str() {
            // ── Python ────────────────────────────────────────────
            "pip.exe" | "pip" | "pip3.exe" | "pip3" => Some(CommandType::PipInstall),
            "pipenv.exe" | "pipenv" => Some(CommandType::PipenvInstall),
            "poetry.exe" | "poetry" => Some(CommandType::PoetryInstall),

            // ── Windows package managers ────────────────────────────
            "winget.exe" | "winget" => Some(CommandType::WingetInstall),
            "choco.exe" | "chocolatey.exe" => Some(CommandType::ChocoInstall),
            "scoop.exe" | "scoop" => Some(CommandType::ScoopInstall),

            // ── Linux / cross-platform ──────────────────────────────
            "brew.exe" | "brew" => Some(CommandType::BrewInstall),
            "apt.exe" | "apt-get.exe" => Some(CommandType::AptGetInstall),

            // ── .NET ────────────────────────────────────────────────
            "nuget.exe" | "nuget" => Some(CommandType::NugetInstall),

            // ── Java / JVM ──────────────────────────────────────────
            "mvn.exe" | "mvn" | "mvnw.bat" | "mvnw" => Some(CommandType::MavenBuild),
            "gradle.exe" | "gradle" | "gradlew.bat" | "gradlew" => Some(CommandType::GradleBuild),
            "studio64.exe" | "studio64" | "androidstudio.exe" | "androidstudio" => Some(CommandType::AndroidStudioDownload),

            // ── Rust (unambiguous via exe name) ─────────────────────
            "rustc.exe" | "rustc" => Some(CommandType::CargoBuild),

            _ => None, // Not a single-purpose tool — fall through to Phase 2
        }
    };

    if let Some(cmd_type) = exe_only() {
        return Some(cmd_type);
    }

    // ────────────────────────────────────────────────────────────────────
    // Phase 2: Cmdline-enriched match — for multi-purpose tools that need
    // the command line to distinguish sub-operations (install vs build vs
    // clone vs pull). When cmdline is empty (PEB read failure), fall back
    // to a reasonable default for each tool.
    // ────────────────────────────────────────────────────────────────────

    // Helper: detect which package manager wraps around node.exe
    let pm_from_node = || -> Option<CommandType> {
        if cmdline.is_empty() {
            // PEB read failed — try to infer from exe path.
            // node.exe itself doesn't contain npm in its path, but the
            // command line (which we can't read) would. As last resort,
            // return None for node.exe (too many false positives).
            return None;
        }
        // Cmdline available — check for known node-based tools
        if has_arg("pnpm") {
            if has_arg("install") || has_arg("add ") || has_arg("i ") { Some(CommandType::PnpmInstall) }
            else { None }
        } else if has_arg("yarn") {
            if has_arg("install") || has_arg("add ") { Some(CommandType::YarnInstall) }
            else { None }
        } else if has_arg("npx") {
            Some(CommandType::NpxRun)
        } else if has_arg("npm") {
            // npm can appear as "npm-cli.js", "npm.js", or "npm install"
            if has_arg("install") || has_arg("i ") || has_arg("add ") || has_arg("ci") || has_arg("-cli")
            {
                Some(CommandType::NpmInstall)
            } else {
                // Has "npm" in cmdline but no install keyword — likely "npm run" or "npm exec"
                None
            }
        } else {
            None
        }
    };

    match lower_exe.as_str() {
        // ── Node.js — requires cmdline to determine the tool ─────────
        "node.exe" | "node" => pm_from_node(),

        // ── npm / pnpm / yarn / npx (direct invocations) — only on install keywords ──
        "npm.exe" | "npm" => {
            if cmdline.is_empty() {
                None
            } else if has_arg("install") || has_arg(" i ") || has_arg(" add ") || has_arg("ci") {
                Some(CommandType::NpmInstall)
            } else {
                None
            }
        }
        "pnpm.exe" | "pnpm" => {
            if cmdline.is_empty() {
                None
            } else if has_arg("install") || has_arg(" add ") || has_arg(" i ") {
                Some(CommandType::PnpmInstall)
            } else {
                None
            }
        }
        "yarn.exe" | "yarn" => {
            if cmdline.is_empty() {
                None
            } else if has_arg("install") || has_arg(" add ") {
                Some(CommandType::YarnInstall)
            } else {
                None
            }
        }
        "npx.exe" | "npx" => {
            if cmdline.is_empty() {
                None
            } else if has_arg("install") || has_arg(" add ") || has_arg("create") || has_arg("init") {
                Some(CommandType::NpxRun)
            } else {
                None
            }
        }

        // ── Docker — multi-purpose: pull / build / compose ──────────
        "docker.exe" | "docker" => {
            if cmdline.is_empty() {
                // Default to DockerPull when cmdline unavailable
                Some(CommandType::DockerPull)
            } else if has_arg("pull") && !has_arg("push") {
                Some(CommandType::DockerPull)
            } else if has_arg("build") || has_arg("compose build") {
                Some(CommandType::DockerBuild)
            } else if has_arg("compose") && !has_arg("build") {
                Some(CommandType::DockerCompose)
            } else if has_arg("pull") {
                Some(CommandType::DockerPull)
            } else {
                None
            }
        }

        // ── VS Code — multi-purpose: install / update extensions ────
        "code.exe" | "code" => {
            if has_arg("--install-extension") {
                Some(CommandType::VscodeExtInstall)
            } else if has_arg("--update-extensions") || has_arg("--list-extensions") {
                Some(CommandType::VscodeExtUpdate)
            } else {
                None
            }
        }

        // ── Rust Cargo — multi-purpose: install / build / test ──────
        "cargo.exe" | "cargo" => {
            if cmdline.is_empty() {
                // Default to CargoBuild (most common download-heavy op)
                Some(CommandType::CargoBuild)
            } else if has_arg("install") {
                Some(CommandType::CargoInstall)
            } else if has_arg("build") || has_arg("b ") {
                Some(CommandType::CargoBuild)
            } else if has_arg("test") || has_arg("t ") {
                Some(CommandType::CargoTest)
            } else {
                None
            }
        }

        // ── .NET — multi-purpose: restore / build ───────────────────
        "dotnet.exe" | "dotnet" => {
            if cmdline.is_empty() {
                // Default to DotnetRestore when cmdline unavailable
                Some(CommandType::DotnetRestore)
            } else if has_arg("restore") {
                Some(CommandType::DotnetRestore)
            } else if has_arg("build") {
                Some(CommandType::DotnetBuild)
            } else {
                None
            }
        }

        // ── Go — multi-purpose: mod / install / build ───────────────
        "go.exe" | "go" => {
            if cmdline.is_empty() {
                // Default to GoInstall when cmdline unavailable
                Some(CommandType::GoInstall)
            } else if has_arg("mod download") || has_arg("mod tidy") {
                Some(CommandType::GoModDownload)
            } else if has_arg("install") {
                Some(CommandType::GoInstall)
            } else if has_arg("build") || has_arg("run") {
                Some(CommandType::GoBuild)
            } else {
                None
            }
        }

        // ── Catch-all (e.g., shells like cmd.exe / powershell.exe) ──
        _ => classify_shell_cmdline(&lower_cmd),
    }
}

/// Classify embedded developer commands from shell processes (cmd.exe, powershell.exe).
/// These shells run batch files like `npm.cmd` or use `-Command` flags to invoke
/// developer tools. We parse the shell's command line for known tool patterns.
///
/// To avoid false positives from idle terminal windows, we require BOTH the tool
/// name AND a relevant keyword (e.g., "npm" AND "install") to be present.
fn classify_shell_cmdline(lower_cmd: &str) -> Option<CommandType> {
    // npm / pnpm / yarn / npx — only on install/download keywords
    if lower_cmd.contains("npm install") || lower_cmd.contains("npm i ")
        || lower_cmd.contains("npm add ") || lower_cmd.contains("npm ci")
    {
        return Some(CommandType::NpmInstall);
    }
    if lower_cmd.contains("pnpm install") || lower_cmd.contains("pnpm add ")
        || lower_cmd.contains("pnpm i ")
    {
        return Some(CommandType::PnpmInstall);
    }
    if lower_cmd.contains("yarn install") || lower_cmd.contains("yarn add ")
    {
        return Some(CommandType::YarnInstall);
    }
    // npx — only trigger for install/create/init (not generic run)
    if (lower_cmd.contains("npx install") || lower_cmd.contains("npx create")
        || lower_cmd.contains("npx init"))
    {
        return Some(CommandType::NpxRun);
    }
    // pip
    if lower_cmd.contains("pip install") {
        return Some(CommandType::PipInstall);
    }
    // docker
    if lower_cmd.contains("docker pull") {
        return Some(CommandType::DockerPull);
    }
    if lower_cmd.contains("docker build") || lower_cmd.contains("docker compose build") {
        return Some(CommandType::DockerBuild);
    }
    if lower_cmd.contains("docker compose") && !lower_cmd.contains("docker compose build") {
        return Some(CommandType::DockerCompose);
    }
    // cargo
    if lower_cmd.contains("cargo install") {
        return Some(CommandType::CargoInstall);
    }
    if lower_cmd.contains("cargo build") {
        return Some(CommandType::CargoBuild);
    }
    if lower_cmd.contains("cargo test") {
        return Some(CommandType::CargoTest);
    }
    // winget / choco / scoop
    if lower_cmd.contains("winget install") {
        return Some(CommandType::WingetInstall);
    }
    if lower_cmd.contains("choco install") || lower_cmd.contains("chocolatey install") {
        return Some(CommandType::ChocoInstall);
    }
    if lower_cmd.contains("scoop install") {
        return Some(CommandType::ScoopInstall);
    }
    // brew / apt-get
    if lower_cmd.contains("brew install") {
        return Some(CommandType::BrewInstall);
    }
    if lower_cmd.contains("apt-get install") || lower_cmd.contains("apt install") {
        return Some(CommandType::AptGetInstall);
    }
    // dotnet
    if lower_cmd.contains("dotnet restore") {
        return Some(CommandType::DotnetRestore);
    }
    if lower_cmd.contains("dotnet build") {
        return Some(CommandType::DotnetBuild);
    }
    // go
    if lower_cmd.contains("go mod download") || lower_cmd.contains("go mod tidy") {
        return Some(CommandType::GoModDownload);
    }
    if lower_cmd.contains("go install") {
        return Some(CommandType::GoInstall);
    }
    if lower_cmd.contains("go build") || lower_cmd.contains("go run") {
        return Some(CommandType::GoBuild);
    }
    // maven / gradle
    if lower_cmd.contains("mvn ") || lower_cmd.contains("mvnw ") {
        return Some(CommandType::MavenBuild);
    }
    if lower_cmd.contains("gradle ") || lower_cmd.contains("gradlew ") {
        return Some(CommandType::GradleBuild);
    }
    // VS Code
    if lower_cmd.contains("--install-extension") {
        return Some(CommandType::VscodeExtInstall);
    }

    None
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

    String::new()
}

// ── Background scanner thread ─────────────────────────────────────────────

/// Start the background process scanner in a new thread. Periodically polls the
/// process table and stores newly detected operations in the engine.
///
/// A shared `AtomicBool` stop signal is stored in the engine so that
/// `stop_scanner` can request clean shutdown.
///
/// When a new operation is detected, a "sandbox-operation-detected" Tauri event
/// is emitted with the operation payload.
pub fn start_scanner(
    engine: Arc<Mutex<SandboxEngine>>,
    app_handle: Option<tauri::AppHandle>,
) {
    let stop_signal = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop_signal);

    // Store the stop signal in the engine so stop_scanner can access it
    if let Ok(mut eng) = engine.lock() {
        eng.set_stop_signal(stop_signal);
        eng.is_running = true;
    }

    // Start the Node.js systeminformation process monitor alongside the
    // poll scanner. The Node.js detector uses systeminformation (a native
    // WMI/COM wrapper) to poll the process list every 500ms, providing
    // reliable command-line detection that doesn't depend on PEB reading.
    start_node_monitor(Arc::clone(&engine), app_handle.clone());

    std::thread::spawn(move || {
        log::info!("Sandbox process scanner started");

        loop {
            // Check for stop signal
            if thread_stop.load(Ordering::Relaxed) {
                log::info!("Sandbox scanner stop requested — shutting down");
                if let Ok(mut eng) = engine.lock() {
                    eng.is_running = false;
                }
                return;
            }

            let new_ops = {
                match engine.lock() {
                    Ok(mut eng) => eng.scan(),
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

            // ── Estimate download sizes for new operations ──────────────
            // Strategy: always compute local estimates first, then try to
            // overwrite with Groq AI if the key is configured. This avoids
            // tricky async-in-sync-thread control flow (see: the break bug).
            if !new_ops.is_empty() {
                std::thread::sleep(Duration::from_millis(300));

                // Collect ops to estimate + groq key (brief lock, released before async)
                let (ops_to_estimate, groq_api_key) = {
                    if let Ok(eng) = engine.lock() {
                        let ops = eng.detected_operations.iter()
                            .filter(|op| op.status == "detected")
                            .cloned()
                            .collect();
                        (ops, eng.groq_api_key_ref().map(|s| s.to_string()))
                    } else {
                        (Vec::new(), None)
                    }
                };

                if ops_to_estimate.is_empty() {
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }

                // ── Phase 1: local estimates for everything (baseline) ──
                let mut estimates: Vec<(String, f64, f64, f64, f64, String)> = Vec::new();
                for op in &ops_to_estimate {
                    let (est, rmin, rmax, conf, reasoning) =
                        SandboxEngine::local_estimate(&op.command_type);
                    estimates.push((op.id.clone(), est, rmin, rmax, conf, reasoning));
                }

                // ── Phase 2: try Groq AI on top if key is available ────
                if let Some(ref api_key) = groq_api_key {
                    if let Ok(rt) = tokio::runtime::Runtime::new() {
                        for op in &ops_to_estimate {
                            if let Some((est, rmin, rmax, conf, reasoning)) =
                                rt.block_on(groq_predict(api_key, op))
                            {
                                log::info!("Groq estimate for {}: {:.1} MB (confidence {:.0}%)",
                                    op.command_type.label(), est, conf * 100.0);
                                if let Some(entry) = estimates.iter_mut().find(|(id, _, _, _, _, _)| id == &op.id) {
                                    *entry = (op.id.clone(), est, rmin, rmax, conf, reasoning);
                                }
                            } else {
                                log::warn!("Groq estimation failed for {}, keeping local estimate",
                                    op.command_type.label());
                            }
                        }
                    } else {
                        log::warn!("Failed to create Tokio runtime for Groq; using local estimates");
                    }
                }

                // ── Apply estimates & emit events ───────────────────────
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

            // Throttle: sleep 500ms between scans (reduced from 2s to catch
            // short-lived processes like `npm install` that start and finish
            // quickly). The WMI event monitor catches processes at creation
            // time, but this fallback ensures coverage when WMI is unavailable.
            for _ in 0..5 {
                if thread_stop.load(Ordering::Relaxed) {
                    log::info!("Sandbox scanner stop requested during sleep — shutting down");
                    if let Ok(mut eng) = engine.lock() {
                        eng.is_running = false;
                        // Kill the Node.js detector child by PID
                        if let Some(pid) = eng.detector_pid.take() {
                            let _ = std::process::Command::new("taskkill")
                                .args(["/PID", &pid.to_string(), "/F"])
                                .stdout(Stdio::null())
                                .stderr(Stdio::null())
                                .spawn();
                        }
                    }
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    });
}

/// Start the Node.js systeminformation process monitor in a background thread.
/// Spawns `node detector.mjs` which uses the `systeminformation` npm package
/// to poll the Windows process list every 500ms. The `systeminformation` library
/// uses native WMI/COM internally on Windows, giving it reliable access to
/// process command lines that the Rust PEB reader may miss (especially for
/// short-lived processes like `node.exe` running npm).
///
/// Detected operations are output as JSON lines to stdout, which we parse here
/// and create DetectedOperation entries in the engine.
fn start_node_monitor(
    engine: Arc<Mutex<SandboxEngine>>,
    app_handle: Option<tauri::AppHandle>,
) {
    std::thread::spawn(move || {
        log::info!("Starting Node.js systeminformation process monitor");

        // Resolve detector.mjs path at compile time (embedded as string literal)
        let detector_path = concat!(env!("CARGO_MANIFEST_DIR"), "/detector.mjs");

        let child = Command::new("node")
            .arg(&detector_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to start Node.js detector: {e} (is Node.js installed?)");
                log::warn!("Falling back to poll scanner only — npm install may not be detected");
                return;
            }
        };

        // Store the child PID so stop_scanner can kill it.
        let child_pid = child.id();
        if let Ok(mut eng) = engine.lock() {
            eng.detector_pid = Some(child_pid);
        }

        let stdout = child.stdout.take().unwrap();
        let reader = std::io::BufReader::new(stdout);

        // Spawn a separate thread to log stderr from the Node.js process
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let err_reader = std::io::BufReader::new(stderr);
                for line in err_reader.lines() {
                    if let Ok(l) = line {
                        log::warn!("[node-detector] {}", l);
                    }
                }
            });
        }

        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };

            if line.trim().is_empty() {
                continue;
            }

            // Parse JSON line from the detector
            let entry: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("Failed to parse detector JSON: {e} — line: {}", line);
                    continue;
                }
            };

            let pid: u32 = match entry["pid"].as_u64() {
                Some(p) => p as u32,
                None => continue,
            };
            let exe_name = entry["exe"].as_str().unwrap_or("").to_string();
            let cmdline = entry["cmd"].as_str().unwrap_or("").to_string();
            let type_label = entry["type"].as_str().unwrap_or("");
            let working_dir = entry["exePath"].as_str().unwrap_or("").to_string();

            if exe_name.is_empty() || type_label.is_empty() {
                continue;
            }

            let cmd_type = CommandType::from_label(type_label);
            let package_name = extract_package_name(&cmd_type, &cmdline);

            // Build operation under lock to get unique ID and dedup
            let op = {
                let mut eng = match engine.lock() {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                if eng.is_seen(pid, &cmdline) {
                    continue;
                }
                eng.mark_seen(pid, &cmdline);

                let now = Local::now().format("%H:%M:%S%.3f").to_string();
                let op = DetectedOperation {
                    id: eng.next_id(),
                    command_type: cmd_type,
                    command_line: cmdline,
                    executable: exe_name,
                    pid,
                    detected_at: now,
                    estimated_mb: 0.0,
                    estimated_range_min_mb: 0.0,
                    estimated_range_max_mb: 0.0,
                    confidence: 0.0,
                    status: "detected".to_string(),
                    package_name,
                    working_dir,
                    ai_reasoning: String::new(),
                };
                eng.push_operation(op.clone());
                op
            };

            // Emit Tauri event outside the lock
            if let Some(ref handle) = app_handle {
                if let Ok(payload) = serde_json::to_value(&op) {
                    let _ = handle.emit("sandbox-operation-detected", payload);
                    log::info!("Detected: {} (PID {})", op.command_type.label(), op.pid);
                }
            }
        }

        log::info!("Node.js detector process ended");
    });
}

/// Request the background scanner thread to stop.
/// Sets the stop signal; the thread will exit on its next iteration.
pub fn stop_scanner(engine: &Arc<Mutex<SandboxEngine>>) {
    if let Ok(mut eng) = engine.lock() {
        if let Some(signal) = eng.take_stop_signal() {
            signal.store(true, Ordering::Relaxed);
            // Kill the Node.js detector child by PID
            if let Some(pid) = eng.detector_pid.take() {
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn();
            }
            log::info!("Sandbox scanner stop signal sent");
        } else {
            log::warn!("stop_scanner called but no stop signal found (scanner not running?)");
        }
    }
}
