import { useState, useEffect, useMemo } from "react"
import {
  Shield,
  Wifi,
  TrendingDown,
  Zap,
  AlertTriangle,
  AlertCircle,
  Gauge,
  ScrollText,
  FlaskConical,
  Crown,
  ArrowUpDown,
  Brain,
  ShieldAlert,
  Leaf,
  Trees,
  Sprout,
  Droplets,
  RotateCcw,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"
import { invoke } from "@tauri-apps/api/core"

function DataBudgetRing({
  used,
  total,
}: {
  used: number
  total: number
}) {
  const pct = Math.min((used / total) * 100, 100)
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (pct / 100) * circumference

  const color =
    pct > 85
      ? "oklch(0.63 0.22 25)"
      : pct > 65
        ? "oklch(0.75 0.16 80)"
        : "oklch(0.72 0.19 165)"

  return (
    <div className="relative flex items-center justify-center">
      <svg width="140" height="140" className="-rotate-90">
        {/* Track */}
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="oklch(0.2 0.012 264)"
          strokeWidth="10"
        />
        {/* Progress */}
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            filter: `drop-shadow(0 0 6px ${color})`,
            transition: "stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-bold text-foreground tabular-nums">
          {used}
        </span>
        <span className="text-xs text-muted-foreground">MB used</span>
        <span className="mt-0.5 text-[10px] text-muted-foreground/60">
          of {total} MB
        </span>
      </div>
    </div>
  )
}

/// Format bytes/sec to a human-readable string (e.g. "1.2 MB/s", "420 KB/s").
/// Circular carbon savings gauge — shows a glowing ring proportional to CO₂ saved.
function CarbonRing({ grams }: { grams: number }) {
  // Max visual reference: 100g CO₂ fills the ring
  const maxRef = Math.max(grams, 100)
  const pct = Math.min((grams / maxRef) * 100, 100)
  const radius = 36
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (pct / 100) * circumference

  const color = grams > 50
    ? "oklch(0.72 0.19 165)"  // emerald for high savings
    : grams > 10
      ? "oklch(0.75 0.16 80)"   // amber for moderate
      : "oklch(0.63 0.22 25)"   // warmer tone for low

  return (
    <svg width="100" height="100" className="-rotate-90">
      <circle
        cx="50" cy="50" r={radius}
        fill="none"
        stroke="oklch(0.2 0.012 264)"
        strokeWidth="8"
      />
      <circle
        cx="50" cy="50" r={radius}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        style={{
          filter: `drop-shadow(0 0 6px ${color})`,
          transition: "stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
      <text
        x="50" y="50"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        className="text-xs font-bold tabular-nums"
        transform="rotate(90 50 50)"
      >
        {grams.toFixed(1)}g
      </text>
    </svg>
  )
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
  } else if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
  } else if (bytesPerSecond > 0) {
    return `${bytesPerSecond.toFixed(0)} B/s`
  }
  return "0 B/s"
}

interface SandboxStatus {
  isRunning: boolean
  hasGroqKey: boolean
  operationsCount: number
}

export function Dashboard() {
  const { isShieldActive, dataBudgetUsed, dataBudgetTotal, firewallStatus, wfpAvailable, blockedCount, blockedApps, processes, rules, carbonStats, resetCarbonTracker, isFocusMode, todayFocusMinutes, focusStreak, privacyAssessments, overallPrivacyScore } =
    useShield()

  const pct = Math.round((dataBudgetUsed / dataBudgetTotal) * 100)
  const remaining = dataBudgetTotal - dataBudgetUsed
  const savedMB = Math.max(0, dataBudgetTotal - dataBudgetUsed)

  const activeProcesses = processes.filter((p) => p.status === "active").length
  const totalProcesses = processes.length

  // ── Sandbox status polling ──────────────────────────────────────────
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const status: SandboxStatus = await invoke("get_sandbox_status")
        if (!cancelled) setSandboxStatus(status)
      } catch {
        // Sandbox engine not available — ignore
      }
    }
    poll()
    const interval = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  // ── Computed values ─────────────────────────────────────────────────
  const totalSpeed = useMemo(() =>
    processes.reduce((sum, p) => sum + p.speed, 0),
    [processes]
  )

  const topConsumers = useMemo(() =>
    [...processes]
      .sort((a, b) => b.sessionData - a.sessionData)
      .slice(0, 5),
    [processes]
  )

  const activeRulesCount = useMemo(() =>
    rules.filter((r) => r.enabled).length,
    [rules]
  )

  const totalSessionUsage = useMemo(() =>
    processes.reduce((sum, p) => sum + p.sessionData, 0),
    [processes]
  )

  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          System overview and data budget status
        </p>
      </div>

      {/* Top row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Data Budget Card */}
        <Card className="col-span-1 border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today's Data Budget
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <DataBudgetRing used={dataBudgetUsed} total={dataBudgetTotal} />
            <div className="w-full space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{pct}% consumed</span>
                <span>{remaining} MB left</span>
              </div>
              <Progress
                value={pct}
                className="h-1.5 bg-border"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 w-full">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Used</p>
                <p className="text-sm font-semibold text-foreground">{dataBudgetUsed} MB</p>
              </div>
              <div className="rounded-md bg-neon-emerald/5 border border-neon-emerald/20 px-3 py-2 text-center">
                <p className="text-[10px] text-neon-emerald/70 uppercase tracking-wider">Saved</p>
                <p className="text-sm font-semibold text-neon-emerald">{savedMB} MB</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status Cards */}
        <div className="col-span-2 grid grid-rows-2 gap-4">
          {/* Firewall Status */}
          <Card
            className={cn(
              "border transition-all duration-300",
              isShieldActive
                ? "border-neon-emerald/20 bg-neon-emerald/5"
                : "border-border bg-card"
            )}
          >
            <CardContent className="flex items-center gap-4 py-4 px-5">
              <div
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-xl border transition-all duration-300",
                  isShieldActive
                    ? "border-neon-emerald/30 bg-neon-emerald/10 glow-emerald-sm"
                    : "border-border bg-muted"
                )}
              >
                <Shield
                  className={cn(
                    "size-5 transition-colors duration-300",
                    isShieldActive ? "text-neon-emerald" : "text-muted-foreground"
                  )}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-foreground">Firewall Engine</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] h-4 px-1.5 tracking-wider uppercase",
                      firewallStatus === "active"
                        ? "border-neon-emerald/30 text-neon-emerald bg-neon-emerald/5"
                        : "border-border text-muted-foreground"
                    )}
                  >
                    {firewallStatus}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  WFP kernel-mode driver engaged — {isShieldActive ? "Blocking 12 rules" : "All rules disabled"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground">Blocked</p>
                <p className={cn("text-lg font-bold tabular-nums", isShieldActive ? "text-neon-emerald" : "text-foreground")}>
                  {blockedCount}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* WFP Status */}
          <Card className={cn(
            "border transition-all duration-300",
            wfpAvailable
              ? "border-neon-cyan/20 bg-neon-cyan/5"
              : "border-amber-500/20 bg-amber-500/5"
          )}>
            <CardContent className="flex items-center gap-4 py-4 px-5">
              <div className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-xl border",
                wfpAvailable
                  ? "border-neon-cyan/30 bg-neon-cyan/10"
                  : "border-amber-500/30 bg-amber-500/10"
              )}>
                {wfpAvailable ? (
                  <Wifi className="size-5 text-neon-cyan" />
                ) : (
                  <AlertCircle className="size-5 text-amber-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-foreground">WFP Engine</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] h-4 px-1.5 tracking-wider uppercase",
                      wfpAvailable
                        ? "border-neon-cyan/30 text-neon-cyan bg-neon-cyan/5"
                        : "border-amber-500/30 text-amber-400 bg-amber-500/5"
                    )}
                  >
                    {wfpAvailable ? "Active" : "Unavailable"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {wfpAvailable
                    ? "Windows Filtering Platform driver engaged"
                    : "WFP not available on this platform"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground">Processes</p>
                <p className={cn("text-lg font-bold tabular-nums", wfpAvailable ? "text-neon-cyan" : "text-foreground")}>
                  {totalProcesses}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Stats row */}
          <div className="col-span-2 grid grid-cols-3 gap-3">
            {[
              { icon: Zap, label: "Active Processes", value: activeProcesses.toString(), sub: "currently active", color: "text-neon-emerald" },
              { icon: TrendingDown, label: "Session Data", value: `${totalSessionUsage.toFixed(1)} MB`, sub: "this session", color: "text-neon-cyan" },
              { icon: AlertTriangle, label: "Blocked Apps", value: blockedApps.length.toString(), sub: "rules active", color: "text-amber-400" },
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

          {/* Quick stats row: Speed, Rules, Sandbox, Active */}
          <div className="col-span-2 grid grid-cols-4 gap-3">
            {/* Speed Gauge */}
            <Card className="border-border bg-card">
              <CardContent className="flex items-center gap-3 py-3 px-4">
                <Gauge className={cn("size-5 shrink-0", totalSpeed > 1024 * 1024 ? "text-destructive" : totalSpeed > 0 ? "text-neon-emerald" : "text-muted-foreground/40")} />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground truncate">Bandwidth</p>
                  <p className={cn("text-base font-bold tabular-nums", totalSpeed > 0 ? "text-neon-emerald" : "text-muted-foreground/60")}>
                    {formatSpeed(totalSpeed)}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60">
                    {totalSpeed > 0 ? "active throughput" : "idle"}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Active Rules */}
            <Card className="border-border bg-card">
              <CardContent className="flex items-center gap-3 py-3 px-4">
                <ScrollText className="size-5 shrink-0 text-neon-cyan" />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground truncate">Rules Active</p>
                  <p className="text-base font-bold tabular-nums text-neon-cyan">
                    {activeRulesCount}<span className="text-xs font-normal text-muted-foreground/60">/{rules.length}</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground/60">
                    {Math.round((activeRulesCount / Math.max(rules.length, 1)) * 100)}% engaged
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Focus Mode */}
            <Card className={cn("border transition-all duration-300", isFocusMode ? "border-violet-500/20 bg-violet-500/5" : "border-border bg-card")}>
              <CardContent className="flex items-center gap-3 py-3 px-4">
                <Brain className={cn("size-5 shrink-0", isFocusMode ? "text-violet-400" : "text-muted-foreground/40")} />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground truncate">Focus</p>
                  <p className={cn("text-base font-bold tabular-nums", isFocusMode ? "text-violet-400" : "text-muted-foreground/60")}>
                    {isFocusMode ? "Active" : "Inactive"}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60">
                    {isFocusMode ? "In session" : `${todayFocusMinutes}m today`}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Privacy Sentinel */}
            <Card className="border-border bg-card">
              <CardContent className="flex items-center gap-3 py-3 px-4">
                <ShieldAlert className={cn("size-5 shrink-0", overallPrivacyScore <= 50 ? "text-rose-400" : "text-muted-foreground/40")} />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground truncate">Privacy</p>
                  <p className={cn("text-base font-bold tabular-nums", overallPrivacyScore <= 50 ? "text-rose-400" : "text-muted-foreground/60")}>
                    {overallPrivacyScore}/100
                  </p>
                  <p className="text-[10px] text-muted-foreground/60">
                    {privacyAssessments.filter(a => a.risk === "critical" || a.risk === "high").length} risky apps
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Sandbox Status */}
            <Card className="border-border bg-card">
              <CardContent className="flex items-center gap-3 py-3 px-4">
                <FlaskConical className={cn("size-5 shrink-0", sandboxStatus?.isRunning ? "text-neon-emerald" : "text-muted-foreground/40")} />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground truncate">Sandbox</p>
                  <p className={cn("text-base font-bold tabular-nums", sandboxStatus?.isRunning ? "text-neon-emerald" : "text-muted-foreground/60")}>
                    {sandboxStatus === null ? "—" : sandboxStatus.isRunning ? "Active" : "Off"}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60">
                    {sandboxStatus === null ? "loading..." : sandboxStatus.isRunning ? `${sandboxStatus.operationsCount} ops detected` : "scanner stopped"}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Active count */}
            <Card className="border-border bg-card">
              <CardContent className="flex items-center gap-3 py-3 px-4">
                <ArrowUpDown className="size-5 shrink-0 text-amber-400" />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground truncate">Connections</p>
                  <p className="text-base font-bold tabular-nums text-amber-400">
                    {processes.reduce((s, p) => s + p.connections, 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60">
                    across {totalProcesses} process{totalProcesses !== 1 ? "es" : ""}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* CLIMATE IMPACT SECTION */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Leaf className="size-4 text-neon-emerald" />
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Climate Impact
              </h2>
              <Badge variant="outline" className="text-[9px] border-neon-emerald/20 text-neon-emerald bg-neon-emerald/5 ml-1">
                AI-Powered
              </Badge>
            </div>

            <div className="grid grid-cols-4 gap-4">
              {/* Carbon Saved — ring gauge */}
              <Card className="border-neon-emerald/20 bg-neon-emerald/5 col-span-1">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Sprout className="size-3.5 text-neon-emerald" />
                    CO₂ Saved
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-2">
                  <CarbonRing grams={carbonStats.carbonSavedGrams} />
                  <div className="text-center">
                    <p className="text-lg font-bold text-neon-emerald tabular-nums">
                      {carbonStats.carbonSavedGrams.toFixed(1)}g
                    </p>
                    <p className="text-[10px] text-muted-foreground">of CO₂ avoided</p>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full border border-neon-emerald/20 bg-neon-emerald/10 px-2.5 py-1">
                    <Trees className="size-3 text-neon-emerald" />
                    <span className="text-[10px] font-medium text-neon-emerald tabular-nums">
                      ≈ {carbonStats.treesEquivalent.toFixed(2)} trees/year
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Carbon Footprint */}
              <Card className="border-amber-500/20 bg-amber-500/5 col-span-1">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Droplets className="size-3.5 text-amber-400" />
                    Carbon Footprint
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-2 pt-2">
                  <div className="flex size-20 items-center justify-center rounded-full border-2 border-amber-500/30 bg-amber-500/5">
                    <span className="text-xl font-bold text-amber-400 tabular-nums">
                      {carbonStats.carbonFootprintGrams.toFixed(1)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">grams CO₂ emitted</p>
                  <Progress
                    value={carbonStats.carbonFootprintGrams > 0
                      ? Math.min(100, (carbonStats.carbonSavedGrams / Math.max(carbonStats.carbonFootprintGrams, 0.1)) * 100)
                      : 0}
                    className="h-1.5 w-full bg-amber-500/10"
                  />
                  <p className="text-[9px] text-muted-foreground/60">
                    {carbonStats.carbonSavedGrams > 0
                      ? `${Math.round((carbonStats.carbonSavedGrams / Math.max(carbonStats.carbonFootprintGrams + carbonStats.carbonSavedGrams, 0.1)) * 100)}% offset by blocking`
                      : "No blocking activity yet"}
                  </p>
                </CardContent>
              </Card>

              {/* Top Carbon Savers */}
              <Card className="border-border bg-card col-span-2">
                <CardHeader className="pb-2 border-b border-border">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      <Leaf className="size-3.5 text-neon-emerald" />
                      Top Carbon Savers
                    </CardTitle>
                    <button
                      onClick={resetCarbonTracker}
                      className="flex items-center gap-1 text-[9px] text-muted-foreground/60 hover:text-foreground transition-colors"
                    >
                      <RotateCcw className="size-2.5" />
                      Reset
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {carbonStats.processes.filter(p => p.savedGrams > 0).length > 0 ? (
                    <div className="divide-y divide-border">
                      <div className="grid grid-cols-[24px_1fr_80px_80px] gap-3 px-4 py-2 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60 bg-muted/20">
                        <span>#</span>
                        <span>Application</span>
                        <span className="text-right">Saved</span>
                        <span className="text-right">Footprint</span>
                      </div>
                      {carbonStats.processes
                        .filter(p => p.savedGrams > 0 || p.footprintGrams > 0)
                        .sort((a, b) => (b.savedGrams + b.footprintGrams) - (a.savedGrams + a.footprintGrams))
                        .slice(0, 5)
                        .map((p, i) => (
                          <div
                            key={p.exe}
                            className="grid grid-cols-[24px_1fr_80px_80px] gap-3 px-4 py-2 hover:bg-accent/20 transition-colors items-center"
                          >
                            <span className={cn(
                              "text-xs font-bold tabular-nums text-center",
                              i === 0 ? "text-neon-emerald" : i === 1 ? "text-muted-foreground/80" : "text-muted-foreground/40"
                            )}>
                              {i + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                              <p className="text-[9px] font-mono text-muted-foreground/50 truncate">{p.exe}</p>
                            </div>
                            <p className="text-xs tabular-nums font-medium text-right text-neon-emerald self-center">
                              {p.savedGrams > 0 ? `${p.savedGrams.toFixed(2)}g` : "—"}
                            </p>
                            <p className="text-xs tabular-nums font-medium text-right text-amber-400/80 self-center">
                              {p.footprintGrams > 0 ? `${p.footprintGrams.toFixed(2)}g` : "—"}
                            </p>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                      <div className="flex flex-col items-center gap-1">
                        <Sprout className="size-6 text-muted-foreground/20" />
                        <p className="text-xs">No carbon data yet</p>
                        <p className="text-[9px] text-muted-foreground/50">
                          Block network traffic to start saving CO₂
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Top Bandwidth Consumers */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="size-4 text-amber-400" />
              <CardTitle className="text-sm font-medium text-foreground">
                Top Bandwidth Consumers
              </CardTitle>
            </div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">
              {totalProcesses} process{totalProcesses !== 1 ? "es" : ""}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {topConsumers.length > 0 ? (
            <div className="divide-y divide-border">
              {/* Table header */}
              <div className="grid grid-cols-[24px_1fr_80px_100px] gap-3 px-5 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 bg-muted/20">
                <span>#</span>
                <span>Process</span>
                <span className="text-right">Speed</span>
                <span className="text-right">Data Used</span>
              </div>
              {topConsumers.map((p, i) => (
                <div
                  key={`${p.pid}-${p.exe}`}
                  className="grid grid-cols-[24px_1fr_80px_100px] gap-3 px-5 py-2.5 hover:bg-accent/20 transition-colors items-center"
                >
                  {/* Rank */}
                  <span className={cn(
                    "text-xs font-bold tabular-nums text-center",
                    i === 0 ? "text-amber-400" : i === 1 ? "text-muted-foreground/80" : i === 2 ? "text-muted-foreground/60" : "text-muted-foreground/40"
                  )}>
                    {i + 1}
                  </span>

                  {/* Process name + exe */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        p.status === "blocked" ? "bg-destructive" : p.status === "active" ? "bg-neon-emerald" : "bg-neon-cyan"
                      )} />
                      <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground/50 truncate font-mono">{p.exe}</p>
                  </div>

                  {/* Speed */}
                  <p className={cn(
                    "text-xs tabular-nums font-medium text-right self-center",
                    p.speed > 0 ? "text-neon-emerald" : "text-muted-foreground/40"
                  )}>
                    {p.speed > 0 ? formatSpeed(p.speed) : "—"}
                  </p>

                  {/* Data used */}
                  <p className={cn(
                    "text-xs tabular-nums font-medium text-right self-center",
                    p.sessionData > 0 ? "text-foreground" : "text-muted-foreground/40"
                  )}>
                    {p.sessionData > 0 ? `${p.sessionData.toFixed(1)} MB` : "—"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              <div className="flex flex-col items-center gap-1">
                <Crown className="size-6 text-muted-foreground/20" />
                <p>No bandwidth data yet</p>
                <p className="text-[10px] text-muted-foreground/50">
                  Data usage will appear here once processes start transferring data
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
