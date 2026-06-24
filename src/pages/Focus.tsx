import { useState, useMemo } from "react"
import {
  Brain,
  Play,
  Square,
  Timer,
  Clock,
  Flame,
  Target,
  ShieldBan,
  ShieldCheck,
  Sparkles,
  Hourglass,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Search,
  SlidersHorizontal,
  Zap,
  Trophy,
  BarChart3,
  Plus,
  Trash2,
  History,
  ListChecks,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

// ── Duration presets ──────────────────────────────────────────────────────

const DURATIONS = [
  { label: "15 min", seconds: 15 * 60 },
  { label: "30 min", seconds: 30 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "2 hours", seconds: 120 * 60 },
]

const CATEGORIES = [
  { key: "all", label: "All Apps" },
  { key: "social", label: "Social Media" },
  { key: "communication", label: "Communication" },
  { key: "gaming", label: "Gaming" },
  { key: "entertainment", label: "Entertainment" },
] as const

// ── Category colors ───────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  social: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  communication: "text-sky-400 border-sky-500/30 bg-sky-500/10",
  gaming: "text-purple-400 border-purple-500/30 bg-purple-500/10",
  entertainment: "text-orange-400 border-orange-500/30 bg-orange-500/10",
}

// ══════════════════════════════════════════════════════════════════════════
// FocusPage
// ══════════════════════════════════════════════════════════════════════════

