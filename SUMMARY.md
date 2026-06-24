# Data Guardian - Project Summary

## Overview
**Data Guardian** (also referred to as **Oasis**) is a high-performance network management engine and developer sandbox built using **Tauri v2**. It is designed to provide real-time monitoring, network filtering, and process-level insights on Windows systems.

## Key Features

### 1. Network Management & Telemetry
- **Windows Filtering Platform (WFP) Integration**: Manages user-mode sessions and filters for network traffic control.
- **IP Helper Telemetry**: Enumerates TCP/UDP tables and tracks byte usage via EStats.
- **Network Shield**: Allows users to toggle process-level network protection and manage blocked applications.

### 2. Developer Sandbox
- **Real-time Process Monitoring**: Uses a Node.js sidecar (`detector.mjs`) powered by the `systeminformation` library to detect developer-related operations (e.g., `npm install`, `docker pull`, `cargo build`).
- **AI-Driven Estimations**: Integrates with the **Groq API** (Llama 3.3 70B) to provide intelligent download size and resource impact estimations for detected commands.
- **Native Notifications**: Utilizes `winrt-toast-reborn` for native Windows toast notifications, allowing users to interact with detected operations (e.g., killing a process directly from the notification).

### 3. Carbon Tracking
- Includes a carbon tracker to monitor and report the environmental impact of network activities.

## Architecture

### Backend (Rust)
Located in `src-tauri`, the backend handles:
- Core system integrations (WFP, IP Helper, Process Control).
- Shared state management via the `NetworkEngine` and `SandboxEngine`.
- Tauri IPC command handlers in `commands.rs`.
- Background polling loops for continuous monitoring.

### Sidecar (Node.js)
The `detector.mjs` script runs as a background sidecar process. It polls the system process table and streams JSON-encoded operation data back to the Rust backend via stdout.

### Frontend (React)
Located in `src`, the frontend is a modern web application built with:
- **React 19** & **Vite**
- **Tailwind CSS** & **Shadcn UI** for the interface.
- **Lucide React** for iconography.
- **React Router** for navigation.

## Configuration
- **Environment Variables**: Uses `.env` for sensitive configurations like `GROQ_API_KEY`.
- **Tauri Config**: Defined in `src-tauri/tauri.conf.json`, specifying window properties, bundle settings, and security policies.
