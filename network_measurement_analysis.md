# Network Measurement Analysis: Core Issues and Mechanics

This document explains how the current backend measures process-level network statistics (specifically **Total MB Consumed** and **Real-time Send/Receive Speed**), highlights the critical structural inaccuracies causing these numbers to deviate from true network metrics, and contrasts this architecture with professional solutions like GlassWire.

---

## 1. How the Backend Measures Total MB Consumed

### The Mechanism
The backend calculates the cumulative data volume consumed by an application over its session using the **Windows `GetProcessIoCounters` API** (specifically the `OtherTransferCount` field).

```rust
// From src-tauri/src/iphelper.rs
pub struct IO_COUNTERS {
    pub ReadOperationCount: u64,
    pub WriteOperationCount: u64,
    pub OtherOperationCount: u64,
    pub ReadTransferCount: u64,
    pub WriteTransferCount: u64,
    pub OtherTransferCount: u64, // Used as the cumulative byte counter
}
```

### The Logic (in `engine.rs`):
1. **Authoritative Status**: The engine treats `OtherTransferCount` as the absolute cumulative byte counter for each PID because it captures socket data (including TCP, UDP, IPv4, IPv6, and QUIC/HTTP/3 traffic) which standard polling APIs (such as TCP EStats) often miss.
2. **Delta Extraction**: On each 2-second polling tick, the backend takes the current `OtherTransferCount` of a process, subtracts the last recorded value for that PID (`last_io_other_bytes`), and adds the delta to a persistent in-memory per-PID accumulator (`per_pid_cumulative`).
3. **Conversion**: This accumulated value is then converted to Megabytes (`bytes / (1024.0 * 1024.0)`) and served as the `session_data` field:

```rust
let pid_cumulative = self.per_pid_cumulative.get(pid).copied().unwrap_or(0);
let session_mb = round2(bytes_to_mb(pid_cumulative));
```

---

## 2. How the Backend Measures Send/Receive Speed (MB/s)

The real-time speed calculation relies on a hybrid ("blended") mechanism that merges event-driven metrics from **Event Tracing for Windows (ETW)** with polling-based metrics.

### The Mechanism
The backend uses **ETW (Event Tracing for Windows)** subscribing to the `Microsoft-Windows-TCPIP` kernel ETW provider GUID to intercept network events in real-time.

```rust
// From src-tauri/src/etw.rs
const TCPIP_SEND_IPV4: u8 = 10;
const TCPIP_RECV_IPV4: u8 = 11;
const TCPIP_SEND_IPV6: u8 = 26;
const TCPIP_RECV_IPV6: u8 = 27;
```

Every time a send/recv event fires, the ETW callback extracts the PID and payload byte length and stores them in a temporary map.

### The Blending Logic (in `engine.rs`):
During the 2-second poll interval:
1. **Polling Delta**: The engine calculates a polling delta, which is the maximum of:
   - The `GetProcessIoCounters` delta (described above).
   - The TCP Extended Statistics (`GetPerTcpConnectionEStats`) delta (measuring only TCPv4 connection counters).
2. **ETW Snapshot**: The engine retrieves the cumulative bytes tracked by the ETW thread since the last tick and flushes those counters.
3. **The Blend**: If both ETW events and Polling metrics are present for a PID, the final inbound byte count is blended using a hardcoded weighted average:
   $$\text{Final Delta In} = (0.7 \times \text{ETW Recv}) + (0.3 \times \text{Polling Delta})$$
4. **Speed Division**: Since the polling thread sleeps for 2 seconds (`std::thread::sleep(Duration::from_secs(2))`), the real-time speed in bytes/sec is calculated by dividing the final delta by `2.0`:
   $$\text{Speed} = \frac{\text{Final Delta In}}{2.0}$$

---

## 3. Why It Is Definitely Not Accurate at All: Identifying the Issues

Our measurements have systemic flaws that make them highly inaccurate when compared to professional firewalls or monitors. Below are the key issues identified:

### Issue A: `GetProcessIoCounters` Captures Non-Network I/O (False Positives)
This is the single largest source of inaccuracy for the **Total MB Consumed**.
* **What `OtherTransferCount` actually measures**: According to official Windows documentation, `OtherTransferCount` counts bytes transferred in I/O operations *other than read and write operations*. While this includes socket control and socket transfers, it **also includes all Named Pipes, Anonymous Pipes, Local IPC (Inter-Process Communication), Mailboxes, Console I/O, and certain driver controls**.
* **The impact**: When a heavy developer tool (like VS Code, Discord, or web browsers with multiple multi-process IPC channels) performs high-speed local IPC, those gigabytes of pipe transfers are categorized as network data. **Local system communication is falsely reported as network consumption.**

