import { createContext, useContext, useState, useCallback, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"

export type ProcessStatus = "blocked" | "active" | "monitoring"

export type ProcessEntry = {
  pid: number
  name: string
  exe: string
  status: ProcessStatus
  sessionData: number
  connections: number
  lastSeen: string
}

type ShieldContextType = {
  isShieldActive: boolean
  toggleShield: () => void
  dataBudgetUsed: number
  dataBudgetTotal: number
  lastHotspotDetected: string | null
  firewallStatus: "active" | "inactive" | "partial"
  wfpAvailable: boolean
  processes: ProcessEntry[]
  blockApp: (exePath: string) => Promise<void>
  unblockApp: (exePath: string) => Promise<void>
  refreshProcesses: () => Promise<void>
  blockedCount: number
}

const ShieldContext = createContext<ShieldContextType | null>(null)

export function ShieldProvider({ children }: { children: React.ReactNode }) {
  const [isShieldActive, setIsShieldActive] = useState(true)
  const [dataBudgetUsed, setDataBudgetUsed] = useState(0)
  const [dataBudgetTotal] = useState(500)
  const [lastHotspotDetected] = useState<string | null>(null)
  const [firewallStatus, setFirewallStatus] = useState<"active" | "inactive" | "partial">("inactive")
  const [wfpAvailable, setWfpAvailable] = useState(false)
  const [processes, setProcesses] = useState<ProcessEntry[]>([])

  const refreshProcesses = useCallback(async () => {
    try {
      const liveData: ProcessEntry[] = await invoke("get_live_processes")
      setProcesses(liveData)
      const totalSessionData = liveData.reduce((sum, p) => sum + p.sessionData, 0)
      setDataBudgetUsed(Math.round(totalSessionData))
    } catch (err) {
      console.error("Failed to fetch live processes:", err)
    }
  }, [])

  const refreshWfpStatus = useCallback(async () => {
    try {
      const available = await invoke<boolean>("get_wfp_status")
      setWfpAvailable(available)
      setFirewallStatus(available ? "active" : "inactive")
    } catch (err) {
      console.error("Failed to fetch WFP status:", err)
      setWfpAvailable(false)
      setFirewallStatus("inactive")
    }
  }, [])

  const blockApp = useCallback(async (exePath: string) => {
    try {
      await invoke("toggle_process_shield", { exePath, block: true })
      await refreshProcesses()
    } catch (err) {
      console.error("Failed to block app:", err)
      throw err
    }
  }, [refreshProcesses])

  const unblockApp = useCallback(async (exePath: string) => {
    try {
      await invoke("toggle_process_shield", { exePath, block: false })
      await refreshProcesses()
    } catch (err) {
      console.error("Failed to unblock app:", err)
      throw err
    }
  }, [refreshProcesses])

  const toggleShield = useCallback(() => {
    setIsShieldActive((prev) => !prev)
  }, [])

  useEffect(() => {
    refreshWfpStatus()
    refreshProcesses()

    const interval = setInterval(() => {
      refreshProcesses()
    }, 2000)

    return () => clearInterval(interval)
  }, [refreshWfpStatus, refreshProcesses])

  const blockedCount = processes.filter((p) => p.status === "blocked").length

  return (
    <ShieldContext.Provider
      value={{
        isShieldActive,
        toggleShield,
        dataBudgetUsed,
        dataBudgetTotal,
        lastHotspotDetected,
        firewallStatus,
        wfpAvailable,
        processes,
        blockApp,
        unblockApp,
        refreshProcesses,
        blockedCount,
      }}
    >
      {children}
    </ShieldContext.Provider>
  )
}

export function useShield() {
  const ctx = useContext(ShieldContext)
  if (!ctx) throw new Error("useShield must be used within ShieldProvider")
  return ctx
}
