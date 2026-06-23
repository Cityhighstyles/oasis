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

  const handleSave = () => {
    updateBudgetSettings({
      dailyLimitMB: editDaily,
      weeklyLimitMB: editWeekly,
      monthlyLimitMB: editMonthly,
      thresholds: editThresholds,
      onExceed: editAction,
      essentialApps: editEssential,
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