### Issue B: ETW Limitations (Missing UDP, QUIC, and IPv6 Events)
While ETW is highly responsive, our current parsing of the `Microsoft-Windows-TCPIP` events is incomplete.
* **Partial Event Subscriptions**: The parser primarily intercepts TCPv4 and TCPv6 send/recv opcodes (`10`, `11`, `26`, `27`).
* **The impact**: **UDP/QUIC and IPv6 UDP** traffic (which is used heavily by modern streaming services, Chrome, YouTube, and multiplayer games via HTTP/3 or custom protocols) is not fully decoded or accounted for in the ETW snapshot. The backend falls back to using the inaccurate `OtherTransferCount` delta or misses the traffic resolution altogether.

### Issue C: The Arbitrary 70/30 Blending Algorithm
Mixing two completely different telemetry techniques using a hardcoded percentage has no mathematical or physical foundation.
* **Why it's flawed**: If ETW correctly registers a TCP transfer of 10 MB, and `GetProcessIoCounters` records a delta of 15 MB (due to 5 MB of local IPC), the blending formula computes:
  $$(0.7 \times 10) + (0.3 \times 15) = 11.5 \text{ MB}$$
  The resulting speed is mathematically incorrect for both actual network transfers (10 MB) and total internal system transfers (15 MB).

### Issue D: Static Division by 2.0 (Ignoring Polling Interval Drift)
The speed calculations divide the delta bytes by exactly `2.0`:
```rust
let speed = net_stats.bytes_in as f64 / 2.0;
```
* **Why it's flawed**: Sleeping a thread via `std::thread::sleep(Duration::from_secs(2))` does **not** guarantee a precise 2.0-second interval. Due to CPU scheduling latency, lock contention on the `NetworkEngine` Mutex, and backend execution time (performing numerous Win32 API calls), the actual interval between polls is often $2.1\text{s}$ to $2.5\text{s}$.
* **The impact**: Dividing a 2.5-second delta by 2.0 falsely inflates the reported MB/s by up to **25%**.

### Issue E: Lack of Persistent Storage
All cumulative statistics are kept in-memory within the `per_pid_cumulative` map.
* **Why it's flawed**: PIDs are ephemeral. Once a process restarts, its historical usage is lost. The engine attempts a basic dormant preservation using process paths, but it does not write to a persistent database (like SQLite) or Windows Registry.
* **The impact**: Restarting the application or restarting the computer completely resets all "Total MB Consumed" figures, preventing long-term billing or usage tracking.

---

## 4. How Professional Tools (like GlassWire) Do It

Professional tools like **GlassWire** achieve near 100% accuracy because they do not rely on user-mode approximations, IPC counters, or high-level process polling.

| Feature / Metric | Our Backend (Data Guardian) | GlassWire |
| :--- | :--- | :--- |
| **Primary Data Source** | User-mode Polling (`GetProcessIoCounters`, TCP EStats) + high-level ETW. | Kernel-level driver / **Windows Filtering Platform (WFP)** callout driver. |
| **Measurement Location** | High up in the OS user space; mixes OS process reports. | Directly at the network stack level (IP / Transport layer) via kernel. |
| **Process Attribution** | Guesses PID association based on active connection tables (`iphlpapi`). | The kernel driver tags every single network packet with its owning PID at the moment of transmission. |
| **Non-Network Traffic** | Included (Named pipes, IPC, and local file socket streams are counted). | Excluded completely (only actual network adapter traffic is captured). |
| **Precision** | Polled every ~2 seconds with timing drift. | True real-time, event-driven packet accounting down to the microsecond. |

### How GlassWire Works Under the Hood:
1. **WFP Callout Driver**: GlassWire installs a lightweight kernel-mode WFP (Windows Filtering Platform) Callout Driver (`FWPS_LAYER_OUTBOUND_TRANSPORT_V4`, etc.).
2. **Packet Inspection**: Every packet passing through the physical network interface is inspected at the kernel level.
3. **Reliable PID Matching**: The OS kernel directly passes the originating Process ID (PID) to the driver alongside the packet size.
4. **Zero-IPC Overhead**: Only real network card I/O is tracked, completely ignoring named pipes, console operations, or disk writes.
