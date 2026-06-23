import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"

export type ProcessStatus = "blocked" | "active" | "monitoring"

export type ProcessEntry = {
  pid: number
  name: string
  exe: string
  status: ProcessStatus
  sessionData: number
  speed: number
  connections: number
  lastSeen: string
}

export type Rule = {
  id: string
  name: string
  description: string
  enabled: boolean
  risk: "high" | "medium" | "low"
  targets: string[]
  dataBlockedBytes: number
}

export interface ProcessCarbonEntry {
  name: string
  exe: string
  footprintGrams: number
  savedGrams: number
}

export interface CarbonStats {
  carbonSavedGrams: number
  carbonFootprintGrams: number
  treesEquivalent: number
  processes: ProcessCarbonEntry[]
}

/** Snapshot of carbon data at a point in time (for timeline charts). */
export interface CarbonSnapshot {
  /** ISO timestamp */
  timestamp: string
  /** Cumulative saved grams at this point */
  savedGrams: number
  /** Cumulative footprint grams at this point */
  footprintGrams: number
}

// ── Focus mode types ───────────────────────────────────────────────────────

export interface DistractingApp {
  /** Executable name to match (e.g. "chrome.exe") */
  exe: string
  /** Display name */
  name: string
  /** Category like "social", "gaming", "video", "communication" */
  category: string
  /** Whether the user has selected this app for blocking */
  enabled: boolean
}

export interface FocusSession {
  id: string
  startTime: number
  /** Duration in seconds */
  duration: number
  /** Seconds actually focused */
  completedSeconds: number
  /** Whether the session was completed or interrupted */
  completed: boolean
  /** Number of distractions blocked during session */
  distractionsBlocked: number
}

// ── Privacy Sentinel types ────────────────────────────────────────────────────

/** Privacy risk level for an app */
export type PrivacyRisk = "critical" | "high" | "medium" | "low" | "safe"

/** Known tracking app entry with risk metadata */
export interface KnownTracker {
  /** Executable name (e.g. "chrome.exe") */
  exe: string
  /** Display name */
  name: string
  /** Risk category */
  risk: PrivacyRisk
  /** What data this app is known to collect */
  dataCollected: string[]
  /** Whether to auto-block this tracker */
  autoBlock: boolean
}

/** Per-process privacy assessment */
export interface PrivacyAssessment {
  /** Executable path */
  exe: string
  /** Display name */
  name: string
  /** Computed privacy score (0 = worst, 100 = best) */
  score: number
  /** Risk level */
  risk: PrivacyRisk
  /** Number of active connections */
  connections: number
  /** Data transferred in MB */
  dataMB: number
  /** Reasons this app got this score */
  reasons: string[]
  /** Whether this app is currently blocked */
  blocked: boolean
}

/** Privacy audit log entry */
export interface PrivacyAuditEntry {
  timestamp: string
  appName: string
  appExe: string
  event: string
  risk: PrivacyRisk
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
  // ── Rules system ────────────────────────────────────────────────────
  rules: Rule[]
  refreshRules: () => Promise<void>
  /**
   * Toggle a rule&#x27;s enabled state with an optimistic UI pattern:
   * 1. Immediately updates the local rules state optimistically.
   * 2. Calls the backend IPC command.
   * 3. On failure, reverts to the previous state.
   */
  toggleRule: (id: string, enabled: boolean) => Promise<void>
  /** Add a new custom rule and refresh the list. */
  addRule: (name: string, description: string, risk: string, targets: string[]) => Promise<void>
  /** Delete a rule by id and refresh the list. */
  deleteRule: (id: string) => Promise<void>
  // ── Carbon tracking ────────────────────────────────────────────────────
  carbonStats: CarbonStats
  refreshCarbonStats: () => Promise<void>
  resetCarbonTracker: () => Promise<void>
  // ── Carbon history ─────────────────────────────────────────────────────
  carbonHistory: CarbonSnapshot[]
  clearCarbonHistory: () => void
  // ── Focus mode / Digital Wellness ──────────────────────────────────────
  isFocusMode: boolean
  focusTimeLeft: number
  focusDuration: number
  distractingApps: DistractingApp[]
  todayFocusMinutes: number
  focusStreak: number
  currentSessionDistractions: number
  startFocusSession: (duration: number) => void
  stopFocusSession: () => void
  toggleDistractingApp: (exe: string) => void
  resetFocusStats: () => void
  // ── Privacy Sentinel ────────────────────────────────────────────────────
  knownTrackers: KnownTracker[]
  privacyAssessments: PrivacyAssessment[]
  privacyAuditLog: PrivacyAuditEntry[]
  overallPrivacyScore: number
  toggleTrackerBlock: (exe: string) => void
  refreshPrivacyAssessments: () => void
  clearAuditLog: () => void
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

