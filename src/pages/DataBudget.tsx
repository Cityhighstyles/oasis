import { useState, useMemo, useCallback, useRef } from "react"
import {
  Gauge,
  RotateCcw,
  Save,
  Bell,
  ShieldAlert,
  ListTodo,
  TrendingUp,
  Settings2,
  Flame,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  BarChart3,
  Clock,
  Download,
  Sliders,
  CalendarDays,
  Globe,
  Headphones,
  Gamepad2,
  MessageSquare,
  Cloud,
  Code2,
  Monitor,
  Ellipsis,
  PieChart,
  TrendingDown,
  Minus,
  ArrowRight,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { useShield, type BudgetExceedAction, type PerAppBudget } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

// ══════════════════════════════════════════════════════════════════════════
// MiniSparkline — tiny inline timeline bars
// ══════════════════════════════════════════════════════════════════════════

function MiniSparkline({ data, color, height = 48 }: { data: number[]; color: string; height?: number }) {
  const max = Math.max(1, ...data)
  const barCount = data.length
  const barWidth = Math.max(3, Math.min(16, 560 / Math.max(barCount, 1)))

  return (
    <div className="flex items-end gap-[2px] overflow-hidden" style={{ height }}>
      {data.map((val, i) => {
        const pct = (val / max) * 100
        return (
          <div
            key={i}
            className="rounded-[2px] transition-all duration-300"
            style={{
              height: `${Math.max(pct > 0 ? 2 : 1, pct)}%`,
              minHeight: "1px",
              backgroundColor: color,
              width: `${barWidth}px`,
            }}
          />
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// BarChart — simple horizontal bar chart for daily/monthly aggregates
// ══════════════════════════════════════════════════════════════════════════

interface BarChartItem {
  label: string
  value: number
  max: number
  color?: string
}

function BarChart({ items, color = "oklch(0.72 0.19 165)" }: { items: BarChartItem[]; color?: string }) {
  const globalMax = Math.max(1, ...items.map(i => i.max))
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => {
        const pct = (item.value / globalMax) * 100
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="w-8 text-[9px] font-medium text-muted-foreground/60 text-right shrink-0">
              {item.label}
            </span>
            <div className="flex-1 h-5 rounded-md bg-muted/30 overflow-hidden relative">
              <div
                className="h-full rounded-md transition-all duration-500"
                style={{
                  width: `${Math.max(1, pct)}%`,
                  backgroundColor: item.color || color,
                }}
              />
            </div>
            <span className="w-16 text-[9px] font-mono tabular-nums text-right text-foreground shrink-0">
              {item.value.toFixed(1)} MB
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// PerAppLimitInput — inline limit editor for a single app
// ══════════════════════════════════════════════════════════════════════════

function PerAppLimitInput({ exe, name, currentLimit, currentAutoBlock, onSet, onRemove }: {
  exe: string
  name: string
  currentLimit: number
  currentAutoBlock: boolean
  onSet: (exe: string, name: string, limitMB: number, autoBlock: boolean) => void
  onRemove: (exe: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editLimit, setEditLimit] = useState(currentLimit)
  const [editAutoBlock, setEditAutoBlock] = useState(currentAutoBlock)

  if (!editing && currentLimit === 0) {
    return (
      <button
        onClick={() => { setEditLimit(0); setEditAutoBlock(true); setEditing(true) }}
        className="text-[9px] text-muted-foreground/40 hover:text-neon-cyan transition-colors"
      >
        + Set limit
      </button>
    )
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono tabular-nums text-neon-cyan">{currentLimit}</span>
        <button
          onClick={() => { setEditLimit(currentLimit); setEditAutoBlock(currentAutoBlock); setEditing(true) }}
          className="text-[9px] text-muted-foreground/30 hover:text-foreground transition-colors"
        >
          ✎
        </button>
        <button
          onClick={() => onRemove(exe)}
          className="text-[9px] text-muted-foreground/20 hover:text-destructive transition-colors"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        value={editLimit}
        onChange={(e) => setEditLimit(Math.max(0, Number(e.target.value) || 0))}
        className="w-14 h-6 text-[10px] font-mono text-right bg-muted/50 border border-border rounded px-1 outline-none focus:border-neon-cyan"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (editLimit > 0) onSet(exe, name, editLimit, editAutoBlock)
            else onRemove(exe)
            setEditing(false)
          }
          if (e.key === "Escape") setEditing(false)
        }}
        onBlur={() => {
          if (editLimit > 0) onSet(exe, name, editLimit, editAutoBlock)
          else onRemove(exe)
          setEditing(false)
        }}
      />
      <label className="flex items-center gap-0.5 cursor-pointer">
        <input
          type="checkbox"
          checked={editAutoBlock}
          onChange={(e) => setEditAutoBlock(e.target.checked)}
          className="size-2.5 accent-neon-emerald"
        />
        <span className="text-[8px] text-muted-foreground/40">auto</span>
      </label>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Burn-rate forecast helpers
// ══════════════════════════════════════════════════════════════════════════

type BurnForecast = {
  label: string
  detail: string
  type: 'on_track' | 'warning' | 'danger' | 'insufficient'
}

function forecastDaily(usedMB: number, limitMB: number): BurnForecast {
  if (usedMB >= limitMB) return { label: "Exhausted", detail: "Daily budget used up", type: "danger" }
  if (usedMB <= 0 || limitMB <= 0) return { label: "\u2014", detail: "No data yet", type: "insufficient" }

  const now = new Date()
  const minutesElapsed = now.getHours() * 60 + now.getMinutes()
  if (minutesElapsed < 5) return { label: "Collecting\u2026", detail: "Less than 5 min of data", type: "insufficient" }

  const hourlyRate = usedMB / (minutesElapsed / 60)
  const remainingMB = limitMB - usedMB
  const hoursUntilExhaust = remainingMB / hourlyRate
  const minsUntilExhaust = hoursUntilExhaust * 60

  if (minsUntilExhaust > 24 * 60 - minutesElapsed) {
    const endOfDayProjection = usedMB + hourlyRate * ((24 * 60 - minutesElapsed) / 60)
    const projectedGB = (endOfDayProjection / 1024).toFixed(1)
    return { label: `\u2248 ${projectedGB} GB today`, detail: `${hourlyRate.toFixed(0)} MB/hr \u00b7 under limit`, type: "on_track" }
  }

  const exhaustionDate = new Date(now.getTime() + hoursUntilExhaust * 60 * 60 * 1000)
  const timeStr = exhaustionDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return { label: `Exhaust by ${timeStr}`, detail: `${hourlyRate.toFixed(0)} MB/hr burn rate`, type: "warning" }
}

function forecastWeekly(usedMB: number, limitMB: number): BurnForecast {
  if (usedMB >= limitMB) return { label: "Exhausted", detail: "Weekly budget used up", type: "danger" }
  if (usedMB <= 0 || limitMB <= 0) return { label: "\u2014", detail: "No data yet", type: "insufficient" }

  const now = new Date()
  // getDay(): 0=Sun \u2192 map to Mon=1..Sun=7
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay()
  if (dayOfWeek < 1) return { label: "Collecting\u2026", detail: "Just started the week", type: "insufficient" }

  const dailyRate = usedMB / dayOfWeek
  const daysRemaining = 7 - dayOfWeek
  const projectedTotal = usedMB + dailyRate * daysRemaining
  const projectedGB = (projectedTotal / 1024).toFixed(1)
  const limitGB = (limitMB / 1024).toFixed(1)

  if (projectedTotal >= limitMB) {
    return { label: `Projected: ${projectedGB} GB`, detail: `Will exceed ${limitGB} GB limit`, type: "warning" }
  }
  return { label: `On track: ${projectedGB} GB`, detail: `${dailyRate.toFixed(0)} MB/day avg \u00b7 under ${limitGB} GB`, type: "on_track" }
}

function forecastMonthly(usedMB: number, limitMB: number): BurnForecast {
  if (usedMB >= limitMB) return { label: "Exhausted", detail: "Monthly budget used up", type: "danger" }
  if (usedMB <= 0 || limitMB <= 0) return { label: "\u2014", detail: "No data yet", type: "insufficient" }

  const now = new Date()
  const dayOfMonth = now.getDate()
  if (dayOfMonth < 1) return { label: "Collecting\u2026", detail: "Just started the month", type: "insufficient" }

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dailyRate = usedMB / dayOfMonth
  const daysRemaining = daysInMonth - dayOfMonth
  const projectedTotal = usedMB + dailyRate * daysRemaining
  const projectedGB = (projectedTotal / 1024).toFixed(1)
  const limitGB = (limitMB / 1024).toFixed(1)

  if (projectedTotal >= limitMB) {
    return { label: `Projected: ${projectedGB} GB`, detail: `Will exceed ${limitGB} GB limit`, type: "warning" }
  }
  return { label: `On track: ${projectedGB} GB`, detail: `${dailyRate.toFixed(0)} MB/day avg \u00b7 under ${limitGB} GB`, type: "on_track" }
}

// ══════════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════════

const THRESHOLD_OPTIONS = [
  { value: 50, label: "50%" },
  { value: 75, label: "75%" },
  { value: 90, label: "90%" },
  { value: 100, label: "100%" },
]

const EXCEED_ACTIONS: { value: BudgetExceedAction; label: string; desc: string }[] = [
  { value: "notify_only", label: "Notify Only", desc: "Show a toast warning" },
  { value: "block_non_essential", label: "Block Non-Essential", desc: "Auto-block apps not marked essential" },
  { value: "block_all", label: "Block All", desc: "Block everything except essential system apps" },
]

// ════════════════════════════════════════════════════════════════════════════════
// Category definitions for data usage aggregation
// ════════════════════════════════════════════════════════════════════════════════

interface DataCategory {
  id: string
  label: string
  icon: string
  color: string
  match: (exe: string) => boolean
}

const DATA_CATEGORIES: DataCategory[] = [
  { id: "browsers", label: "Browsers", icon: "Globe", color: "oklch(0.62 0.17 240)", match: e => /chrome\.exe|msedge\.exe|firefox\.exe|brave\.exe|opera\.exe|safari\.exe|vivaldi\.exe/i.test(e) },
  { id: "streaming", label: "Streaming", icon: "Headphones", color: "oklch(0.72 0.19 165)", match: e => /spotify\.exe|vlc\.exe|wmplayer\.exe|groove\.exe|mpc-hc\.exe|netflix/i.test(e) },
  { id: "gaming", label: "Gaming", icon: "Gamepad2", color: "oklch(0.7 0.2 35)", match: e => /steam\.exe|epicgameslauncher\.exe|battle\.net|origin\.exe|uplay\.exe|xbox\.exe|riot|valorant|league|ubisoft|blizzard|nvidia/i.test(e) },
  { id: "communication", label: "Communication", icon: "MessageSquare", color: "oklch(0.65 0.22 290)", match: e => /discord\.exe|slack\.exe|teams\.exe|zoom\.exe|skype\.exe|telegram|whatsapp|signal|outlook\.exe/i.test(e) },
  { id: "cloud", label: "Cloud Sync", icon: "Cloud", color: "oklch(0.7 0.15 60)", match: e => /onedrive\.exe|dropbox\.exe|googledrive|icloud|box\.exe|mega/i.test(e) },
  { id: "dev", label: "Development", icon: "Code2", color: "oklch(0.68 0.18 200)", match: e => /code\.exe|git\.exe|node\.exe|npm|docker|vscode|terminal|powershell|cmd\.exe|python/i.test(e) },
  { id: "system", label: "System", icon: "Monitor", color: "oklch(0.6 0.12 264)", match: e => /svchost|msmpeng|services|lsass|csrss|winlogon|wuauserv|searchindexer|compatTel|system|idle/i.test(e) },
]

/** Category ID to icon component mapping */
const CATEGORY_ICONS: Record<string, any> = {
  Globe, Headphones, Gamepad2, MessageSquare, Cloud, Code2, Monitor, Ellipsis,
}

// ══════════════════════════════════════════════════════════════════════════
// Week-over-week comparison helpers
// ══════════════════════════════════════════════════════════════════════════

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`
}

/** Compute the current ISO week key for display */
function getCurrentWeekLabel(): string {
  const now = new Date()
  const week = getISOWeek(now)
  // Compute Monday of this week
  const dayOfWeek = now.getDay() || 7 // Mon=1..Sun=7
  const monday = new Date(now)
  monday.setDate(now.getDate() - (dayOfWeek - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  return `${week} (${fmt(monday)} – ${fmt(sunday)})`
}

// ══════════════════════════════════════════════════════════════════════════
// DataBudget page
// ══════════════════════════════════════════════════════════════════════════

export function DataBudget() {
  const {
    budgetSettings,
    dailyUsedMB,
    weeklyUsedMB,
    monthlyUsedMB,
    thresholdsHitToday,
    budgetHistory,
    clearBudgetHistory,
    updateBudgetSettings,
    resetDataBudget,
    getBudgetStatus,
    processes,
    perAppBudgets,
    setPerAppBudget,
    removePerAppBudget,
  } = useShield()

  const [activeTab, setActiveTab] = useState<"settings" | "history">("settings")

  // ── Settings state ────────────────────────────────────────────────
  const [editDaily, setEditDaily] = useState(budgetSettings.dailyLimitMB)
  const [editWeekly, setEditWeekly] = useState(budgetSettings.weeklyLimitMB)
  const [editMonthly, setEditMonthly] = useState(budgetSettings.monthlyLimitMB)
  const [editThresholds, setEditThresholds] = useState<number[]>([...budgetSettings.thresholds])
  const [editAction, setEditAction] = useState<BudgetExceedAction>(budgetSettings.onExceed)
  const [editEssential, setEditEssential] = useState<string[]>([...budgetSettings.essentialApps])
  const [editCustomAlert, setEditCustomAlert] = useState(budgetSettings.customAlertMB)
  const [newEssentialApp, setNewEssentialApp] = useState("")
  const [saved, setSaved] = useState(false)

  const [synced, setSynced] = useState(false)
  if (!synced && activeTab === "settings") {
    setEditDaily(budgetSettings.dailyLimitMB)
    setEditWeekly(budgetSettings.weeklyLimitMB)
    setEditMonthly(budgetSettings.monthlyLimitMB)
    setEditThresholds([...budgetSettings.thresholds])
    setEditAction(budgetSettings.onExceed)
    setEditEssential([...budgetSettings.essentialApps])
    setEditCustomAlert(budgetSettings.customAlertMB)
    setSynced(true)
  }

  // Re-sync when switching back to settings tab
  const prevTabRef = useRef(activeTab)
  if (prevTabRef.current !== activeTab) {
    prevTabRef.current = activeTab
    if (activeTab === "settings") {
      setSynced(false)
    }
  }

  const status = useMemo(() => getBudgetStatus(), [getBudgetStatus, processes, dailyUsedMB, monthlyUsedMB])

  const dailyPct = Math.min((dailyUsedMB / Math.max(editDaily, 1)) * 100, 100)
  const weeklyPct = Math.min((weeklyUsedMB / Math.max(editWeekly, 1)) * 100, 100)
  const monthlyPct = Math.min((monthlyUsedMB / Math.max(editMonthly, 1)) * 100, 100)

  // ── Burn-rate forecasts ────────────────────────────────────────
  const dailyForecast = useMemo(() => forecastDaily(dailyUsedMB, editDaily), [dailyUsedMB, editDaily])
  const weeklyForecast = useMemo(() => forecastWeekly(weeklyUsedMB, editWeekly), [weeklyUsedMB, editWeekly])
  const monthlyForecast = useMemo(() => forecastMonthly(monthlyUsedMB, editMonthly), [monthlyUsedMB, editMonthly])

  const handleSave = () => {
    updateBudgetSettings({
      dailyLimitMB: editDaily,
      weeklyLimitMB: editWeekly,
      monthlyLimitMB: editMonthly,
      thresholds: editThresholds,
      onExceed: editAction,
      essentialApps: editEssential,
      customAlertMB: editCustomAlert,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const toggleThreshold = (val: number) => {
    setEditThresholds((prev) =>
      prev.includes(val) ? prev.filter((t) => t !== val) : [...prev, val].sort((a, b) => a - b)
    )
  }

  const addEssentialApp = () => {
    const trimmed = newEssentialApp.trim().toLowerCase()
    if (trimmed && !editEssential.includes(trimmed)) {
      setEditEssential((prev) => [...prev, trimmed])
    }
    setNewEssentialApp("")
  }

  const removeEssentialApp = (app: string) => {
    setEditEssential((prev) => prev.filter((a) => a !== app))
  }

  const topConsumers = useMemo(() =>
    [...processes]
      .sort((a, b) => b.sessionData - a.sessionData)
      .slice(0, 10),
    [processes]
  )

  // ── Category aggregates ───────────────────────────────────────────
  const categoryData = useMemo(() => {
    const cats = DATA_CATEGORIES.map(c => ({
      id: c.id,
      label: c.label,
      icon: c.icon,
      color: c.color,
      totalMB: 0,
      appCount: 0,
      apps: [] as string[],
    }))
    let otherMB = 0
    let otherCount = 0

    for (const proc of processes) {
      const matched = cats.find(c => {
        const rule = DATA_CATEGORIES.find(r => r.id === c.id)
        return rule ? rule.match(proc.exe) : false
      })
      if (matched) {
        matched.totalMB += proc.sessionData
        matched.appCount++
        matched.apps.push(proc.name)
      } else {
        otherMB += proc.sessionData
        otherCount++
      }
    }

    const all = [...cats, { id: "other", label: "Other", icon: "Ellipsis", color: "oklch(0.55 0.1 264)", totalMB: otherMB, appCount: otherCount, apps: [] }]
    const grandTotal = all.reduce((s, c) => s + c.totalMB, 0)

    // Sort by usage descending, keep "Other" last
    const sorted = all.filter(c => c.totalMB > 0).sort((a, b) => b.totalMB - a.totalMB)
    const otherEntry = sorted.find(c => c.id === "other")
    const rest = sorted.filter(c => c.id !== "other")
    return { categories: otherEntry ? [...rest, otherEntry] : rest, grandTotal }
  }, [processes])

  // ── History data ─────────────────────────────────────────────────

  // Timeline: raw usage values from snapshots
  const timelineUsage = useMemo(() => budgetHistory.map(s => s.usageMB), [budgetHistory])

  // Daily aggregates: group snapshots by day
  const dailyBars = useMemo(() => {
    const dayMap = new Map<string, number[]>()
    for (const snap of budgetHistory) {
      const day = snap.timestamp.slice(0, 10) // YYYY-MM-DD
      if (!dayMap.has(day)) dayMap.set(day, [])
      dayMap.get(day)!.push(snap.usageMB)
    }
    // Take the last value of each day as the daily total
    const entries: BarChartItem[] = []
    for (const [day, values] of dayMap) {
      const maxVal = Math.max(...values)
      const label = new Date(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
      entries.push({ label, value: maxVal, max: maxVal })
    }
    // Show last 14 days
    return entries.slice(-14)
  }, [budgetHistory])

  // ── Period comparison (week-over-week, day-over-day) ────────────
  const periodComparison = useMemo(() => {
    if (budgetHistory.length < 2) return null

    // Group by ISO week
    const weekMap = new Map<string, number>()
    // Group by day
    const dayMap = new Map<string, number>()

    for (const snap of budgetHistory) {
      const date = new Date(snap.timestamp)
      const weekKey = getISOWeek(date)
      const dayKey = snap.timestamp.slice(0, 10) // YYYY-MM-DD

      // Take the max value per period as the cumulative usage at that point
      const prevWeek = weekMap.get(weekKey) || 0
      if (snap.usageMB > prevWeek) weekMap.set(weekKey, snap.usageMB)

      const prevDay = dayMap.get(dayKey) || 0
      if (snap.usageMB > prevDay) dayMap.set(dayKey, snap.usageMB)
    }

    // Sort weeks chronologically
    const sortedWeeks = [...weekMap.entries()].sort(([a], [b]) => a.localeCompare(b))
    const sortedDays = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b))

    const todayKey = new Date().toISOString().slice(0, 10)
    const yesterdayDate = new Date()
    yesterdayDate.setDate(yesterdayDate.getDate() - 1)
    const yesterdayKey = yesterdayDate.toISOString().slice(0, 10)

    // Current week (the last week in data, which should be the ongoing week)
    const currentWeekEntry = sortedWeeks[sortedWeeks.length - 1]
    const prevWeekEntry = sortedWeeks.length >= 2 ? sortedWeeks[sortedWeeks.length - 2] : null

    // Today vs yesterday
    const todayUsage = dayMap.get(todayKey) || 0
    const yesterdayUsage = dayMap.get(yesterdayKey) || 0

    // This week total vs last week total
    const thisWeekMB = currentWeekEntry ? currentWeekEntry[1] : 0
    const lastWeekMB = prevWeekEntry ? prevWeekEntry[1] : 0
    const thisWeekLabel = currentWeekEntry ? currentWeekEntry[0] : ""
    const lastWeekLabel = prevWeekEntry ? prevWeekEntry[0] : ""

    return {
      // Week over week
      thisWeekMB,
      lastWeekMB,
      thisWeekLabel,
      lastWeekLabel,
      weekDelta: lastWeekMB > 0 ? ((thisWeekMB - lastWeekMB) / lastWeekMB) * 100 : null,
      hasWeekData: sortedWeeks.length >= 2,
      // Day over day
      todayMB: todayUsage,
      yesterdayMB: yesterdayUsage,
      dayDelta: yesterdayUsage > 0 ? ((todayUsage - yesterdayUsage) / yesterdayUsage) * 100 : null,
      hasDayData: yesterdayUsage > 0,
    }
  }, [budgetHistory])

  // Monthly aggregates
  const monthlyBars = useMemo(() => {
    const monthMap = new Map<string, number[]>()
    for (const snap of budgetHistory) {
      const month = snap.timestamp.slice(0, 7) // YYYY-MM
      if (!monthMap.has(month)) monthMap.set(month, [])
      monthMap.get(month)!.push(snap.usageMB)
    }
    const entries: BarChartItem[] = []
    for (const [month, values] of monthMap) {
      const maxVal = Math.max(...values)
      const label = new Date(month + "-01").toLocaleDateString(undefined, { month: "short", year: "2-digit" })
      entries.push({ label, value: maxVal, max: maxVal })
    }
    return entries
  }, [budgetHistory])

  // Export history as CSV
  const exportHistory = useCallback(() => {
    const lines = [
      "Timestamp,UsageMB,DailyLimitMB,MonthlyLimitMB",
      ...budgetHistory.map(s =>
        `${s.timestamp},${s.usageMB},${budgetSettings.dailyLimitMB},${budgetSettings.monthlyLimitMB}`
      ),
    ]
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `data-usage-history-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [budgetHistory, budgetSettings])

  // ── Ring SVG ─────────────────────────────────────────────────────
  const radius = 48
  const circumference = 2 * Math.PI * radius
  const dailyOffset = circumference - (dailyPct / 100) * circumference
  const weeklyOffset = circumference - (weeklyPct / 100) * circumference
  const monthlyOffset = circumference - (monthlyPct / 100) * circumference

  const dailyRingColor =
    dailyPct >= 100 ? "oklch(0.63 0.22 25)" :
    dailyPct >= 80 ? "oklch(0.75 0.16 80)" :
    "oklch(0.72 0.19 165)"

  const weeklyRingColor =
    weeklyPct >= 100 ? "oklch(0.63 0.22 25)" :
    weeklyPct >= 80 ? "oklch(0.75 0.16 80)" :
    "oklch(0.65 0.2 225)"

  const monthlyRingColor =
    monthlyPct >= 100 ? "oklch(0.63 0.22 25)" :
    monthlyPct >= 80 ? "oklch(0.75 0.16 80)" :
    "oklch(0.72 0.19 165)"

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Data Budget
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Set data limits, control notifications, and track historical usage
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={resetDataBudget}
            className="gap-1.5"
          >
            <RotateCcw className="size-3.5" />
            Reset Counters
          </Button>
          {activeTab === "settings" && (
            <Button
              size="sm"
              onClick={handleSave}
              className={cn(
                "gap-1.5 transition-all",
                saved
                  ? "bg-neon-emerald text-white hover:bg-neon-emerald"
                  : ""
              )}
            >
              {saved ? (
                <><CheckCircle2 className="size-3.5" /> Saved</>
              ) : (
                <><Save className="size-3.5" /> Save Settings</>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex items-center gap-1 border-b border-border">
        {[
          { key: "settings" as const, label: "Settings & Limits", icon: Settings2 },
          { key: "history" as const, label: "History & Trends", icon: BarChart3 },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-[11px] font-medium border-b-2 transition-all duration-150",
              activeTab === key
                ? "border-neon-emerald text-foreground"
                : "border-transparent text-muted-foreground/60 hover:text-foreground hover:border-muted-foreground/20"
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SETTINGS TAB */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeTab === "settings" && (
        <>
          {/* Usage Overview */}
          <div className="grid grid-cols-3 gap-6">
            {/* Daily Ring */}
            <Card className={cn(
              "border transition-all duration-300",
              dailyPct >= 100 ? "border-destructive/30 bg-destructive/5" :
              dailyPct >= 80 ? "border-amber-500/20 bg-amber-500/5" :
              "border-border bg-card"
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Gauge className="size-4" />
                  Daily Data Usage
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <div className="relative flex items-center justify-center">
                  <svg width="130" height="130" className="-rotate-90">
                    <circle cx="65" cy="65" r={radius} fill="none" stroke="oklch(0.2 0.012 264)" strokeWidth="10" />
                    <circle
                      cx="65" cy="65" r={radius}
                      fill="none"
                      stroke={dailyRingColor}
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={dailyOffset}
                      style={{
                        filter: `drop-shadow(0 0 6px ${dailyRingColor})`,
                        transition: "stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
                      }}
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className={cn(
                      "text-2xl font-bold tabular-nums",
                      dailyPct >= 100 ? "text-destructive" : dailyPct >= 80 ? "text-amber-400" : "text-foreground"
                    )}>
                      {dailyUsedMB}
                    </span>
                    <span className="text-[10px] text-muted-foreground">of {editDaily} MB</span>
                  </div>
                </div>
                <Progress value={dailyPct} className={cn(
                  "h-2 w-full",
                  dailyPct >= 100 ? "[&>div]:bg-destructive" :
                  dailyPct >= 80 ? "[&>div]:bg-amber-500" :
                  ""
                )} />
                <div className="flex items-center gap-2">
                  <Badge variant={dailyPct >= 100 ? "destructive" : dailyPct >= 80 ? "outline" : "outline"}
                    className={cn(
                      "text-xs",
                      dailyPct >= 80 && !(dailyPct >= 100) ? "border-amber-500/30 text-amber-400" : ""
                    )}
                  >
                    {dailyPct.toFixed(0)}% consumed
                  </Badge>
                  {dailyPct >= 100 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="size-3" /> EXCEEDED
                    </Badge>
                  )}
                </div>

                {/* Forecast */}
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <Clock className={cn("size-3", dailyForecast.type === "danger" ? "text-destructive" : dailyForecast.type === "warning" ? "text-amber-400" : dailyForecast.type === "on_track" ? "text-neon-emerald" : "text-muted-foreground/40")} />
                  <span className={cn("text-[10px] font-medium", dailyForecast.type === "danger" ? "text-destructive" : dailyForecast.type === "warning" ? "text-amber-400" : dailyForecast.type === "on_track" ? "text-foreground/80" : "text-muted-foreground/40")}>
                    {dailyForecast.label}
                  </span>
                  <span className="text-[8px] text-muted-foreground/40">{dailyForecast.detail}</span>
                </div>
              </CardContent>
            </Card>

            {/* Weekly Ring */}
            <Card className={cn(
              "border transition-all duration-300",
              weeklyPct >= 100 ? "border-destructive/30 bg-destructive/5" :
              weeklyPct >= 80 ? "border-amber-500/20 bg-amber-500/5" :
              "border-border bg-card"
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <CalendarDays className="size-4" />
                  Weekly Data Usage
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <div className="relative flex items-center justify-center">
                  <svg width="130" height="130" className="-rotate-90">
                    <circle cx="65" cy="65" r={radius} fill="none" stroke="oklch(0.2 0.012 264)" strokeWidth="10" />
                    <circle
                      cx="65" cy="65" r={radius}
                      fill="none"
                      stroke={weeklyRingColor}
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={weeklyOffset}
                      style={{
                        filter: `drop-shadow(0 0 6px ${weeklyRingColor})`,
                        transition: "stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
                      }}
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className={cn(
                      "text-2xl font-bold tabular-nums",
                      weeklyPct >= 100 ? "text-destructive" : weeklyPct >= 80 ? "text-amber-400" : "text-foreground"
                    )}>
                      {weeklyUsedMB}
                    </span>
                    <span className="text-[10px] text-muted-foreground">of {editWeekly} MB</span>
                  </div>
                </div>
                <Progress value={weeklyPct} className={cn(
                  "h-2 w-full",
                  weeklyPct >= 100 ? "[&>div]:bg-destructive" :
                  weeklyPct >= 80 ? "[&>div]:bg-amber-500" :
                  ""
                )} />
                <div className="flex items-center gap-2">
                  <Badge variant={weeklyPct >= 100 ? "destructive" : weeklyPct >= 80 ? "outline" : "outline"}
                    className={cn(
                      "text-xs",
                      weeklyPct >= 80 && !(weeklyPct >= 100) ? "border-amber-500/30 text-amber-400" : ""
                    )}
                  >
                    {weeklyPct.toFixed(0)}% consumed
                  </Badge>
                  {weeklyPct >= 100 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="size-3" /> EXCEEDED
                    </Badge>
                  )}
                </div>

                {/* Forecast */}
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <Clock className={cn("size-3", weeklyForecast.type === "danger" ? "text-destructive" : weeklyForecast.type === "warning" ? "text-amber-400" : weeklyForecast.type === "on_track" ? "text-neon-emerald" : "text-muted-foreground/40")} />
                  <span className={cn("text-[10px] font-medium", weeklyForecast.type === "danger" ? "text-destructive" : weeklyForecast.type === "warning" ? "text-amber-400" : weeklyForecast.type === "on_track" ? "text-foreground/80" : "text-muted-foreground/40")}>
                    {weeklyForecast.label}
                  </span>
                  <span className="text-[8px] text-muted-foreground/40">{weeklyForecast.detail}</span>
                </div>
              </CardContent>
            </Card>

            {/* Monthly Ring */}
            <Card className={cn(
              "border transition-all duration-300",
              monthlyPct >= 100 ? "border-destructive/30 bg-destructive/5" :
              monthlyPct >= 80 ? "border-amber-500/20 bg-amber-500/5" :
              "border-border bg-card"
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp className="size-4" />
                  Monthly Data Usage
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <div className="relative flex items-center justify-center">
                  <svg width="130" height="130" className="-rotate-90">
                    <circle cx="65" cy="65" r={radius} fill="none" stroke="oklch(0.2 0.012 264)" strokeWidth="10" />
                    <circle
                      cx="65" cy="65" r={radius}
                      fill="none"
                      stroke={monthlyRingColor}
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={monthlyOffset}
                      style={{
                        filter: `drop-shadow(0 0 6px ${monthlyRingColor})`,
                        transition: "stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
                      }}
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className={cn(
                      "text-2xl font-bold tabular-nums",
                      monthlyPct >= 100 ? "text-destructive" : monthlyPct >= 80 ? "text-amber-400" : "text-foreground"
                    )}>
                      {monthlyUsedMB}
                    </span>
                    <span className="text-[10px] text-muted-foreground">of {editMonthly} MB</span>
                  </div>
                </div>
                <Progress value={monthlyPct} className={cn(
                  "h-2 w-full",
                  monthlyPct >= 100 ? "[&>div]:bg-destructive" :
                  monthlyPct >= 80 ? "[&>div]:bg-amber-500" :
                  ""
                )} />
                <div className="flex items-center gap-2">
                  <Badge variant={monthlyPct >= 100 ? "destructive" : monthlyPct >= 80 ? "outline" : "outline"}
                    className={cn(
                      "text-xs",
                      monthlyPct >= 80 && !(monthlyPct >= 100) ? "border-amber-500/30 text-amber-400" : ""
                    )}
                  >
                    {monthlyPct.toFixed(0)}% consumed
                  </Badge>
                  {monthlyPct >= 100 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="size-3" /> EXCEEDED
                    </Badge>
                  )}
                </div>

                {/* Forecast */}
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <Clock className={cn("size-3", monthlyForecast.type === "danger" ? "text-destructive" : monthlyForecast.type === "warning" ? "text-amber-400" : monthlyForecast.type === "on_track" ? "text-neon-emerald" : "text-muted-foreground/40")} />
                  <span className={cn("text-[10px] font-medium", monthlyForecast.type === "danger" ? "text-destructive" : monthlyForecast.type === "warning" ? "text-amber-400" : monthlyForecast.type === "on_track" ? "text-foreground/80" : "text-muted-foreground/40")}>
                    {monthlyForecast.label}
                  </span>
                  <span className="text-[8px] text-muted-foreground/40">{monthlyForecast.detail}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-2 gap-6">
            <Card className="border-border bg-card">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <Settings2 className="size-4" />
                  Limit Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-5">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Daily Data Limit (MB)
                  </label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number" min={10} max={100000}
                      value={editDaily}
                      onChange={(e) => setEditDaily(Math.max(10, Number(e.target.value) || 10))}
                      className="w-32 font-mono text-sm"
                    />
                    <span className="text-xs text-muted-foreground">≈ {(editDaily / 1024).toFixed(1)} GB</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Weekly Data Limit (MB)
                  </label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number" min={30} max={500000}
                      value={editWeekly}
                      onChange={(e) => setEditWeekly(Math.max(30, Number(e.target.value) || 30))}
                      className="w-32 font-mono text-sm"
                    />
                    <span className="text-xs text-muted-foreground">≈ {(editWeekly / 1024).toFixed(1)} GB</span>
                  </div>
                </div>
                <Separator />
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Monthly Data Limit (MB)
                  </label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number" min={50} max={1000000}
                      value={editMonthly}
                      onChange={(e) => setEditMonthly(Math.max(50, Number(e.target.value) || 50))}
                      className="w-32 font-mono text-sm"
                    />
                    <span className="text-xs text-muted-foreground">≈ {(editMonthly / 1024).toFixed(1)} GB</span>
                  </div>
                </div>
                <Separator />
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Bell className="size-3.5 text-muted-foreground" />
                    <label className="text-xs font-medium text-muted-foreground">Notification Thresholds</label>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 mb-2">
                    Get notified when usage reaches these levels
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {THRESHOLD_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => toggleThreshold(value)}
                        className={cn(
                          "px-3 py-1.5 rounded-md text-xs font-medium border transition-all",
                          editThresholds.includes(value)
                            ? "border-neon-emerald/30 bg-neon-emerald/10 text-neon-emerald"
                            : "border-border text-muted-foreground hover:border-muted-foreground/30"
                        )}
                      >
                        {label}
                        {editThresholds.includes(value) && <span className="ml-1.5 text-neon-emerald">✓</span>}
                      </button>
                    ))}
                  </div>
                  {thresholdsHitToday.length > 0 && (
                    <p className="text-[10px] text-muted-foreground/60 mt-2">
                      Today's hit thresholds: {thresholdsHitToday.join("%, ")}%
                    </p>
                  )}
                </div>
                <Separator />
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <ShieldAlert className="size-3.5 text-muted-foreground" />
                    <label className="text-xs font-medium text-muted-foreground">When Budget is Exceeded</label>
                  </div>
                  <Select value={editAction} onValueChange={(val: BudgetExceedAction) => setEditAction(val)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXCEED_ACTIONS.map(({ value, label, desc }) => (
                        <SelectItem key={value} value={value}>
                          <div className="flex flex-col">
                            <span>{label}</span>
                            <span className="text-[10px] text-muted-foreground">{desc}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="size-3.5 text-muted-foreground" />
                    <label className="text-xs font-medium text-muted-foreground">Custom Alert Level</label>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 mb-2">
                    Get a one-time notification when usage reaches this absolute MB value (set to 0 to disable)
                  </p>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number" min={0} max={100000}
                      value={editCustomAlert}
                      onChange={(e) => setEditCustomAlert(Math.max(0, Number(e.target.value) || 0))}
                      className="w-32 font-mono text-sm"
                      placeholder="0 = off"
                    />
                    {editCustomAlert > 0 && (
                      <div className="flex items-center gap-1.5">
                        <div className={cn(
                          "h-1.5 w-16 rounded-full",
                          dailyUsedMB >= editCustomAlert ? "bg-destructive" :
                          dailyUsedMB >= editCustomAlert * 0.8 ? "bg-amber-500" :
                          "bg-muted/50"
                        )}>
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-300",
                              dailyUsedMB >= editCustomAlert ? "bg-destructive" : "bg-neon-cyan/70"
                            )}
                            style={{ width: `${Math.min((dailyUsedMB / Math.max(editCustomAlert, 1)) * 100, 100)}%` }}
                          />
                        </div>
                        <span className={cn(
                          "text-[10px] font-mono tabular-nums",
                          dailyUsedMB >= editCustomAlert ? "text-destructive" : "text-muted-foreground/80"
                        )}>
                          {dailyUsedMB.toFixed(0)} / {editCustomAlert} MB
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <ListTodo className="size-4" />
                  Essential Apps
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <p className="text-[10px] text-muted-foreground/60">
                  Essential apps are never auto-blocked when the budget is exceeded.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {editEssential.map((app) => (
                    <Badge key={app} variant="outline" className="gap-1 text-[10px] pr-1">
                      {app}
                      <button onClick={() => removeEssentialApp(app)} className="ml-0.5 hover:text-destructive transition-colors">
                        <XCircle className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="e.g. zoom.exe"
                    value={newEssentialApp}
                    onChange={(e) => setNewEssentialApp(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addEssentialApp() }}
                    className="flex-1 text-xs font-mono h-8"
                  />
                  <Button variant="outline" size="sm" onClick={addEssentialApp} className="h-8">Add</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Per-App Limits */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Sliders className="size-4" />
                Per-App Data Limits
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {processes.length > 0 ? (
                <div className="divide-y divide-border">
                  <div className="grid grid-cols-[1fr_80px_100px_80px] gap-3 px-5 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 bg-muted/20">
                    <span>Application</span>
                    <span className="text-right">Usage</span>
                    <span className="text-right">Limit (MB)</span>
                    <span className="text-center">Auto-Block</span>
                  </div>
                  {processes
                    .sort((a, b) => b.sessionData - a.sessionData)
                    .slice(0, 15)
                    .map((p) => {
                      const budget = perAppBudgets.find(b => b.exe.toLowerCase() === p.exe.toLowerCase())
                      const exceeded = budget && budget.limitMB > 0 && p.sessionData >= budget.limitMB
                      return (
                        <div
                          key={`${p.pid}-${p.exe}`}
                          className="grid grid-cols-[1fr_80px_100px_80px] gap-3 px-5 py-2 hover:bg-accent/20 transition-colors items-center"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                            <p className="text-[9px] font-mono text-muted-foreground/50 truncate">{p.exe}</p>
                          </div>
                          <p className={cn(
                            "text-xs tabular-nums font-medium text-right self-center",
                            exceeded ? "text-destructive" : "text-muted-foreground"
                          )}>
                            {p.sessionData.toFixed(1)}
                          </p>
                          <div className="flex justify-end self-center">
                            <PerAppLimitInput
                              exe={p.exe}
                              name={p.name}
                              currentLimit={budget?.limitMB || 0}
                              currentAutoBlock={budget?.autoBlock ?? false}
                              onSet={setPerAppBudget}
                              onRemove={removePerAppBudget}
                            />
                          </div>
                          <div className="flex justify-center self-center">
                            {exceeded ? (
                              <Badge variant="destructive" className="text-[9px] h-5">Blocked</Badge>
                            ) : budget && budget.limitMB > 0 ? (
                              <Badge variant="outline" className="text-[9px] h-5 border-neon-cyan/30 text-neon-cyan">
                                {budget.autoBlock ? "Auto" : "Limit"}
                              </Badge>
                            ) : (
                              <span className="text-[9px] text-muted-foreground/30">—</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                  <span>No process data available</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Consumers */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <Flame className="size-4 text-amber-400" />
                  Top Data Consumers
                </CardTitle>
                <Badge variant="outline" className="text-[9px]">{topConsumers.length} processes</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {topConsumers.length > 0 ? (
                <div className="divide-y divide-border">
                  <div className="grid grid-cols-[24px_1fr_80px_80px_80px] gap-3 px-5 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 bg-muted/20">
                    <span>#</span><span>Application</span><span className="text-right">Usage</span><span className="text-right">% of Daily</span><span className="text-right">Status</span>
                  </div>
                  {topConsumers.map((p, i) => {
                    const pctOfDaily = editDaily > 0 ? ((p.sessionData / editDaily) * 100) : 0
                    return (
                      <div key={`${p.pid}-${p.exe}`} className="grid grid-cols-[24px_1fr_80px_80px_80px] gap-3 px-5 py-2.5 hover:bg-accent/20 transition-colors items-center">
                        <span className={cn("text-xs font-bold tabular-nums text-center", i === 0 ? "text-amber-400" : "text-muted-foreground/40")}>{i + 1}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                          <p className="text-[9px] font-mono text-muted-foreground/50 truncate">{p.exe}</p>
                        </div>
                        <p className="text-xs tabular-nums font-medium text-right self-center">{p.sessionData.toFixed(1)} MB</p>
                        <p className={cn("text-xs tabular-nums font-medium text-right self-center", pctOfDaily > 50 ? "text-amber-400" : "text-muted-foreground/80")}>{pctOfDaily.toFixed(1)}%</p>
                        <p className="text-right self-center">
                          {p.status === "blocked" ? (
                            <Badge variant="destructive" className="text-[9px] h-5">Blocked</Badge>
                          ) : editEssential.some(e => p.exe.toLowerCase().includes(e.toLowerCase())) ? (
                            <Badge variant="outline" className="text-[9px] h-5 border-neon-emerald/30 text-neon-emerald">Essential</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] h-5 text-muted-foreground">Active</Badge>
                          )}
                        </p>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                  <span>No process data available yet</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Data by Category */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <PieChart className="size-4 text-neon-cyan" />
                  Data by Category
                </CardTitle>
                <Badge variant="outline" className="text-[9px]">
                  {categoryData.categories.reduce((s, c) => s + c.appCount, 0)} apps
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {categoryData.grandTotal > 0 ? (
                <div className="space-y-3">
                  {/* Stacked summary bar */}
                  <div className="flex h-3 rounded-full overflow-hidden bg-muted/40">
                    {categoryData.categories.map((cat) => {
                      const pct = (cat.totalMB / Math.max(categoryData.grandTotal, 1)) * 100
                      if (pct < 1) return null
                      return (
                        <div
                          key={cat.id}
                          className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: cat.color,
                          }}
                          title={`${cat.label}: ${cat.totalMB.toFixed(1)} MB (${pct.toFixed(1)}%)`}
                        />
                      )
                    })}
                  </div>

                  {/* Category detail rows */}
                  <div className="space-y-1.5 pt-1">
                    {categoryData.categories.map((cat) => {
                      const pct = (cat.totalMB / Math.max(categoryData.grandTotal, 1)) * 100
                      const Icon = CATEGORY_ICONS[cat.icon]
                      return (
                        <div
                          key={cat.id}
                          className="group grid grid-cols-[auto_1fr_auto] gap-3 items-center py-1.5 px-2 rounded-md hover:bg-accent/20 transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {Icon && <Icon className="size-3.5 shrink-0" style={{ color: cat.color }} />}
                            <span className="text-xs font-medium text-foreground truncate">{cat.label}</span>
                          </div>
                          <div className="h-4 rounded-sm bg-muted/20 overflow-hidden">
                            <div
                              className="h-full rounded-sm transition-all duration-500"
                              style={{
                                width: `${Math.max(pct > 0 ? 1 : 0, pct)}%`,
                                backgroundColor: cat.color,
                                opacity: 0.7,
                              }}
                            />
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs font-mono tabular-nums text-foreground/80 text-right w-14">
                              {cat.totalMB.toFixed(1)} MB
                            </span>
                            <span className="text-[9px] text-muted-foreground/50 w-8 text-right">
                              {pct.toFixed(0)}%
                            </span>
                            {cat.appCount > 1 && (
                              <Badge variant="outline" className="text-[8px] h-4 px-1 border-border/50 text-muted-foreground/60 w-7 justify-center">
                                {cat.appCount}
                              </Badge>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                  <span>No process data available yet</span>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* HISTORY TAB */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {/* Intra-day timeline sparkline */}
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border py-3 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium text-foreground">Usage Timeline</CardTitle>
                  <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">
                    {budgetHistory.length} snapshots
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-[10px] border-border" onClick={exportHistory} disabled={budgetHistory.length === 0}>
                    <Download className="size-3 mr-1" />
                    Export CSV
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-[10px] border-border" onClick={clearBudgetHistory} disabled={budgetHistory.length === 0}>
                    <RotateCcw className="size-3 mr-1" />
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {budgetHistory.length >= 2 ? (
                <div className="space-y-6">
                  {/* Sparkline */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-medium text-neon-cyan flex items-center gap-1">
                        <Gauge className="size-3" /> Data Usage (MB)
                      </span>
                      <span className="text-[9px] text-muted-foreground/60">
                        Current: {dailyUsedMB} MB
                      </span>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <MiniSparkline data={timelineUsage} color="oklch(0.72 0.19 165)" height={48} />
                    </div>
                    <div className="flex justify-between text-[8px] text-muted-foreground/40 mt-1">
                      <span>{budgetHistory[0]?.timestamp.slice(11, 19) || "start"}</span>
                      <span>{budgetHistory[budgetHistory.length - 1]?.timestamp.slice(11, 19) || "now"}</span>
                    </div>
                  </div>

                  {/* Period Comparison */}
                  {periodComparison && (periodComparison.hasDayData || periodComparison.hasWeekData) && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <TrendingUp className="size-3.5 text-neon-cyan" />
                        <span className="text-[11px] font-medium text-foreground">Period Comparison</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        {/* Day over day */}
                        <div className="rounded-lg border border-border bg-muted/20 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                              Today vs Yesterday
                            </span>
                            {periodComparison.dayDelta !== null && (
                              <span className={cn(
                                "flex items-center gap-0.5 text-[10px] font-bold tabular-nums",
                                periodComparison.dayDelta > 5 ? "text-destructive" :
                                periodComparison.dayDelta < -5 ? "text-neon-emerald" :
                                "text-muted-foreground/60"
                              )}>
                                {periodComparison.dayDelta > 0 ? (
                                  <TrendingUp className="size-3" />
                                ) : periodComparison.dayDelta < 0 ? (
                                  <TrendingDown className="size-3" />
                                ) : (
                                  <Minus className="size-3" />
                                )}
                                {periodComparison.dayDelta > 0 ? "+" : ""}{periodComparison.dayDelta.toFixed(1)}%
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <div className="text-center flex-1">
                              <p className="text-lg font-bold text-foreground tabular-nums">
                                {periodComparison.todayMB.toFixed(0)}
                              </p>
                              <p className="text-[9px] text-muted-foreground/60">Today</p>
                            </div>
                            <div className="text-muted-foreground/20">
                              <ArrowRight className="size-4" />
                            </div>
                            <div className="text-center flex-1">
                              <p className="text-lg font-bold text-muted-foreground/70 tabular-nums">
                                {periodComparison.yesterdayMB.toFixed(0)}
                              </p>
                              <p className="text-[9px] text-muted-foreground/60">Yesterday</p>
                            </div>
                          </div>
                        </div>

                        {/* Week over week */}
                        <div className="rounded-lg border border-border bg-muted/20 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                              This Week vs Last Week
                            </span>
                            {periodComparison.hasWeekData && periodComparison.weekDelta !== null && (
                              <span className={cn(
                                "flex items-center gap-0.5 text-[10px] font-bold tabular-nums",
                                periodComparison.weekDelta > 5 ? "text-destructive" :
                                periodComparison.weekDelta < -5 ? "text-neon-emerald" :
                                "text-muted-foreground/60"
                              )}>
                                {periodComparison.weekDelta > 0 ? (
                                  <TrendingUp className="size-3" />
                                ) : periodComparison.weekDelta < 0 ? (
                                  <TrendingDown className="size-3" />
                                ) : (
                                  <Minus className="size-3" />
                                )}
                                {periodComparison.weekDelta > 0 ? "+" : ""}{periodComparison.weekDelta.toFixed(1)}%
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <div className="text-center flex-1">
                              <p className="text-lg font-bold text-foreground tabular-nums">
                                {periodComparison.thisWeekMB.toFixed(0)}
                              </p>
                              <p className="text-[9px] text-muted-foreground/60" title={getCurrentWeekLabel()}>
                                This Week
                              </p>
                            </div>
                            <div className="text-muted-foreground/20">
                              <ArrowRight className="size-4" />
                            </div>
                            <div className="text-center flex-1">
                              <p className="text-lg font-bold text-muted-foreground/70 tabular-nums">
                                {periodComparison.lastWeekMB.toFixed(0)}
                              </p>
                              <p className="text-[9px] text-muted-foreground/60">Last Week</p>
                            </div>
                          </div>
                          {!periodComparison.hasWeekData && (
                            <p className="text-[9px] text-muted-foreground/40 text-center mt-1">
                              Need 2+ weeks of data
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Daily trend bars */}
                  {dailyBars.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[11px] font-medium text-foreground flex items-center gap-1">
                          <BarChart3 className="size-3 text-neon-emerald" /> Daily Trend (last {dailyBars.length} days)
                        </span>
                        <span className="text-[9px] text-muted-foreground/60">
                          Max: {Math.max(...dailyBars.map(b => b.value)).toFixed(0)} MB
                        </span>
                      </div>
                      <BarChart items={dailyBars} color="oklch(0.72 0.19 165)" />
                    </div>
                  )}

                  {/* Monthly trend bars */}
                  {monthlyBars.length > 1 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[11px] font-medium text-foreground flex items-center gap-1">
                          <TrendingUp className="size-3 text-neon-cyan" /> Monthly Trend
                        </span>
                        <span className="text-[9px] text-muted-foreground/60">
                          Max: {Math.max(...monthlyBars.map(b => b.value)).toFixed(0)} MB
                        </span>
                      </div>
                      <BarChart items={monthlyBars} color="oklch(0.65 0.2 225)" />
                    </div>
                  )}

                  {/* Summary stats */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                      <p className="text-lg font-bold text-neon-emerald tabular-nums">{budgetHistory.length}</p>
                      <p className="text-[9px] text-muted-foreground">Snapshots</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                      <p className="text-lg font-bold text-neon-cyan tabular-nums">{dailyBars.length}</p>
                      <p className="text-[9px] text-muted-foreground">Days Tracked</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                      <p className="text-lg font-bold text-amber-400 tabular-nums">
                        {budgetHistory.length > 0 ? Math.max(...timelineUsage).toFixed(0) : "0"}
                      </p>
                      <p className="text-[9px] text-muted-foreground">Peak MB</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                      <p className="text-lg font-bold text-foreground tabular-nums">{monthlyBars.length}</p>
                      <p className="text-[9px] text-muted-foreground">Months</p>
                    </div>
                  </div>

                  {/* Raw data table */}
                  <details className="group">
                    <summary className="text-[10px] text-muted-foreground/60 cursor-pointer hover:text-foreground transition-colors">
                      View raw snapshot data ({budgetHistory.length} entries)
                    </summary>
                    <div className="mt-2 max-h-48 overflow-auto">
                      <table className="w-full text-[9px] font-mono">
                        <thead>
                          <tr className="text-muted-foreground/40 border-b border-border">
                            <th className="text-left py-1 pr-2">Time</th>
                            <th className="text-right pr-2">Usage</th>
                            <th className="text-right">vs Daily</th>
                          </tr>
                        </thead>
                        <tbody>
                          {budgetHistory.map((s, i) => (
                            <tr key={i} className="border-b border-border/30 hover:bg-accent/20">
                              <td className="py-1 pr-2 text-muted-foreground/60">{s.timestamp.slice(11, 19)}</td>
                              <td className={cn(
                                "text-right pr-2",
                                s.usageMB >= editDaily ? "text-destructive" : "text-neon-cyan"
                              )}>{s.usageMB.toFixed(1)} MB</td>
                              <td className={cn(
                                "text-right",
                                s.usageMB >= editDaily ? "text-destructive" : "text-muted-foreground/40"
                              )}>
                                {s.usageMB >= editDaily ? "EXCEEDED" : `${((s.usageMB / editDaily) * 100).toFixed(0)}%`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Clock className="size-8 text-muted-foreground/20 mb-2" />
                  <p className="text-xs">Not enough data yet</p>
                  <p className="text-[10px] text-muted-foreground/50 mt-1">
                    Usage snapshots are recorded every 60 seconds while the app tracks network activity
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
