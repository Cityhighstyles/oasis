import { useState, useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { ShieldProvider } from "@/context/ShieldContext"
import { Layout } from "@/components/Layout"
import { Dashboard } from "@/pages/Dashboard"
import { RulesControls } from "@/pages/RulesControls"
import { LiveMonitor } from "@/pages/LiveMonitor"
import { DevSandbox } from "@/pages/DevSandbox"
import { SandboxOverlay } from "@/pages/SandboxOverlay"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"

export default function App() {
  const [isOverlay, setIsOverlay] = useState(false)

  useEffect(() => {
    // Check if we are running in an overlay window
    try {
      const label = getCurrentWebviewWindow().label
      if (label.startsWith("sandbox-overlay-")) {
        setIsOverlay(true)
      }
    } catch {
      // Not in a Tauri environment or window not found
    }
  }, [])

  if (isOverlay) {
    return (
      <ShieldProvider>
        <BrowserRouter>
          <SandboxOverlay />
        </BrowserRouter>
      </ShieldProvider>
    )
  }

  return (
    <ShieldProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="/rules" element={<RulesControls />} />
            <Route path="/monitor" element={<LiveMonitor />} />
            <Route path="/sandbox" element={<DevSandbox />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
          {/* Sandbox overlay window (no layout — transparent, borderless) */}
          <Route path="/sandbox-overlay/:operationId" element={<SandboxOverlay />} />
        </Routes>
      </BrowserRouter>
    </ShieldProvider>
  )
}