  // ── Carbon state ──────────────────────────────────────────────────────
  const [carbonStats, setCarbonStats] = useState<CarbonStats>({
    carbonSavedGrams: 0,
    carbonFootprintGrams: 0,
    treesEquivalent: 0,
    processes: [],
  })

  const refreshCarbonStats = useCallback(async () => {
    try {
      const data: CarbonStats = await invoke("get_carbon_stats")
      setCarbonStats(data)
    } catch (err) {
      console.error("Failed to fetch carbon stats:", err)
    }
  }, [])

  const resetCarbonTracker = useCallback(async () => {
    try {
      await invoke("reset_carbon_tracker")
      await refreshCarbonStats()
    } catch (err) {
      console.error("Failed to reset carbon tracker:", err)
    }
  }, [refreshCarbonStats])

  // ── Carbon history (timeline snapshots) ─────────────────────────────────
  const [carbonHistory, setCarbonHistory] = useState<CarbonSnapshot[]>(() => {
    try {
      const saved = localStorage.getItem("carbon_history")
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  // Record a carbon snapshot every 30 seconds when the app has carbon data
  const lastSnapshotRef = useRef(0)
  useEffect(() => {
    if (carbonStats.carbonSavedGrams <= 0 && carbonStats.carbonFootprintGrams <= 0) return

    const now = Date.now()
    if (now - lastSnapshotRef.current < 30000) return // min 30s between snapshots
    lastSnapshotRef.current = now

    const snapshot: CarbonSnapshot = {
      timestamp: new Date().toISOString(),
      savedGrams: carbonStats.carbonSavedGrams,
      footprintGrams: carbonStats.carbonFootprintGrams,
    }
    setCarbonHistory((prev) => {
      const updated = [...prev, snapshot].slice(-96) // keep last 48min (96 × 30s)
      localStorage.setItem("carbon_history", JSON.stringify(updated))
      return updated
    })
  }, [carbonStats])

  const clearCarbonHistory = useCallback(() => {
    setCarbonHistory([])
    localStorage.removeItem("carbon_history")
  }, [])

  // ── Focus / Digital Wellness state ──────────────────────────────────────
  const DEFAULT_DISTRACTING_APPS: DistractingApp[] = [
    // Social Media
    { exe: "chrome.exe", name: "Chrome", category: "social", enabled: true },
    { exe: "firefox.exe", name: "Firefox", category: "social", enabled: false },
    { exe: "msedge.exe", name: "Edge", category: "social", enabled: true },
    { exe: "brave.exe", name: "Brave", category: "social", enabled: false },
    // Communication
    { exe: "discord.exe", name: "Discord", category: "communication", enabled: true },
    { exe: "slack.exe", name: "Slack", category: "communication", enabled: false },
    { exe: "teams.exe", name: "Teams", category: "communication", enabled: false },
    // Gaming
    { exe: "steam.exe", name: "Steam", category: "gaming", enabled: true },
    { exe: "epicgameslauncher.exe", name: "Epic Games", category: "gaming", enabled: true },
    // Video / Entertainment
    { exe: "spotify.exe", name: "Spotify", category: "entertainment", enabled: false },
    { exe: "vlc.exe", name: "VLC", category: "entertainment", enabled: false },
    // Social / Other
    { exe: "twitter.exe", name: "Twitter/X", category: "social", enabled: true },
    { exe: "instagram.exe", name: "Instagram", category: "social", enabled: true },
  ]

  const [isFocusMode, setIsFocusMode] = useState(false)
  const [focusTimeLeft, setFocusTimeLeft] = useState(0)
  const [focusDuration, setFocusDuration] = useState(0)
  const [distractingApps, setDistractingApps] = useState<DistractingApp[]>(() => {
    try {
      const saved = localStorage.getItem("focus_distracting_apps")
      return saved ? JSON.parse(saved) : DEFAULT_DISTRACTING_APPS
    } catch {
      return DEFAULT_DISTRACTING_APPS
    }
  })
  const [todayFocusMinutes, setTodayFocusMinutes] = useState(() => {
    try {
      const saved = localStorage.getItem("focus_today_minutes")
      const date = localStorage.getItem("focus_today_date")
      const today = new Date().toDateString()
      return date === today ? Number(saved) || 0 : 0
    } catch { return 0 }
  })
  const [focusStreak, setFocusStreak] = useState(() => {
    try { return Number(localStorage.getItem("focus_streak")) || 0 }
    catch { return 0 }
  })
  const [currentSessionDistractions, setCurrentSessionDistractions] = useState(0)
  const focusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const focusSessionStartRef = useRef<number>(0)
  const blockedAppsDuringFocus = useRef<string[]>([])
  const sessionRecordedRef = useRef(false)

  // Persist distracting apps to localStorage
  useEffect(() => {
    localStorage.setItem("focus_distracting_apps", JSON.stringify(distractingApps))
  }, [distractingApps])

  // Persist today's focus minutes and streak
  useEffect(() => {
    localStorage.setItem("focus_today_minutes", String(todayFocusMinutes))
    localStorage.setItem("focus_today_date", new Date().toDateString())
  }, [todayFocusMinutes])

  // Persist focus streak
  useEffect(() => {
    localStorage.setItem("focus_streak", String(focusStreak))
  }, [focusStreak])

  // Helper to record session completion
  const recordFocusSession = useCallback((elapsedSeconds: number) => {
    const minutes = Math.round(elapsedSeconds / 60)
    if (minutes > 0) {
      setTodayFocusMinutes((prev) => prev + minutes)
    }
    // Update streak: if they completed a session, increment streak
    setFocusStreak((prev) => prev + 1)
  }, [])

  const startFocusSession = useCallback(async (duration: number) => {
    setIsFocusMode(true)
    setFocusDuration(duration)
    setFocusTimeLeft(duration)
    setCurrentSessionDistractions(0)
    focusSessionStartRef.current = Date.now()

    // Block currently-running distracting apps
    const enabledExes = distractingApps.filter(a => a.enabled).map(a => a.exe.toLowerCase())
    const pathsToBlock = processes
      .filter(p => enabledExes.includes(p.exe.toLowerCase()))
      .map(p => p.exe)
    // Deduplicate
    const uniquePaths = [...new Set(pathsToBlock)]
    blockedAppsDuringFocus.current = []
    for (const path of uniquePaths) {
      try {
        await blockApp(path)
        blockedAppsDuringFocus.current.push(path)
      } catch {
        // Silently skip if block fails
      }
    }

    sessionRecordedRef.current = false

    // Sync timer every second
    if (focusTimerRef.current) clearInterval(focusTimerRef.current)
    focusTimerRef.current = setInterval(() => {
      setFocusTimeLeft((prev) => {
        if (prev <= 1) {
          // Session complete
          setIsFocusMode(false)
          setFocusDuration(0)
          setFocusTimeLeft(0)
          if (focusTimerRef.current) clearInterval(focusTimerRef.current)

          // Record the session (guard against double-call)
          if (!sessionRecordedRef.current) {
            sessionRecordedRef.current = true
            const elapsed = Math.floor((Date.now() - focusSessionStartRef.current) / 1000)
            recordFocusSession(elapsed)
          }

          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [distractingApps, processes, blockApp, recordFocusSession])

  const stopFocusSession = useCallback(async () => {
    setIsFocusMode(false)
    setFocusDuration(0)
    setFocusTimeLeft(0)

    // Unblock apps that were blocked during this session
    for (const path of blockedAppsDuringFocus.current) {
      try {
        await unblockApp(path)
      } catch {
        // Silently skip
      }
    }
    blockedAppsDuringFocus.current = []

    // Record partial session if > 1 minute elapsed (guard against double-call)
    if (!sessionRecordedRef.current) {
      sessionRecordedRef.current = true
      const elapsed = Math.floor((Date.now() - focusSessionStartRef.current) / 1000)
      if (elapsed > 60) {
        recordFocusSession(elapsed)
      }
    }

    if (focusTimerRef.current) {
      clearInterval(focusTimerRef.current)
      focusTimerRef.current = null
    }
  }, [unblockApp, recordFocusSession])

  const toggleDistractingApp = useCallback((exe: string) => {
    setDistractingApps((prev) =>
      prev.map((app) =>
        app.exe === exe ? { ...app, enabled: !app.enabled } : app
      )
    )
  }, [])

  const resetFocusStats = useCallback(() => {
    setTodayFocusMinutes(0)
    setFocusStreak(0)
    localStorage.removeItem("focus_today_minutes")
    localStorage.removeItem("focus_today_date")
    localStorage.removeItem("focus_streak")
  }, [])

  // ── Privacy Sentinel state ──────────────────────────────────────────────
  const DEFAULT_KNOWN_TRACKERS: KnownTracker[] = [
    { exe: "chrome.exe", name: "Google Chrome", risk: "high", dataCollected: ["Browsing history", "Location", "Search queries", "Device identifiers"], autoBlock: false },
    { exe: "msedge.exe", name: "Microsoft Edge", risk: "high", dataCollected: ["Browsing history", "Location", "Search queries", "Diagnostic data"], autoBlock: false },
    { exe: "firefox.exe", name: "Mozilla Firefox", risk: "medium", dataCollected: ["Browsing history", "Telemetry"], autoBlock: false },
    { exe: "brave.exe", name: "Brave Browser", risk: "low", dataCollected: ["Basic telemetry"], autoBlock: false },
    { exe: "onedrive.exe", name: "Microsoft OneDrive", risk: "high", dataCollected: ["File metadata", "Sync activity", "File content"], autoBlock: true },
    { exe: "dropbox.exe", name: "Dropbox", risk: "high", dataCollected: ["File metadata", "Sync activity"], autoBlock: false },
    { exe: "discord.exe", name: "Discord", risk: "high", dataCollected: ["Messages", "Voice data", "Presence", "Game activity"], autoBlock: false },
    { exe: "slack.exe", name: "Slack", risk: "medium", dataCollected: ["Messages", "File uploads", "Presence"], autoBlock: false },
    { exe: "teams.exe", name: "Microsoft Teams", risk: "high", dataCollected: ["Messages", "Call data", "Presence", "File content"], autoBlock: false },
    { exe: "spotify.exe", name: "Spotify", risk: "medium", dataCollected: ["Listening history", "Device info", "Playlists"], autoBlock: false },
    { exe: "googleupdater.exe", name: "Google Updater", risk: "medium", dataCollected: ["Update checks", "System info"], autoBlock: true },
    { exe: "wuauserv.dll", name: "Windows Update", risk: "medium", dataCollected: ["System info", "Update history"], autoBlock: true },
    { exe: "searchindexer.exe", name: "Windows Search", risk: "medium", dataCollected: ["File index", "Search queries"], autoBlock: false },
    { exe: "compatTelRunner.exe", name: "Windows Compatibility Telemetry", risk: "high", dataCollected: ["Usage data", "Error reports", "Hardware info"], autoBlock: true },
  ]

  const [knownTrackers, setKnownTrackers] = useState<KnownTracker[]>(() => {
    try {
      const saved = localStorage.getItem("privacy_known_trackers")
      return saved ? JSON.parse(saved) : DEFAULT_KNOWN_TRACKERS
    } catch { return DEFAULT_KNOWN_TRACKERS }
  })

  const [privacyAuditLog, setPrivacyAuditLog] = useState<PrivacyAuditEntry[]>(() => {
    try {
      const saved = localStorage.getItem("privacy_audit_log")
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  // Persist tracker settings
  useEffect(() => {
    localStorage.setItem("privacy_known_trackers", JSON.stringify(knownTrackers))
  }, [knownTrackers])

  // Persist audit log (keep last 50 entries)
  useEffect(() => {
    const trimmed = privacyAuditLog.slice(-50)
    localStorage.setItem("privacy_audit_log", JSON.stringify(trimmed))
  }, [privacyAuditLog])

  const toggleTrackerBlock = useCallback((exe: string) => {
    setKnownTrackers((prev) =>
      prev.map((t) => t.exe === exe ? { ...t, autoBlock: !t.autoBlock } : t)
    )
  }, [])

  const clearAuditLog = useCallback(() => {
    setPrivacyAuditLog([])
    localStorage.removeItem("privacy_audit_log")
  }, [])

  // Compute privacy assessments from live processes
  const computeAssessments = useCallback((): PrivacyAssessment[] => {
    const trackerMap = new Map(knownTrackers.map(t => [t.exe.toLowerCase(), t]))

    return processes.map((proc) => {
      const tracker = trackerMap.get(proc.exe.toLowerCase())
      const reasons: string[] = []
      let score = 100

      // Factor 1: Connection count (more connections = higher data exfiltration risk)
      if (proc.connections > 50) { score -= 30; reasons.push(`${proc.connections} active connections — possible data exfiltration`) }
      else if (proc.connections > 20) { score -= 20; reasons.push(`${proc.connections} active connections — high network activity`) }
      else if (proc.connections > 5) { score -= 10; reasons.push(`${proc.connections} active connections`) }

      // Factor 2: Known tracking risk
      if (tracker) {
        const riskDeductions = { critical: 40, high: 25, medium: 15, low: 5, safe: 0 }
        score -= riskDeductions[tracker.risk]
        if (tracker.risk !== "safe") {
          reasons.push(`Known ${tracker.risk}-risk data collector`)
        }
      }

      // Factor 3: Data usage
      if (proc.sessionData > 500) { score -= 15; reasons.push(`Heavy data usage: ${proc.sessionData.toFixed(0)} MB`) }
      else if (proc.sessionData > 100 && !tracker) { score -= 5 }

      // Factor 4: Background activity (monitoring status with connections)
      if (proc.status === "monitoring" && proc.connections > 0 && !tracker) {
        score -= 5; reasons.push("Background network activity")
      }

      const risk: PrivacyRisk =
        score <= 30 ? "critical" :
        score <= 50 ? "high" :
        score <= 70 ? "medium" :
        score <= 85 ? "low" :
        "safe"

      return {
        exe: proc.exe,
        name: proc.name,
        score: Math.max(0, score),
        risk,
        connections: proc.connections,
        dataMB: proc.sessionData,
        reasons,
        blocked: proc.status === "blocked",
      }
    }).sort((a, b) => a.score - b.score) // Worst first
  }, [processes, knownTrackers])

  const [privacyAssessments, setPrivacyAssessments] = useState<PrivacyAssessment[]>([])

  const refreshPrivacyAssessments = useCallback(() => {
    const assessments = computeAssessments()
    setPrivacyAssessments(assessments)

    // Add audit entries for newly detected high-risk apps
    const now = new Date().toLocaleTimeString()
    setPrivacyAuditLog((prev) => {
      const newEntries: PrivacyAuditEntry[] = []
      for (const a of assessments) {
        if (a.risk === "critical" || a.risk === "high") {
          // Check if we already have an entry for this app recently
          const recent = prev.some(
            e => e.appExe === a.exe && e.risk === a.risk &&
                 e.timestamp.startsWith(now.slice(0, 2)) // same hour
          )
          if (!recent) {
            newEntries.push({
              timestamp: now,
              appName: a.name,
              appExe: a.exe,
              event: `${a.risk === "critical" ? "CRITICAL" : "HIGH"} privacy risk — ${a.reasons[0] || "excessive data collection"}`,
              risk: a.risk,
            })
          }
        }
      }
      return [...newEntries, ...prev]
    })
  }, [computeAssessments])

  // Recompute assessments every poll cycle
  useEffect(() => {
    refreshPrivacyAssessments()
  }, [processes, refreshPrivacyAssessments])

  const overallPrivacyScore = Math.round(
    privacyAssessments.length > 0
      ? privacyAssessments.reduce((s, a) => s + a.score, 0) / privacyAssessments.length
      : 100
  )

  // ── Rules state ───────────────────────────────────────────────────────
  const [rules, setRules] = useState<Rule[]>([])

  const refreshRules = useCallback(async () => {
    try {
      const data: Rule[] = await invoke("get_rules")
      setRules(data)
    } catch (err) {
      console.error("Failed to fetch rules:", err)
    }
  }, [])

  const toggleRule = useCallback(
    async (id: string, enabled: boolean) => {
      // 1. Optimistic update — flip immediately in local state
      const previous = rules
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled } : r))
      )

      try {
        // 2. Send the toggle to the Rust backend
        await invoke("toggle_rule_state", { id, enabled })
      } catch (err) {
        // 3. Revert on IPC failure
        setRules(previous)
        console.error(`Failed to toggle rule "${id}":`, err)
        throw err
      }
    },
    [rules]
  )

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

  const deleteRule = useCallback(
    async (id: string) => {
      await invoke("delete_rule", { id })
      await refreshRules()
    },
    [refreshRules]
  )

  const addRule = useCallback(
    async (name: string, description: string, risk: string, targets: string[]) => {
      await invoke("add_rule", { name, description, risk, targets })
      await refreshRules()
    },
    [refreshRules]
  )

  const toggleShield = useCallback(async () => {
    const newState = !isShieldActive
    setIsShieldActive(newState)
    // Sync shield state to the Rust backend so the engine can enforce
    // or release AutoBlockRegistry filters during its poll loop.
    try {
      await invoke("set_shield_active", { active: newState })
    } catch (err) {
      console.error("Failed to sync shield state:", err)
      setIsShieldActive(!newState) // revert on failure
    }
  }, [isShieldActive])

  useEffect(() => {
    refreshWfpStatus()
    refreshProcesses()
    refreshSuspendedPids()
    refreshRules()
    refreshCarbonStats()

    const interval = setInterval(() => {
      refreshProcesses()
    }, 2000)

    const carbonInterval = setInterval(() => {
      refreshCarbonStats()
    }, 5000)

    return () => {
      clearInterval(interval)
      clearInterval(carbonInterval)
    }
  }, [refreshWfpStatus, refreshProcesses, refreshSuspendedPids, refreshRules, refreshCarbonStats])

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
        rules,
        refreshRules,
        toggleRule,
        addRule,
        deleteRule,
        carbonStats,
        refreshCarbonStats,
        resetCarbonTracker,
        carbonHistory,
        clearCarbonHistory,
        isFocusMode,
        focusTimeLeft,
        focusDuration,
        distractingApps,
        todayFocusMinutes,
        focusStreak,
        currentSessionDistractions,
        startFocusSession,
        stopFocusSession,
        toggleDistractingApp,
        resetFocusStats,
        knownTrackers,
        privacyAssessments,
        privacyAuditLog,
        overallPrivacyScore,
        toggleTrackerBlock,
        refreshPrivacyAssessments,
        clearAuditLog,
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
