import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { ShieldProvider } from "@/context/ShieldContext"
import { Layout } from "@/components/Layout"
import { Dashboard } from "@/pages/Dashboard"
import { RulesControls } from "@/pages/RulesControls"
import { LiveMonitor } from "@/pages/LiveMonitor"
import { DevSandbox } from "@/pages/DevSandbox"
import { Focus } from "@/pages/Focus"
import { Climate } from "@/pages/Climate"
import { DataBudget } from "@/pages/DataBudget"

export default function App() {
  return (
    <ShieldProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="/climate" element={<Climate />} />
            <Route path="/budget" element={<DataBudget />} />
            <Route path="/focus" element={<Focus />} />
            <Route path="/rules" element={<RulesControls />} />
            <Route path="/monitor" element={<LiveMonitor />} />
            <Route path="/sandbox" element={<DevSandbox />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ShieldProvider>
  )
}
