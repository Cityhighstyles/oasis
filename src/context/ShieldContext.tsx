import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
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

// ── Data Budget types ─────────────────────────────────────────────────────

export type BudgetExceedAction = "notify_only" | "block_non_essential" | "block_all"

export interface DataBudgetSettings {
  dailyLimitMB: number
  weeklyLimitMB: number
  monthlyLimitMB: number
  /** Notification thresholds as percentages (e.g. [50, 75, 90, 100]) */
  thresholds: number[]
  /** What to do when budget is exceeded */
  onExceed: BudgetExceedAction
  /** Executable names that are essential and should never be auto-blocked */
  essentialApps: string[]
  /** Custom absolute MB alert — fires once when usage reaches this level (0 = disabled) */
  customAlertMB: number
}

export interface DataBudgetPerProcess {
  exe: string
  name: string
  usageMB: number
}

export interface DataBudgetStatus {
  dailyUsedMB: number
  dailyLimitMB: number
  weeklyUsedMB: number
  weeklyLimitMB: number
  monthlyUsedMB: number
  monthlyLimitMB: number
  /** Which thresholds have been hit today (to avoid re-triggering) */
  thresholdsHit: number[]
  /** Whether the daily budget is currently exceeded */
  dailyExceeded: boolean
  /** Whether the weekly budget is currently exceeded */
  weeklyExceeded: boolean
  /** Whether the monthly budget is currently exceeded */
  monthlyExceeded: boolean
  /** Per-process breakdown */
  perProcess: DataBudgetPerProcess[]
}

/** Per-app data limit configuration */
export interface PerAppBudget {
  /** Executable name to match (e.g. "chrome.exe") */
  exe: string
  /** Display name */
  name: string
  /** Daily data limit in MB (0 = no limit) */
  limitMB: number
  /** Whether this app should be blocked when it exceeds its limit */
  autoBlock: boolean
}

/** Snapshot of data usage at a point in time (for timeline charts). */
export interface DataBudgetSnapshot {
  /** ISO timestamp */
  timestamp: string
  /** Cumulative MB used at this point */
  usageMB: number
}

const DEFAULT_BUDGET_SETTINGS: DataBudgetSettings = {
  dailyLimitMB: 500,
  weeklyLimitMB: 3500,
  monthlyLimitMB: 10000,
  thresholds: [50, 75, 90, 100],
  onExceed: "notify_only",
  essentialApps: [
    "svchost.exe",
    "msmpeng.exe",
    "services.exe",
    "lsass.exe",
    "csrss.exe",
    "winlogon.exe",
    "system",
    "idle",
  ],
  customAlertMB: 0,
}

