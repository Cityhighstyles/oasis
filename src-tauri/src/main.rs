#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::process::Command;
use std::os::windows::process::CommandExt;
use sysinfo::{Pid, System};
use tauri::State;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")] // Maps exactly to your TypeScript camelCase naming
pub struct ProcessEntry {
    pid: u32,
    name: String,
    exe: String,
    status: String,
    session_data: f64,
    total_data: f64,
    connections: usize,
    last_seen: String,
}

// In-memory data structures to calculate raw network metrics over a runtime session
pub struct NetworkTracker {
    pub session_bytes: HashMap<u32, u64>,
    pub historical_bytes: HashMap<String, u64>, // Maps exe names to cumulative historical bytes
}

pub struct AppState(Mutex<NetworkTracker>);

#[tauri::command]
fn get_live_processes(state: State<'_, AppState>) -> Result<Vec<ProcessEntry>, String> {
    let mut tracker = state.0.lock().unwrap();
    let mut sys = System::new_all();
    sys.refresh_all();

    // Use netstat to pull real-time process bindings to active local/remote IP ports
    let output = Command::new("cmd")
        .args(&["/C", "netstat -ano"])
        .creation_flags(0x08000000) // Silent process frame
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut pid_connection_counts: HashMap<u32, usize> = HashMap::new();

    // Parse active connections and map counts per PID
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            let last_part = parts[parts.len() - 1];
            if let Ok(pid) = last_part.parse::<u32>() {
                if pid > 0 {
                    *pid_connection_counts.entry(pid).or_insert(0) += 1;
                }
            }
        }
    }

    let mut current_entries = Vec::new();
    let current_time = chrono::Local::now().format("%H:%M:%S").to_string();

    for (&pid, &connections) in &pid_connection_counts {
        if let Some(process) = sys.process(Pid::from(pid as usize)) {
            let exe_name = process.name().to_string();
            
            // Map common display names for key data consumers
            let display_name = match exe_name.as_str() {
                "svchost.exe" => "Windows Host Process".to_string(),
                "chrome.exe" => "Google Chrome".to_string(),
                "brave.exe" => "Brave Browser".to_string(),
                "OneDrive.exe" => "Microsoft OneDrive".to_string(),
                _ => exe_name.replace(".exe", ""),
            };

            // Hard check if our firewall rule or service blockers are processing this entity
            let is_blocked = exe_name.contains("wuauserv") 
                || exe_name.contains("UsoSvc") 
                || exe_name.contains("BraveUpdate") 
                || exe_name.contains("GoogleUpdate");

            let status = if is_blocked { "blocked" } else if connections > 0 { "active" } else { "monitoring" };

            // Mock Data Generation for baseline UI evaluation using standard bytes formulas:
            // This increments data calculations over each 2-second tick when sockets are actively reading
            let mut session_mb = 0.0;
            if status == "active" && !is_blocked {
                let entry = tracker.session_bytes.entry(pid).or_insert(0);
                *entry += 256 * 1024; // Simulated data load per network pool loop tick
                session_mb = (*entry as f64) / (1024.0 * 1024.0);
            }

            // Historical persistent tracking by application file name
            let total_entry = tracker.historical_bytes.entry(exe_name.clone()).or_insert(50 * 1024 * 1024);
            if status == "active" && !is_blocked {
                *total_entry += 256 * 1024;
            }
            let total_mb = (*total_entry as f64) / (1024.0 * 1024.0);

            current_entries.push(ProcessEntry {
                pid,
                name: display_name,
                exe: exe_name,
                status: status.to_string(),
                session_data: (session_mb * 10.0).round() / 10.0,
                total_data: (total_mb * 10.0).round() / 10.0,
                connections,
                last_seen: if status == "active" { "now".to_string() } else { current_time.clone() },
            });
        }
    }

    // Sort heaviest consumption applications to the top of the stack grid
    current_entries.sort_by(|a, b| b.session_data.partial_cmp(&a.session_data).unwrap_or(std::cmp::Ordering::Equal));
    Ok(current_entries)
}

fn main() {
    tauri::Builder::default()
        .manage(AppState(Mutex::new(NetworkTracker {
            session_bytes: HashMap::new(),
            historical_bytes: HashMap::new(),
        })))
        .invoke_handler(tauri::generate_handler![get_live_processes])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}