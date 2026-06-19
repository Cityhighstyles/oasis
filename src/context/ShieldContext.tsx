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
  blockedApps: ProcessEntry[]
  blockApp: (exePath: string) => Promise<void>
  unblockApp: (exePath: string) => Promise<void>
  refreshProcesses: () => Promise<void>
  blockedCount: number
  suspendProcess: (pid: number) => Promise<number>
  resumeProcess: (pid: number) => Promise<number>
  killProcess: (pid: number) => Promise<void>
  suspendedPids: Set<number>
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
  const [suspendedPids, setSuspendedPids] = useState<Set<number>>(new Set())

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

  const refreshSuspendedPids = useCallback(async () => {
    try {
      const pids: number[] = await invoke("get_suspended_pids")
      setSuspendedPids(new Set(pids))
    } catch {
      // ignore
    }
  }, [])

  const suspendProcess = useCallback(async (pid: number) => {
    const count: number = await invoke("suspend_process", { pid })
    await refreshSuspendedPids()
    return count
  }, [])

  const resumeProcess = useCallback(async (pid: number) => {
    const count: number = await invoke("resume_process", { pid })
    await refreshSuspendedPids()
    return count
  }, [])

  const killProcess = useCallback(async (pid: number) => {
    await invoke("kill_process", { pid })
    await refreshProcesses()
  }, [refreshProcesses])

  const toggleShield = useCallback(() => {
    setIsShieldActive((prev) => !prev)
  }, [])

  useEffect(() => {
    refreshWfpStatus()
    refreshProcesses()
    refreshSuspendedPids()

    const interval = setInterval(() => {
      refreshProcesses()
    }, 2000)

    return () => clearInterval(interval)
  }, [refreshWfpStatus, refreshProcesses, refreshSuspendedPids])

  const blockedCount = processes.filter((p) => p.status === "blocked").length
  const blockedApps = processes.filter((p) => p.status === "blocked")

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
        blockedApps,
        blockApp,
        unblockApp,
        refreshProcesses,
        blockedCount,
        suspendProcess,
        resumeProcess,
        killProcess,
        suspendedPids,
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
