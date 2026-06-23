import { useState, useMemo } from "react"
import {
  Shield,
  ShieldCheck,
  ShieldBan,
  ShieldAlert,
  Eye,
  EyeOff,
  Search,
  SlidersHorizontal,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  RotateCcw,
  Terminal,
  Globe,
  Download,
  Clock,
  BarChart3,
  Lock,
  Unlock,
  Scan,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { useShield, type PrivacyRisk } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

// ── Risk color config ──────────────────────────────────────────────────────

const RISK_COLORS: Record<PrivacyRisk, { bg: string; text: string; border: string; glow: string }> = {
  critical: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/30", glow: "shadow-rose-500/20" },
  high: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30", glow: "shadow-orange-500/20" },
  medium: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30", glow: "shadow-amber-500/20" },
  low: { bg: "bg-neon-emerald/5", text: "text-neon-emerald", border: "border-neon-emerald/20", glow: "shadow-neon-emerald/10" },
  safe: { bg: "bg-neon-emerald/5", text: "text-neon-emerald", border: "border-neon-emerald/20", glow: "shadow-neon-emerald/10" },
}

const RISK_ORDER: PrivacyRisk[] = ["critical", "high", "medium", "low", "safe"]

const FILTERS = [
  { key: "all", label: "All Apps" },
  { key: "critical", label: "Critical" },
  { key: "high", label: "High Risk" },
  { key: "medium", label: "Medium" },
  { key: "safe", label: "Safe" },
] as const

// ══════════════════════════════════════════════════════════════════════════
// PrivacyScoreRing
// ══════════════════════════════════════════════════════════════════════════

function PrivacyScoreRing({ score }: { score: number }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (score / 100) * circumference

  const color = score <= 30 ? "#f43f5e" : score <= 50 ? "#f97316" : score <= 70 ? "#f59e0b" : score <= 85 ? "#10b981" : "#10b981"

  return (
    <div className="relative flex items-center justify-center">
      <svg width="140" height="140" className="-rotate-90">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="oklch(0.2 0.012 264)" strokeWidth="10" />
        <circle
          cx="70" cy="70" r={radius}
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
        <span className="text-2xl font-bold text-foreground tabular-nums">{score}</span>
        <span className="text-[10px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// AppRiskBadge
// ══════════════════════════════════════════════════════════════════════════

function AppRiskBadge({ risk }: { risk: PrivacyRisk }) {
  const c = RISK_COLORS[risk]
  return (
    <Badge variant="outline" className={cn("text-[9px] px-1.5 h-4 uppercase tracking-wider font-semibold", c.border, c.text, c.bg)}>
      {risk === "critical" ? "Critical" : risk === "high" ? "High" : risk === "medium" ? "Medium" : risk === "low" ? "Low" : "Safe"}
    </Badge>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// PrivacyPage
// ══════════════════════════════════════════════════════════════════════════

export function Privacy() {
  const {
    processes,
    blockApp,
    unblockApp,
    knownTrackers,
    privacyAssessments,
    privacyAuditLog,
    overallPrivacyScore,
    toggleTrackerBlock,
    clearAuditLog,
  } = useShield()

  const [riskFilter, setRiskFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [view, setView] = useState<"overview" | "trackers" | "audit">("overview")

  // ── Computed values ────────────────────────────────────────────────────

  const criticalCount = privacyAssessments.filter((a) => a.risk === "critical").length
  const highCount = privacyAssessments.filter((a) => a.risk === "high").length
  const blockedTrackerCount = knownTrackers.filter((t) => t.autoBlock).length
  const totalDataExposed = privacyAssessments.reduce((s, a) => s + (a.risk !== "safe" ? a.dataMB : 0), 0)

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <ShieldAlert className="size-5 text-rose-400" />
            Privacy Sentinel
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-powered privacy scoring, tracker detection, and data harvesting protection
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-rose-500/20 bg-rose-500/5 px-3 py-1.5">
          <Badge variant="outline" className="text-[9px] border-rose-500/20 text-rose-400 bg-rose-500/10">
            AI-Powered
          </Badge>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {[
          { key: "overview" as const, label: "Privacy Overview", icon: BarChart3 },
          { key: "trackers" as const, label: "Known Trackers", icon: Eye },
          { key: "audit" as const, label: "Audit Log", icon: Clock },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-[11px] font-medium border-b-2 transition-all duration-150",
              view === key
                ? "border-rose-400 text-foreground"
                : "border-transparent text-muted-foreground/60 hover:text-foreground hover:border-muted-foreground/20"
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {view === "overview" && (
        <div className="space-y-6">
          {/* Top row: Overall score + stats */}
          <div className="grid grid-cols-4 gap-4">
            <Card className="border-rose-500/20 bg-rose-500/5 col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">Privacy Score</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-2">
                <PrivacyScoreRing score={overallPrivacyScore} />
                <p className={cn("text-[10px] font-medium", RISK_COLORS[overallPrivacyScore <= 30 ? "critical" : overallPrivacyScore <= 50 ? "high" : overallPrivacyScore <= 70 ? "medium" : "safe"].text)}>
                  {overallPrivacyScore <= 30 ? "Critical Risk" : overallPrivacyScore <= 50 ? "High Risk" : overallPrivacyScore <= 70 ? "Moderate" : "Good"}
                </p>
              </CardContent>
            </Card>

            {[
              { label: "Critical Apps", value: criticalCount, icon: ShieldBan, color: "text-rose-400", sub: "immediate action needed" },
              { label: "High Risk Apps", value: highCount, icon: AlertTriangle, color: "text-orange-400", sub: "review recommended" },
              { label: "Data Exposed", value: `${totalDataExposed.toFixed(0)} MB`, icon: Download, color: "text-amber-400", sub: "to trackers" },
              { label: "Trackers Blocked", value: blockedTrackerCount, icon: Lock, color: "text-neon-emerald", sub: "auto-blocked" },
            ].map(({ label, value, icon: Icon, color, sub }) => (
              <Card key={label} className="border-border bg-card col-span-1">
                <CardContent className="flex items-center gap-3 py-4 px-4">
                  <Icon className={cn("size-5 shrink-0", color)} />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground truncate">{label}</p>
                    <p className={cn("text-lg font-bold tabular-nums", color)}>{value}</p>
                    <p className="text-[10px] text-muted-foreground/60">{sub}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* App assessments */}
          <Card className="border-border bg-card overflow-hidden">
            <CardHeader className="border-b border-border py-3 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scan className="size-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium text-foreground">Privacy Assessment</CardTitle>
                  <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">{privacyAssessments.length} apps</Badge>
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
              <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/40">
                {FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setRiskFilter(key)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                      riskFilter === key ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground/60 hover:text-foreground hover:bg-accent/40"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {privacyAssessments.filter(a => {
                if (riskFilter !== "all" && a.risk !== riskFilter) return false
                if (searchQuery && !a.name.toLowerCase().includes(searchQuery.toLowerCase()) && !a.exe.toLowerCase().includes(searchQuery.toLowerCase())) return false
                return true
              }).length > 0 ? (
                <div className="divide-y divide-border">
                  <div className="grid grid-cols-[24px_1fr_80px_60px_80px_80px] gap-3 px-5 py-2 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60 bg-muted/20">
                    <span>#</span>
                    <span>Application</span>
                    <span className="text-right">Score</span>
                    <span className="text-right">Risk</span>
                    <span className="text-right">Connections</span>
                    <span className="text-right">Data</span>
                  </div>
                  {privacyAssessments
                    .filter(a => {
                      if (riskFilter !== "all" && a.risk !== riskFilter) return false
                      if (searchQuery && !a.name.toLowerCase().includes(searchQuery.toLowerCase()) && !a.exe.toLowerCase().includes(searchQuery.toLowerCase())) return false
                      return true
                    })
                    .map((a, i) => {
                      const c = RISK_COLORS[a.risk]
                      return (
                        <div key={a.exe} className="grid grid-cols-[24px_1fr_80px_60px_80px_80px] gap-3 px-5 py-2.5 hover:bg-accent/20 transition-colors items-center">
                          <span className={cn("text-xs font-bold tabular-nums text-center", i < 3 ? "text-rose-400" : "text-muted-foreground/40")}>{i + 1}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={cn("size-1.5 rounded-full shrink-0", a.blocked ? "bg-neon-emerald" : a.risk === "critical" ? "bg-rose-400 animate-pulse" : c.text)} />
                              <p className="text-xs font-medium text-foreground truncate">{a.name}</p>
                              {a.blocked && <ShieldCheck className="size-3 text-neon-emerald shrink-0" />}
                            </div>
                            <p className="text-[10px] font-mono text-muted-foreground/50 truncate">{a.exe}</p>
                            {a.reasons.length > 0 && (
                              <p className="text-[9px] text-muted-foreground/60 mt-0.5 truncate">{a.reasons[0]}</p>
                            )}
                          </div>
                          <div className="self-center text-right">
                            <div className="flex items-center gap-1.5 justify-end">
                              <Progress value={a.score} className={cn("h-1 w-12 bg-muted", a.score <= 30 ? "[&>div]:bg-rose-400" : a.score <= 50 ? "[&>div]:bg-orange-400" : a.score <= 70 ? "[&>div]:bg-amber-400" : "[&>div]:bg-neon-emerald")} />
                              <span className={cn("text-xs font-bold tabular-nums", c.text)}>{a.score}</span>
                            </div>
                          </div>
                          <div className="self-center">
                            <AppRiskBadge risk={a.risk} />
                          </div>
                          <span className={cn("text-xs tabular-nums font-medium text-right self-center", a.connections > 0 ? "text-foreground" : "text-muted-foreground/40")}>
                            {a.connections > 0 ? a.connections : "—"}
                          </span>
                          <span className={cn("text-xs tabular-nums font-medium text-right self-center", a.dataMB > 0 ? "text-foreground" : "text-muted-foreground/40")}>
                            {a.dataMB > 0 ? `${a.dataMB.toFixed(0)} MB` : "—"}
                          </span>
                        </div>
                      )
                    })}
                </div>
              ) : (
                <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                  <div className="flex flex-col items-center gap-1">
                    <ShieldCheck className="size-6 text-muted-foreground/20" />
                    <p>No apps match your filter</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {view === "trackers" && (
        <Card className="border-border bg-card overflow-hidden">
          <CardHeader className="border-b border-border py-3 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="size-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium text-foreground">Known Data Trackers</CardTitle>
                <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">{knownTrackers.length} tracked</Badge>
              </div>
              <Badge variant="outline" className={cn("text-[9px]", blockedTrackerCount > 0 ? "border-neon-emerald/20 text-neon-emerald bg-neon-emerald/5" : "border-border text-muted-foreground")}>
                {blockedTrackerCount} auto-blocked
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border">
            {knownTrackers
              .sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk))
              .map((tracker) => {
                const c = RISK_COLORS[tracker.risk]
                return (
                  <div key={tracker.exe} className={cn("flex items-center gap-3 px-5 py-3 transition-colors", tracker.autoBlock ? c.bg : "hover:bg-accent/20")}>
                    {/* Auto-block toggle */}
                    <button
                      onClick={() => toggleTrackerBlock(tracker.exe)}
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-md border transition-all duration-200",
                        tracker.autoBlock
                          ? "border-neon-emerald/40 bg-neon-emerald/10 text-neon-emerald"
                          : "border-border text-muted-foreground/40 hover:border-muted-foreground/30"
                      )}
                    >
                      {tracker.autoBlock ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={cn("text-xs font-medium", tracker.autoBlock ? "text-foreground" : "text-muted-foreground/60")}>
                          {tracker.name}
                        </p>
                        <AppRiskBadge risk={tracker.risk} />
                      </div>
                      <p className={cn("text-[10px] font-mono", tracker.autoBlock ? "text-muted-foreground/70" : "text-muted-foreground/30")}>
                        {tracker.exe}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tracker.dataCollected.map((item) => (
                          <span key={item} className="text-[8px] px-1.5 py-0.5 rounded-full bg-muted/40 border border-border text-muted-foreground/60">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    <Badge variant="outline" className={cn(
                      "text-[8px] uppercase tracking-wider h-4",
                      tracker.autoBlock
                        ? "border-neon-emerald/20 text-neon-emerald bg-neon-emerald/5"
                        : "border-border text-muted-foreground/40"
                    )}>
                      {tracker.autoBlock ? "Blocking" : "Allowed"}
                    </Badge>
                  </div>
                )
              })}
          </CardContent>
        </Card>
      )}

      {view === "audit" && (
        <Card className="border-border bg-card overflow-hidden">
          <CardHeader className="border-b border-border py-3 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium text-foreground">Privacy Audit Log</CardTitle>
                <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">{privacyAuditLog.length} events</Badge>
              </div>
              <Button variant="outline" size="sm" className="h-7 text-[10px] border-border" onClick={clearAuditLog} disabled={privacyAuditLog.length === 0}>
                <RotateCcw className="size-3 mr-1" />
                Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {privacyAuditLog.length > 0 ? (
              <div className="divide-y divide-border">
                {privacyAuditLog.slice(0, 100).map((entry, i) => {
                  const c = RISK_COLORS[entry.risk]
                  return (
                    <div key={i} className="flex items-start gap-3 px-5 py-2.5 hover:bg-accent/20 transition-colors">
                      <div className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border", c.border, c.bg)}>
                        <AlertTriangle className={cn("size-3", c.text)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium text-foreground">{entry.appName}</p>
                          <AppRiskBadge risk={entry.risk} />
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">{entry.event}</p>
                      </div>
                      <span className="text-[9px] font-mono text-muted-foreground/40 shrink-0">{entry.timestamp}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                <div className="flex flex-col items-center gap-1">
                  <ShieldCheck className="size-6 text-muted-foreground/20" />
                  <p>No privacy events yet</p>
                  <p className="text-[9px] text-muted-foreground/50">Audit entries will appear when high-risk apps are detected</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