type ShieldContextType = {
  isShieldActive: boolean
  toggleShield: () => void
  dataBudgetUsed: number
  dataBudgetTotal: number
  // ── Data Budget settings ──────────────────────────────────────────
  budgetSettings: DataBudgetSettings
  dailyUsedMB: number
  weeklyUsedMB: number
  monthlyUsedMB: number
  thresholdsHitToday: number[]
  budgetHistory: DataBudgetSnapshot[]
  clearBudgetHistory: () => void
  perAppBudgets: PerAppBudget[]
  setPerAppBudget: (exe: string, name: string, limitMB: number, autoBlock: boolean) => void
  removePerAppBudget: (exe: string) => void
  updateBudgetSettings: (settings: Partial<DataBudgetSettings>) => void
  resetDataBudget: () => Promise<void>
  getBudgetStatus: () => DataBudgetStatus
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
  focusSessions: FocusSession[]
  addDistractingApp: (exe: string, name: string, category: string) => void
  focusHistoryDays: { date: string; minutes: number }[]
  clearFocusSessions: () => void
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

  // ── Process action callbacks (defined early to avoid TDZ issues) ────────
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

  // ── Focus sessions history ─────────────────────────────────────────────
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>(() => {
    try {
      const saved = localStorage.getItem("focus_sessions")
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  // ── Multi-day focus minutes history ─────────────────────────────────────
  const [focusHistoryDays, setFocusHistoryDays] = useState<{ date: string; minutes: number }[]>(() => {
    try {
      const saved = localStorage.getItem("focus_history_days")
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

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

  // ── Persist focus sessions ──────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("focus_sessions", JSON.stringify(focusSessions.slice(-50)))
  }, [focusSessions])

  useEffect(() => {
    localStorage.setItem("focus_history_days", JSON.stringify(focusHistoryDays.slice(-90)))
  }, [focusHistoryDays])

  // Helper to record session completion
  const recordFocusSession = useCallback((elapsedSeconds: number) => {
    const minutes = Math.round(elapsedSeconds / 60)
    if (minutes > 0) {
      setTodayFocusMinutes((prev) => prev + minutes)

      // Update multi-day history
      const today = new Date().toISOString().slice(0, 10)
      setFocusHistoryDays((prev) => {
        const existing = prev.find(d => d.date === today)
        if (existing) {
          return prev.map(d => d.date === today ? { ...d, minutes: d.minutes + minutes } : d)
        }
        return [...prev, { date: today, minutes }].slice(-90)
      })
    }
    // Update streak
    setFocusStreak((prev) => prev + 1)
  }, [])

  // Create a focus session record
  const createFocusSessionRecord = useCallback((elapsedSeconds: number, completed: boolean) => {
    const session: FocusSession = {
      id: `focus_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      startTime: focusSessionStartRef.current,
      duration: focusDuration || Math.round(elapsedSeconds),
      completedSeconds: elapsedSeconds,
      completed,
      distractionsBlocked: currentSessionDistractions,
    }
    setFocusSessions((prev) => [session, ...prev].slice(-50))
  }, [focusDuration, currentSessionDistractions])

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
            createFocusSessionRecord(elapsed, true)
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
        createFocusSessionRecord(elapsed, false)
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

  const addDistractingApp = useCallback((exe: string, name: string, category: string) => {
    setDistractingApps((prev) => {
      if (prev.some(a => a.exe.toLowerCase() === exe.toLowerCase())) return prev
      return [...prev, { exe: exe.toLowerCase(), name, category, enabled: true }]
    })
  }, [])

  const clearFocusSessions = useCallback(() => {
    setFocusSessions([])
    setFocusHistoryDays([])
    localStorage.removeItem("focus_sessions")
    localStorage.removeItem("focus_history_days")
  }, [])

  const resetFocusStats = useCallback(() => {
    setTodayFocusMinutes(0)
    setFocusStreak(0)
    localStorage.removeItem("focus_today_minutes")
    localStorage.removeItem("focus_today_date")
    localStorage.removeItem("focus_streak")
  }, [])

  // ── Data Budget state ─────────────────────────────────────────────────────
  const [budgetSettings, setBudgetSettings] = useState<DataBudgetSettings>(() => {
    try {
      const saved = localStorage.getItem("budget_settings")
      return saved ? JSON.parse(saved) : DEFAULT_BUDGET_SETTINGS
    } catch { return DEFAULT_BUDGET_SETTINGS }
  })

  // Persist budget settings
  useEffect(() => {
    localStorage.setItem("budget_settings", JSON.stringify(budgetSettings))
  }, [budgetSettings])

  // Track daily, weekly & monthly usage with localStorage persistence and auto-rollover
  const [dailyUsedMB, setDailyUsedMB] = useState(() => {
    try {
      const savedDate = localStorage.getItem("budget_daily_date")
      const today = new Date().toDateString()
      if (savedDate !== today) {
        localStorage.removeItem("budget_daily_used")
        localStorage.setItem("budget_daily_date", today)
        return 0
      }
      return Number(localStorage.getItem("budget_daily_used")) || 0
    } catch { return 0 }
  })

    // ── Per-app budget limits ───────────────────────────────────────────────
  const [perAppBudgets, setPerAppBudgets] = useState<PerAppBudget[]>(() => {
    try {
      const saved = localStorage.getItem("budget_per_app")
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })


  const [weeklyUsedMB, setWeeklyUsedMB] = useState(() => {
    try {
      const savedWeek = localStorage.getItem("budget_weekly_key")
      const now = new Date()
      const startOfYear = new Date(now.getFullYear(), 0, 1)
      const days = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000)
      const week = Math.ceil((days + startOfYear.getDay() + 1) / 7)
      // With this:
      const currentWeek = `${now.getFullYear()}-W${String(week).padStart(2, "0")}`
      if (savedWeek !== currentWeek) {
        localStorage.removeItem("budget_weekly_used")
        localStorage.setItem("budget_weekly_key", currentWeek) // Fixed
        return 0
      }
      return Number(localStorage.getItem("budget_weekly_used")) || 0
    } catch { return 0 }
  })

  const [monthlyUsedMB, setMonthlyUsedMB] = useState(() => {
    try {
      const savedMonth = localStorage.getItem("budget_monthly_key")
      const currentMonth = `${new Date().getFullYear()}-${new Date().getMonth()}`
      if (savedMonth !== currentMonth) {
        localStorage.removeItem("budget_monthly_used")
        localStorage.setItem("budget_monthly_key", currentMonth)
        return 0
      }
      return Number(localStorage.getItem("budget_monthly_used")) || 0
    } catch { return 0 }
  })

  // Track which thresholds we've already notified about today
  const [thresholdsHitToday, setThresholdsHitToday] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem("budget_thresholds_hit")
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  // Track which executable paths have been auto-blocked via WFP due to budget
  const budgetBlockedExesRef = useRef<string[]>([])

  // Track whether the custom alert has been fired today (value stored prevents re-fire on same value)
  const customAlertFiredRef = useRef<number>(0)

  // Helper to persist daily/monthly usage
  const persistUsage = useCallback(() => {
    // Daily is saved via effect, but we also sync on refresh
  }, [])

  const enforceBudgetBlock = useCallback(async (currentMB: number) => {
    const exceeded = currentMB >= budgetSettings.dailyLimitMB
    if (!exceeded) {
      // Unblock if we previously blocked
      await unblockBudgetBlockedApps()
      return
    }

    if (budgetSettings.onExceed === "block_all") {
      // Block ALL processes via WFP — network stop while apps still run
      const uniqueExes = [...new Set(processes.map(p => p.exe))]
      for (const exe of uniqueExes) {
        if (!budgetBlockedExesRef.current.includes(exe)) {
          try {
            await blockApp(exe)
            budgetBlockedExesRef.current.push(exe)
          } catch {
            // Skip
          }
        }
      }
    } else if (budgetSettings.onExceed === "block_non_essential") {
      // Block only non-essential apps (skip those in the essential list)
      const exesToBlock = [...new Set(
        processes
          .filter(p => !budgetSettings.essentialApps.some(e => p.exe.toLowerCase().includes(e.toLowerCase())))
          .map(p => p.exe)
      )]
      for (const exe of exesToBlock) {
        if (!budgetBlockedExesRef.current.includes(exe)) {
          try {
            await blockApp(exe)
            budgetBlockedExesRef.current.push(exe)
          } catch {
            // Skip
          }
        }
      }
    }
  }, [processes, budgetSettings, blockApp])


    // Enforce per-app limits — runs in the same 5-second throttled check
  const enforcePerAppLimits = useCallback(async () => {
    if (perAppBudgets.length === 0) return

    // Deduplicate by exe to avoid blocking the same binary multiple times
    const processedExes = new Set<string>()
    for (const proc of processes) {
      const exeKey = proc.exe.toLowerCase()
      if (processedExes.has(exeKey)) continue
      processedExes.add(exeKey)

      const budget = perAppBudgets.find(
        p => p.exe.toLowerCase() === exeKey && p.limitMB > 0
      )
      if (!budget) continue

      const exceeded = proc.sessionData >= budget.limitMB
      const alreadyBlocked = perAppBlockedExesRef.current.includes(proc.exe)

      if (exceeded && budget.autoBlock && !alreadyBlocked) {
        try {
          await blockApp(proc.exe)
          perAppBlockedExesRef.current.push(proc.exe)
          toast.warning(`App data limit exceeded`, {
            description: `${proc.name} (${proc.exe}) used ${proc.sessionData.toFixed(0)} MB — limit is ${budget.limitMB} MB. Network blocked.`,
            duration: 5000,
          })
        } catch {
          // Skip
        }
      } else if (!exceeded && alreadyBlocked) {
        // Usage went back below limit (e.g. after reset) — unblock
        try {
          await unblockApp(proc.exe)
          perAppBlockedExesRef.current = perAppBlockedExesRef.current.filter(e => e !== proc.exe)
        } catch {
          // Skip
        }
      }
    }
  }, [processes, perAppBudgets, blockApp, unblockApp])



  useEffect(() => {
    localStorage.setItem("budget_daily_used", String(dailyUsedMB))
  }, [dailyUsedMB])

  useEffect(() => {
    localStorage.setItem("budget_weekly_used", String(weeklyUsedMB))
  }, [weeklyUsedMB])

  useEffect(() => {
    localStorage.setItem("budget_monthly_used", String(monthlyUsedMB))
  }, [monthlyUsedMB])

  useEffect(() => {
    localStorage.setItem("budget_thresholds_hit", JSON.stringify(thresholdsHitToday))
  }, [thresholdsHitToday])

  // DataBudget notification + auto-blocking — runs every time processes update
  const lastBudgetCheckRef = useRef(0)
  useEffect(() => {
    const totalMB = processes.reduce((sum, p) => sum + p.sessionData, 0)

    // Throttle checks to every 5 seconds
    const now = Date.now()
    if (now - lastBudgetCheckRef.current < 5000) return
    lastBudgetCheckRef.current = now

    // Update daily, weekly & monthly usage from the *max* of current processes + any previously recorded
    setDailyUsedMB((prev) => Math.max(Math.round(totalMB), prev))
    setWeeklyUsedMB((prev) => Math.max(Math.round(totalMB), prev))
    setMonthlyUsedMB((prev) => Math.max(Math.round(totalMB), prev))

    // Check thresholds
    const dailyPct = (totalMB / Math.max(budgetSettings.dailyLimitMB, 1)) * 100
    const weeklyPct = (totalMB / Math.max(budgetSettings.weeklyLimitMB, 1)) * 100
    const monthlyPct = (totalMB / Math.max(budgetSettings.monthlyLimitMB, 1)) * 100

    // Track which budget(s) crossed each threshold for correct notification text
    type ThresholdSource = { threshold: number; source: string }
    const thresholdSources: ThresholdSource[] = []
    for (const threshold of budgetSettings.thresholds) {
      if (!thresholdsHitToday.includes(threshold)) {
        const dailyHit = dailyPct >= threshold
        const weeklyHit = weeklyPct >= threshold
        const monthlyHit = monthlyPct >= threshold
        const parts: string[] = []
        if (dailyHit) parts.push('daily')
        if (weeklyHit) parts.push('weekly')
        if (monthlyHit) parts.push('monthly')
        if (parts.length > 0) {
          thresholdSources.push({ threshold, source: parts.join(' and ') })
        }
      }
    }

    for (const { threshold, source } of thresholdSources) {
      if (threshold < 100) {
        toast.warning(`Data Budget: ${threshold}% used`, {
          description: `You've used ${threshold}% of your ${source} data limit (${totalMB.toFixed(0)} MB).`,
          duration: 6000,
        })
      } else {
        // Exceeded — use error toast
        const exceeded = dailyPct >= 100 ? "daily" : weeklyPct >= 100 ? "weekly" : "monthly"
        toast.error(`Data Budget Exceeded!`, {
          description: `Your ${exceeded} data limit has been reached (${totalMB.toFixed(0)} MB).`,
          duration: 8000,
        })

        // Auto-block based on action setting
        if (budgetSettings.onExceed !== "notify_only") {
          toast.info(`Auto-blocking apps...`, {
            description: `Budget exceeded — blocking ${budgetSettings.onExceed === 'block_all' ? 'all network traffic' : 'non-essential apps'}.`,
            duration: 4000,
          })
          // We trigger the blocking asynchronously
          setTimeout(() => {
            enforceBudgetBlock(totalMB)
          }, 500)
        }
      }
    }

    // ── Custom absolute MB alert ─────────────────────────────────────
    const customAlert = budgetSettings.customAlertMB
    if (customAlert > 0 && totalMB >= customAlert && customAlertFiredRef.current !== customAlert) {
      customAlertFiredRef.current = customAlert
      toast.warning(`Data Budget: ${totalMB.toFixed(0)} MB used`, {
        description: `Custom alert: usage reached ${customAlert} MB (set in budget settings).`,
        duration: 6000,
      })
    }
    // Reset if usage drops below the alert level (e.g. after reset)
    if (customAlert > 0 && totalMB < customAlert && customAlertFiredRef.current === customAlert) {
      customAlertFiredRef.current = 0
    }

    // Collapse newlyHit from the new thresholdSources
    const newlyHit = thresholdSources.map(s => s.threshold)

    if (newlyHit.length > 0) {
      setThresholdsHitToday((prev) => {
        const updated = [...new Set([...prev, ...newlyHit])]
        return updated
      })
    }

    // Check per-app limits
    enforcePerAppLimits()

    // Check if usage has gone down (e.g. reset), clear thresholds
    if (totalMB === 0 && thresholdsHitToday.length > 0) {
      setThresholdsHitToday([])
      // Unblock any previously budget-blocked apps
      unblockBudgetBlockedApps()
    }
  }, [processes, budgetSettings, thresholdsHitToday, enforceBudgetBlock, enforcePerAppLimits])

  const unblockBudgetBlockedApps = useCallback(async () => {
    for (const exe of budgetBlockedExesRef.current) {
      try {
        await unblockApp(exe)
      } catch {
        // Skip
      }
    }
    budgetBlockedExesRef.current = []
  }, [unblockApp])

  const updateBudgetSettings = useCallback((settings: Partial<DataBudgetSettings>) => {
    setBudgetSettings((prev) => ({ ...prev, ...settings }))
  }, [])

  const getBudgetStatus = useCallback((): DataBudgetStatus => {
    const totalMB = processes.reduce((sum, p) => sum + p.sessionData, 0)
    return {
      dailyUsedMB,
      dailyLimitMB: budgetSettings.dailyLimitMB,
      weeklyUsedMB,
      weeklyLimitMB: budgetSettings.weeklyLimitMB,
      monthlyUsedMB,
      monthlyLimitMB: budgetSettings.monthlyLimitMB,
      thresholdsHit: thresholdsHitToday,
      dailyExceeded: dailyUsedMB >= budgetSettings.dailyLimitMB,
      weeklyExceeded: weeklyUsedMB >= budgetSettings.weeklyLimitMB,
      monthlyExceeded: monthlyUsedMB >= budgetSettings.monthlyLimitMB,
      perProcess: processes
        .sort((a, b) => b.sessionData - a.sessionData)
        .slice(0, 20)
        .map(p => ({ exe: p.exe, name: p.name, usageMB: p.sessionData })),
    }
  }, [processes, dailyUsedMB, weeklyUsedMB, monthlyUsedMB, budgetSettings, thresholdsHitToday])


  // Persist per-app budgets
  useEffect(() => {
    localStorage.setItem("budget_per_app", JSON.stringify(perAppBudgets))
  }, [perAppBudgets])

  // Track which executable paths have been auto-blocked via WFP due to per-app limits
  const perAppBlockedExesRef = useRef<string[]>([])

  const setPerAppBudget = useCallback((exe: string, name: string, limitMB: number, autoBlock: boolean) => {
    setPerAppBudgets((prev) => {
      const existing = prev.findIndex(p => p.exe === exe)
      if (existing >= 0) {
        const updated = [...prev]
        updated[existing] = { ...updated[existing], limitMB, autoBlock }
        return updated
      }
      return [...prev, { exe, name, limitMB, autoBlock }]
    })
  }, [])

  const removePerAppBudget = useCallback((exe: string) => {
    setPerAppBudgets((prev) => prev.filter(p => p.exe !== exe))
  }, [])

  // ── Data Budget history (timeline snapshots) ───────────────────────────
  const [budgetHistory, setBudgetHistory] = useState<DataBudgetSnapshot[]>(() => {
    try {
      const saved = localStorage.getItem("budget_history")
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  // Record a budget snapshot every 60 seconds when processes have data
  const lastBudgetSnapshotRef = useRef(0)
  useEffect(() => {
    const totalMB = processes.reduce((sum, p) => sum + p.sessionData, 0)
    if (totalMB <= 0) return

    const now = Date.now()
    if (now - lastBudgetSnapshotRef.current < 60000) return // min 60s between snapshots
    lastBudgetSnapshotRef.current = now

    const snapshot: DataBudgetSnapshot = {
      timestamp: new Date().toISOString(),
      usageMB: Math.round(totalMB * 10) / 10,
    }
    setBudgetHistory((prev) => {
      const updated = [...prev, snapshot].slice(-288) // keep last ~12 hours (288 × 60s)
      localStorage.setItem("budget_history", JSON.stringify(updated))
      return updated
    })
  }, [processes])

  const clearBudgetHistory = useCallback(() => {
    setBudgetHistory([])
    localStorage.removeItem("budget_history")
  }, [])

  const resetDataBudget = useCallback(async () => {
    setDailyUsedMB(0)
    setWeeklyUsedMB(0)
    setMonthlyUsedMB(0)
    setThresholdsHitToday([])
    localStorage.removeItem("budget_daily_used")
    localStorage.removeItem("budget_daily_date")
    localStorage.removeItem("budget_weekly_used")
    localStorage.removeItem("budget_weekly_key")
    localStorage.removeItem("budget_monthly_used")
    localStorage.removeItem("budget_monthly_key")
    localStorage.removeItem("budget_thresholds_hit")
    await unblockBudgetBlockedApps()
    // Unblock per-app blocked exes
    for (const exe of perAppBlockedExesRef.current) {
      try { await unblockApp(exe) } catch { }
    }
    perAppBlockedExesRef.current = []
  }, [unblockBudgetBlockedApps, unblockApp])

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
    }, [rules])

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
    // When deactivating, the backend also resumes all suspended PIDs.
    try {
      await invoke("set_shield_active", { active: newState })
      // Refresh suspended PIDs after shield toggle (backend may have resumed them)
      await refreshSuspendedPids()
    } catch (err) {
      console.error("Failed to sync shield state:", err)
      setIsShieldActive(!newState) // revert on failure
    }
  }, [isShieldActive, refreshSuspendedPids])

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
        budgetSettings,
        dailyUsedMB,
        weeklyUsedMB,
        monthlyUsedMB,
        thresholdsHitToday,
        budgetHistory,
        clearBudgetHistory,
        perAppBudgets,
        setPerAppBudget,
        removePerAppBudget,
        updateBudgetSettings,
        resetDataBudget,
        getBudgetStatus,
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
        focusSessions,
        addDistractingApp,
        focusHistoryDays,
        clearFocusSessions,
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