export function Focus() {
  const {
    isShieldActive,
    isFocusMode,
    focusTimeLeft,
    focusDuration,
    distractingApps,
    todayFocusMinutes,
    focusStreak,
    currentSessionDistractions,
    blockApp,
    unblockApp,
    startFocusSession,
    stopFocusSession,
    toggleDistractingApp,
    resetFocusStats,
    focusSessions,
    addDistractingApp,
    focusHistoryDays,
    clearFocusSessions,
  } = useShield()

  const [selectedDuration, setSelectedDuration] = useState(DURATIONS[1]) // default 30 min
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [newAppExe, setNewAppExe] = useState("")
  const [newAppName, setNewAppName] = useState("")
  const [newAppCategory, setNewAppCategory] = useState("social")

  const handleAddCustomApp = () => {
    const exe = newAppExe.trim()
    const name = newAppName.trim() || exe.replace(/\.exe$/i, "")
    if (exe) {
      addDistractingApp(exe, name, newAppCategory)
      setNewAppExe("")
      setNewAppName("")
    }
  }

  // ── Computed values ────────────────────────────────────────────────────

  const pct = focusDuration > 0 ? ((focusDuration - focusTimeLeft) / focusDuration) * 100 : 0
  const minutes = Math.floor(focusTimeLeft / 60)
  const seconds = focusTimeLeft % 60
  const enabledCount = distractingApps.filter((a) => a.enabled).length

  const ringColor = focusTimeLeft > 600 ? "#10b981" : focusTimeLeft > 120 ? "#f59e0b" : "#ef4444"

  // Filtered apps
  const filteredApps = useMemo(() => {
    let apps = distractingApps
    if (categoryFilter !== "all") {
      apps = apps.filter((a) => a.category === categoryFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      apps = apps.filter((a) => a.name.toLowerCase().includes(q) || a.exe.toLowerCase().includes(q))
    }
    return apps
  }, [distractingApps, categoryFilter, searchQuery])

  // Today's productivity score
  const productivityScore = useMemo(() => {
    if (todayFocusMinutes === 0) return 0
    const base = Math.min(100, (todayFocusMinutes / 120) * 100) // 2 hours = 100%
    return Math.round(base)
  }, [todayFocusMinutes])

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleStartFocus = () => {
    startFocusSession(selectedDuration.seconds)
  }

  const handleStopFocus = () => {
    stopFocusSession()
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Brain className="size-5 text-violet-400" />
            Digital Wellness
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Focus sessions, distraction blocking, and productivity insights
          </p>
        </div>
        {isFocusMode && (
          <div className="flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5">
            <span className="size-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-[11px] font-medium text-violet-400">Focus Active</span>
          </div>
        )}
      </div>

      {/* Alert: shield must be active */}
      {!isShieldActive && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="size-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-400">
            Enable the Data Shield first — focus mode blocks distracting apps using the WFP engine.
          </p>
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* LEFT COLUMN: Focus Timer */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          {/* Timer Card */}
          <Card
            className={cn(
              "border transition-all duration-500",
              isFocusMode
                ? "border-violet-500/30 bg-violet-500/5"
                : "border-border bg-card"
            )}
          >
            <CardContent className="flex flex-col items-center gap-5 py-7">
              {/* Circular timer */}
              <div className="relative">
                <svg width="180" height="180" className="-rotate-90">
                  <circle cx="90" cy="90" r="74" fill="none" stroke="oklch(0.2 0.012 264)" strokeWidth="8" />
                  <circle
                    cx="90" cy="90" r="74"
                    fill="none"
                    stroke={ringColor}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 74}
                    strokeDashoffset={2 * Math.PI * 74 * (1 - pct / 100)}
                    style={{
                      filter: isFocusMode ? `drop-shadow(0 0 8px ${ringColor})` : "none",
                      transition: "stroke-dashoffset 1s linear, stroke 0.5s ease",
                    }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  {isFocusMode ? (
                    <>
                      <span className="text-3xl font-bold tabular-nums text-foreground font-mono">
                        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
                      </span>
                      <span className="text-[10px] text-violet-400 font-semibold tracking-widest uppercase mt-1 flex items-center gap-1">
                        <Zap className="size-3" />
                        Focus Mode
                      </span>
                    </>
                  ) : (
                    <>
                      <Brain className="size-10 text-muted-foreground mb-1" />
                      <span className="text-xs text-muted-foreground">Ready to Focus</span>
                    </>
                  )}
                </div>
              </div>

              {/* Duration selector */}
              <div className="grid grid-cols-2 gap-2 w-full">
                {DURATIONS.map((d) => (
                  <button
                    key={d.label}
                    onClick={() => !isFocusMode && setSelectedDuration(d)}
                    disabled={isFocusMode}
                    className={cn(
                      "rounded-md border py-2 text-xs font-medium transition-all",
                      selectedDuration.label === d.label
                        ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                      isFocusMode && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 w-full">
                {!isFocusMode ? (
                  <Button
                    className="flex-1 gap-2 bg-violet-500/15 border border-violet-500/30 text-violet-400 hover:bg-violet-500/25 hover:text-violet-300"
                    variant="ghost"
                    onClick={handleStartFocus}
                    disabled={!isShieldActive || enabledCount === 0}
                  >
                    <Play className="size-4" />
                    Start Focus
                  </Button>
                ) : (
                  <Button
                    className="flex-1 gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20"
                    variant="ghost"
                    onClick={handleStopFocus}
                  >
                    <Square className="size-4" />
                    End Session
                  </Button>
                )}
                {!isFocusMode && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-border hover:bg-accent"
                    onClick={resetFocusStats}
                    title="Reset stats"
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Focus Tips */}
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border py-3 px-4">
              <div className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-violet-400" />
                <CardTitle className="text-xs font-medium text-foreground">
                  Focus Tips
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-3 space-y-2">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Blocking {enabledCount} distracting app{enabledCount !== 1 ? "s" : ""}. 
                Social media and gaming apps consume the most bandwidth and attention.
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                The WFP engine blocks these apps at the kernel level — they won't
                be able to send or receive any data during your focus session.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* RIGHT COLUMN: Apps + Stats */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: Timer, label: "Today's Focus", value: `${todayFocusMinutes}m`, sub: "total time", color: "text-violet-400" },
              { icon: Flame, label: "Streak", value: `${focusStreak} day${focusStreak !== 1 ? "s" : ""}`, sub: "consecutive", color: "text-orange-400" },
              { icon: Target, label: "Productivity", value: `${productivityScore}%`, sub: "daily score", color: "text-neon-emerald" },
              { icon: ShieldBan, label: "Blocked Apps", value: `${enabledCount}`, sub: "per session", color: "text-rose-400" },
            ].map(({ icon: Icon, label, value, sub, color }) => (
              <Card key={label} className="border-border bg-card">
                <CardContent className="flex items-center gap-3 py-3 px-4">
                  <Icon className={cn("size-5 shrink-0", color)} />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground truncate">{label}</p>
                    <p className={cn("text-base font-bold tabular-nums", color)}>{value}</p>
                    <p className="text-[10px] text-muted-foreground/60">{sub}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Distracting Apps Management */}
          <Card className="border-border bg-card overflow-hidden">
            <CardHeader className="border-b border-border py-3 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium text-foreground">
                    Apps to Block During Focus
                  </CardTitle>
                  <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">
                    {enabledCount}/{distractingApps.length} enabled
                  </Badge>
                </div>
                <div className="relative w-48">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                  <Input
                    placeholder="Search apps..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-7 pl-7 text-[11px] bg-background/50 border-border"
                  />
                </div>
              </div>

              {/* Add custom app */}
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40">
                <Input
                  placeholder="exe name (e.g. figma.exe)"
                  value={newAppExe}
                  onChange={(e) => setNewAppExe(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddCustomApp() }}
                  className="h-7 text-[10px] font-mono flex-1 bg-background/50 border-border"
                  disabled={isFocusMode}
                />
                <Input
                  placeholder="Display name (optional)"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddCustomApp() }}
                  className="h-7 text-[10px] w-36 bg-background/50 border-border"
                  disabled={isFocusMode}
                />
                <select
                  value={newAppCategory}
                  onChange={(e) => setNewAppCategory(e.target.value)}
                  className="h-7 text-[10px] bg-background/50 border border-border rounded-md px-2 text-muted-foreground"
                  disabled={isFocusMode}
                >
                  <option value="social">Social</option>
                  <option value="communication">Communication</option>
                  <option value="gaming">Gaming</option>
                  <option value="entertainment">Entertainment</option>
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-[10px] text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                  onClick={handleAddCustomApp}
                  disabled={isFocusMode || !newAppExe.trim()}
                >
                  <Plus className="size-3" />
                  Add
                </Button>
              </div>

              {/* Category filter tabs */}
              <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/40">
                {CATEGORIES.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setCategoryFilter(key)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150",
                      categoryFilter === key
                        ? "bg-accent text-foreground shadow-sm"
                        : "text-muted-foreground/60 hover:text-foreground hover:bg-accent/40"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {filteredApps.length > 0 ? (
                <div className="divide-y divide-border">
                  {filteredApps.map((app) => (
                    <div
                      key={app.exe}
                      className={cn(
                        "flex items-center gap-3 px-5 py-3 transition-colors",
                        app.enabled ? "bg-violet-500/[0.02]" : "hover:bg-accent/20"
                      )}
                    >
                      {/* Toggle */}
                      <button
                        onClick={() => !isFocusMode && toggleDistractingApp(app.exe)}
                        disabled={isFocusMode}
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-md border transition-all duration-200",
                          app.enabled
                            ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
                            : "border-border text-muted-foreground/40 hover:border-muted-foreground/30",
                          isFocusMode && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {app.enabled ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : (
                          <div className="size-3.5 rounded-[2px] border border-border" />
                        )}
                      </button>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={cn(
                            "text-xs font-medium",
                            app.enabled ? "text-foreground" : "text-muted-foreground/60"
                          )}>
                            {app.name}
                          </p>
                          <span className={cn(
                            "text-[8px] font-medium px-1.5 py-0.5 rounded-full border",
                            CAT_COLORS[app.category] || "text-muted-foreground border-border bg-muted/30"
                          )}>
                            {app.category}
                          </span>
                        </div>
                        <p className={cn(
                          "text-[10px] font-mono",
                          app.enabled ? "text-muted-foreground/70" : "text-muted-foreground/30"
                        )}>
                          {app.exe}
                        </p>
                      </div>

                      {/* Status badge */}
                      {app.enabled && (
                        <Badge
                          variant="outline"
                          className="text-[8px] border-violet-500/20 text-violet-400 bg-violet-500/5 uppercase tracking-wider h-4"
                        >
                          Blocking
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                  <div className="flex flex-col items-center gap-1">
                    <Search className="size-6 text-muted-foreground/20" />
                    <p>No apps match your filter</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Focus Trends */}
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border py-3 px-5">
              <div className="flex items-center gap-2">
                <BarChart3 className="size-4 text-neon-cyan" />
                <CardTitle className="text-sm font-medium text-foreground">
                  Focus Trends
                </CardTitle>
                <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">
                  {focusHistoryDays.length} days
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {focusHistoryDays.length > 0 ? (
                <div className="space-y-2">
                  {/* Mini bar chart - last 14 days */}
                  <div className="flex items-end gap-1 h-20">
                    {(() => {
                      const days = focusHistoryDays.slice(-14)
                      const maxMin = Math.max(1, ...days.map(d => d.minutes))
                      return days.map((day) => {
                        const pct = (day.minutes / maxMin) * 100
                        const isToday = day.date === new Date().toISOString().slice(0, 10)
                        return (
                          <div
                            key={day.date}
                            className="flex-1 flex flex-col items-center gap-0.5 group relative"
                          >
                            <div
                              className={cn(
                                "w-full rounded-sm transition-all duration-300",
                                isToday ? "bg-violet-400" : "bg-violet-500/40 hover:bg-violet-500/60"
                              )}
                              style={{ height: `${Math.max(pct, 2)}%` }}
                            />
                            <span className={cn(
                              "text-[7px] font-mono",
                              isToday ? "text-violet-400" : "text-muted-foreground/40"
                            )}>
                              {new Date(day.date).toLocaleDateString(undefined, { weekday: "narrow" })}
                            </span>
                            {/* Tooltip on hover */}
                            <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center">
                              <span className="text-[9px] bg-popover border border-border rounded px-1.5 py-0.5 whitespace-nowrap">
                                {new Date(day.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                : {day.minutes}m
                              </span>
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                  <div className="flex items-center justify-between text-[9px] text-muted-foreground/60">
                    <span>Last {Math.min(focusHistoryDays.length, 14)} days</span>
                    <span>
                      Avg: {Math.round(focusHistoryDays.slice(-14).reduce((s, d) => s + d.minutes, 0) / Math.max(focusHistoryDays.slice(-14).length, 1))}m / day
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-4 text-[11px] text-muted-foreground/60">
                  No trend data yet — complete a focus session to start tracking
                </div>
              )}
            </CardContent>
          </Card>

          {/* Session Insights */}
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border py-3 px-5">
              <div className="flex items-center gap-2">
                <Hourglass className="size-4 text-violet-400" />
                <CardTitle className="text-sm font-medium text-foreground">
                  Focus Insights
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {todayFocusMinutes > 0 || isFocusMode ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Hourglass className="size-4 text-violet-400" />
                      <span className="text-xs text-muted-foreground">Progress toward 2-hour daily goal</span>
                    </div>
                    <span className="text-xs font-medium text-violet-400 tabular-nums">
                      {productivityScore}%
                    </span>
                  </div>
                  <Progress
                    value={productivityScore}
                    className="h-2 bg-muted"
                  />
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <div className="rounded-lg bg-muted/30 border border-border p-3 text-center">
                      <Trophy className="size-4 text-amber-400 mx-auto mb-1" />
                      <p className="text-[10px] text-muted-foreground">Best Session</p>
                      <p className="text-sm font-bold text-amber-400 tabular-nums">
                        {todayFocusMinutes > 0 ? `${Math.min(todayFocusMinutes, 60)}m` : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border p-3 text-center">
                      <ShieldCheck className="size-4 text-neon-emerald mx-auto mb-1" />
                      <p className="text-[10px] text-muted-foreground">Distractions Blocked</p>
                      <p className="text-sm font-bold text-neon-emerald tabular-nums">
                        {currentSessionDistractions}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-border p-3 text-center">
                      <Flame className="size-4 text-orange-400 mx-auto mb-1" />
                      <p className="text-[10px] text-muted-foreground">Focus Streak</p>
                      <p className="text-sm font-bold text-orange-400 tabular-nums">
                        {focusStreak} day{focusStreak !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                  <Brain className="size-8 text-muted-foreground/20 mb-2" />
                  <p className="text-xs">No focus data yet</p>
                  <p className="text-[10px] text-muted-foreground/50 mt-1">
                    Start a focus session to see your productivity insights
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Session History */}
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border py-3 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="size-4 text-violet-400" />
                  <CardTitle className="text-sm font-medium text-foreground">
                    Session History
                  </CardTitle>
                  <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">
                    {focusSessions.length} sessions
                  </Badge>
                </div>
                {focusSessions.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-[9px] text-muted-foreground/50 hover:text-destructive"
                    onClick={clearFocusSessions}
                  >
                    <Trash2 className="size-3" />
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {focusSessions.length > 0 ? (
                <div className="divide-y divide-border max-h-64 overflow-y-auto">
                  {focusSessions.map((session) => {
                    const startDate = new Date(session.startTime)
                    const dateStr = startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })
                    const timeStr = startDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                    const durationMin = Math.round(session.completedSeconds / 60)
                    const targetMin = Math.round(session.duration / 60)
                    return (
                      <div
                        key={session.id}
                        className="flex items-center gap-3 px-5 py-2.5 hover:bg-accent/20 transition-colors"
                      >
                        <div className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-md",
                          session.completed
                            ? "bg-neon-emerald/10 text-neon-emerald"
                            : "bg-rose-500/10 text-rose-400"
                        )}>
                          {session.completed ? (
                            <CheckCircle2 className="size-3.5" />
                          ) : (
                            <AlertTriangle className="size-3.5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-foreground">
                              {durationMin}m
                            </span>
                            <span className="text-[9px] text-muted-foreground/50">
                              / {targetMin}m
                            </span>
                            <Badge variant="outline" className={cn(
                              "text-[8px] h-4 px-1.5",
                              session.completed
                                ? "border-neon-emerald/20 text-neon-emerald"
                                : "border-rose-500/20 text-rose-400"
                            )}>
                              {session.completed ? "Done" : "Stopped"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-[9px] text-muted-foreground/60">
                            <span>{dateStr} at {timeStr}</span>
                            {session.distractionsBlocked > 0 && (
                              <>
                                <span>·</span>
                                <ShieldBan className="size-2.5" />
                                <span>{session.distractionsBlocked} blocked</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                  <ListChecks className="size-6 text-muted-foreground/20 mb-1" />
                  <p className="text-[11px]">No sessions yet</p>
                  <p className="text-[9px] text-muted-foreground/50">
                    Completed and interrupted sessions will appear here
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
