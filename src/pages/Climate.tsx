import { useState, useMemo, useCallback } from "react"
import {
  Leaf,
  Trees,
  Sprout,
  Droplets,
  TrendingDown,
  BarChart3,
  Download,
  RotateCcw,
  ShieldCheck,
  Globe,
  Zap,
  Clock,
  FileText,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

// ══════════════════════════════════════════════════════════════════════════
// CarbonRing — large animated ring gauge
// ══════════════════════════════════════════════════════════════════════════

function CarbonRing({ saved, footprint }: { saved: number; footprint: number }) {
  const total = saved + footprint
  const pct = total > 0 ? (saved / total) * 100 : 0
  const radius = 64
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference

  return (
    <div className="relative flex items-center justify-center">
      <svg width="180" height="180" className="-rotate-90">
        {/* Footprint track */}
        <circle cx="90" cy="90" r={radius} fill="none" stroke="oklch(0.2 0.012 264)" strokeWidth="14" />
        {/* Saved arc */}
        <circle
          cx="90" cy="90" r={radius}
          fill="none"
          stroke="#10b981"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            filter: "drop-shadow(0 0 12px #10b981)",
            transition: "stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold text-neon-emerald tabular-nums">
          {saved.toFixed(1)}
        </span>
        <span className="text-[10px] text-muted-foreground">grams CO₂ saved</span>
        <span className="mt-0.5 text-[9px] text-muted-foreground/60">
          of {total.toFixed(1)}g total
        </span>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// MiniSparkline — tiny inline timeline bars
// ══════════════════════════════════════════════════════════════════════════

function MiniSparkline({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  const max = Math.max(1, ...data)
  const barCount = data.length
  const barWidth = Math.max(3, Math.min(12, 480 / Math.max(barCount, 1)))

  return (
    <div className="flex items-end gap-[2px] overflow-hidden" style={{ height }}>
      {data.map((val, i) => {
        const pct = (val / max) * 100
        return (
          <div
            key={i}
            className="w-[3px] rounded-[2px] transition-all duration-300"
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
// ClimatePage
// ══════════════════════════════════════════════════════════════════════════

export function Climate() {
  const { carbonStats, carbonHistory, resetCarbonTracker, clearCarbonHistory, blockApp, processes } = useShield()

  const [activeTab, setActiveTab] = useState<"overview" | "timeline" | "report">("overview")

  // ── Timeline data ──────────────────────────────────────────────────────

  const timelineSaved = useMemo(() => carbonHistory.map(s => s.savedGrams), [carbonHistory])
  const timelineFootprint = useMemo(() => carbonHistory.map(s => s.footprintGrams), [carbonHistory])

  // Compute deltas (CO₂ saved per interval)
  const timelineDeltas = useMemo(() => {
    if (carbonHistory.length < 2) return []
    return carbonHistory.slice(1).map((s, i) => ({
      timestamp: s.timestamp,
      savedDelta: Math.max(0, s.savedGrams - carbonHistory[i].savedGrams),
      footprintDelta: Math.max(0, s.footprintGrams - carbonHistory[i].footprintGrams),
    }))
  }, [carbonHistory])

  // ── Top carbon savers ──────────────────────────────────────────────────

  const topSavers = useMemo(() =>
    [...carbonStats.processes]
      .filter(p => p.savedGrams > 0 || p.footprintGrams > 0)
      .sort((a, b) => (b.savedGrams + b.footprintGrams) - (a.savedGrams + a.footprintGrams))
      .slice(0, 10),
    [carbonStats.processes]
  )

  // ── Stats ──────────────────────────────────────────────────────────────

  const co2PerMB = 0.03
  const totalDataSaved = carbonStats.carbonSavedGrams / co2PerMB
  const treesEquiv = carbonStats.carbonSavedGrams / 21000
  const offsetPct = carbonStats.carbonFootprintGrams + carbonStats.carbonSavedGrams > 0
    ? Math.round((carbonStats.carbonSavedGrams / (carbonStats.carbonFootprintGrams + carbonStats.carbonSavedGrams)) * 100)
    : 0

  // Simulated daily goal: 100g CO₂ saved per day
  const dailyGoalPct = Math.min(100, (carbonStats.carbonSavedGrams / 100) * 100)

  // ── Export report ──────────────────────────────────────────────────────

  const exportReport = useCallback(() => {
    const now = new Date().toLocaleDateString()
    const lines = [
      "╔══════════════════════════════════════════╗",
      "║      Data Guardian — Climate Report      ║",
      `║           Generated: ${now.padEnd(20)}║`,
      "╚══════════════════════════════════════════╝",
      "",
      `CO₂ Saved:          ${carbonStats.carbonSavedGrams.toFixed(2)} grams`,
      `CO₂ Footprint:      ${carbonStats.carbonFootprintGrams.toFixed(2)} grams`,
      `Offset Rate:        ${offsetPct}%`,
      `Tree Equivalence:   ${treesEquiv.toFixed(4)} trees/year`,
      `Data Saved:         ${totalDataSaved.toFixed(1)} MB`,
      "",
      "── Top Carbon Savers ──",
      ...topSavers.map((p, i) => `  ${i + 1}. ${p.name} — saved ${p.savedGrams.toFixed(3)}g, footprint ${p.footprintGrams.toFixed(3)}g`),
      "",
      "── Timeline ──",
      ...carbonHistory.map(s => `  ${s.timestamp.slice(0, 19)} — saved: ${s.savedGrams.toFixed(2)}g, footprint: ${s.footprintGrams.toFixed(2)}g`),
      "",
      "── Methodology ──",
      "  Conversion: 0.03 g CO₂ per MB transferred (source: IEA 2023, Andrae 2015)",
      "  Tree equivalence: 21,000 g CO₂ per mature tree per year (source: EPA)",
      "",
      "Generated by Data Guardian — https://github.com/oasis",
    ]

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `climate-report-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [carbonStats, topSavers, carbonHistory, offsetPct, treesEquiv, totalDataSaved])

  // ══════════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Globe className="size-5 text-neon-emerald" />
            Climate Impact
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time carbon footprint tracking, sustainability analytics, and report export
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-neon-emerald/20 bg-neon-emerald/5 px-3 py-1.5">
          <Badge variant="outline" className="text-[9px] border-neon-emerald/20 text-neon-emerald bg-neon-emerald/10">
            AI-Powered
          </Badge>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {[
          { key: "overview" as const, label: "Overview", icon: BarChart3 },
          { key: "timeline" as const, label: "Timeline", icon: Clock },
          { key: "report" as const, label: "Report", icon: FileText },
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

      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Top row: Ring gauge + stat cards */}
          <div className="grid grid-cols-12 gap-4">
            {/* Carbon ring */}
            <Card className="border-neon-emerald/20 bg-neon-emerald/5 col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Sprout className="size-3.5 text-neon-emerald" />
                  CO₂ Impact
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <CarbonRing saved={carbonStats.carbonSavedGrams} footprint={carbonStats.carbonFootprintGrams} />
                <div className="flex items-center gap-3 text-[10px]">
                  <div className="flex items-center gap-1">
                    <div className="size-2 rounded-full bg-neon-emerald" />
                    <span className="text-muted-foreground">Saved</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="size-2 rounded-full bg-muted-foreground/40" />
                    <span className="text-muted-foreground">Footprint</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stats grid */}
            <div className="col-span-9 grid grid-cols-4 gap-4">
              {[
                { icon: Leaf, label: "CO₂ Saved", value: `${carbonStats.carbonSavedGrams.toFixed(1)}g`, sub: "total avoided", color: "text-neon-emerald" },
                { icon: Droplets, label: "CO₂ Footprint", value: `${carbonStats.carbonFootprintGrams.toFixed(1)}g`, sub: "total emitted", color: "text-amber-400" },
                { icon: Trees, label: "Tree Equivalence", value: treesEquiv.toFixed(3), sub: "trees/year", color: "text-neon-emerald" },
                { icon: ShieldCheck, label: "Offset Rate", value: `${offsetPct}%`, sub: "of emissions offset", color: "text-neon-cyan" },
              ].map(({ icon: Icon, label, value, sub, color }) => (
                <Card key={label} className="border-border bg-card">
                  <CardContent className="flex flex-col items-center gap-2 py-4 px-3">
                    <Icon className={cn("size-5", color)} />
                    <p className="text-xl font-bold tabular-nums text-foreground">{value}</p>
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-[9px] text-muted-foreground/50">{sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Daily goal + data saved */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-border bg-card">
              <CardContent className="flex items-center gap-4 py-4 px-5">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-neon-emerald/20 bg-neon-emerald/5">
                  <Zap className="size-5 text-neon-emerald" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">Daily Climate Goal</p>
                  <p className="text-[10px] text-muted-foreground mb-2">Save 100g CO₂ per day by blocking background data hogs</p>
                  <Progress value={dailyGoalPct} className="h-2 bg-muted [&>div]:bg-gradient-to-r [&>div]:from-neon-emerald [&>div]:to-neon-cyan" />
                  <div className="flex justify-between mt-1 text-[9px] text-muted-foreground/60">
                    <span>{carbonStats.carbonSavedGrams.toFixed(1)}g saved</span>
                    <span>{dailyGoalPct >= 100 ? "Goal reached! 🎉" : `${dailyGoalPct.toFixed(0)}%`}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardContent className="flex items-center gap-4 py-4 px-5">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-neon-cyan/20 bg-neon-cyan/5">
                  <TrendingDown className="size-5 text-neon-cyan" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">Data Saved from Network</p>
                  <p className="text-[10px] text-muted-foreground mb-1">
                    Blocking background traffic prevented <span className="text-neon-emerald font-semibold">{totalDataSaved.toFixed(0)} MB</span> of data transfer
                  </p>
                  <div className="flex items-center gap-3 text-[9px] text-muted-foreground/60">
                    <span>≈ {totalDataSaved > 0 ? `${(totalDataSaved / 1024).toFixed(1)} GB` : "0 GB"}</span>
                    <span>·</span>
                    <span>{topSavers.length} apps contributing</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Carbon Savers */}
          <Card className="border-border bg-card overflow-hidden">
            <CardHeader className="border-b border-border py-3 px-5">
              <div className="flex items-center gap-2">
                <Leaf className="size-4 text-neon-emerald" />
                <CardTitle className="text-sm font-medium text-foreground">Top Carbon Savers</CardTitle>
                <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">{topSavers.length} apps</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {topSavers.length > 0 ? (
                <div className="divide-y divide-border">
                  <div className="grid grid-cols-[24px_1fr_100px_100px_100px] gap-3 px-5 py-2 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60 bg-muted/20">
                    <span>#</span>
                    <span>Application</span>
                    <span className="text-right">CO₂ Saved</span>
                    <span className="text-right">CO₂ Footprint</span>
                    <span className="text-right">Net Impact</span>
                  </div>
                  {topSavers.map((p, i) => {
                    const netImpact = p.savedGrams - p.footprintGrams
                    return (
                      <div key={p.exe} className="grid grid-cols-[24px_1fr_100px_100px_100px] gap-3 px-5 py-2.5 hover:bg-accent/20 transition-colors items-center">
                        <span className={cn("text-xs font-bold tabular-nums text-center", i < 3 ? "text-neon-emerald" : "text-muted-foreground/40")}>{i + 1}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground/50 truncate">{p.exe}</p>
                        </div>
                        <p className="text-xs tabular-nums font-medium text-right text-neon-emerald self-center">
                          {p.savedGrams > 0.001 ? `${p.savedGrams.toFixed(3)}g` : "< 0.001g"}
                        </p>
                        <p className="text-xs tabular-nums font-medium text-right text-amber-400/80 self-center">
                          {p.footprintGrams > 0.001 ? `${p.footprintGrams.toFixed(3)}g` : "< 0.001g"}
                        </p>
                        <p className={cn("text-xs tabular-nums font-bold text-right self-center", netImpact > 0 ? "text-neon-emerald" : netImpact < 0 ? "text-destructive" : "text-muted-foreground/40")}>
                          {netImpact > 0 ? "+" : ""}{netImpact.toFixed(3)}g
                        </p>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                  <div className="flex flex-col items-center gap-1">
                    <Leaf className="size-6 text-muted-foreground/20" />
                    <p>No carbon data yet</p>
                    <p className="text-[9px] text-muted-foreground/50">Block network traffic to start tracking carbon impact</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Methodology */}
          <Card className="border-border bg-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="size-3.5 text-muted-foreground" />
                <p className="text-[10px] font-medium text-muted-foreground">Methodology & Sources</p>
              </div>
              <p className="text-[9px] text-muted-foreground/60 leading-relaxed">
                Carbon estimates use a conversion factor of <strong className="text-foreground">0.03 g CO₂ per MB</strong> of data transferred,
                based on network energy studies (Andrae & Edler, 2015) and the 2023 global average grid carbon intensity
                of ~475 g CO₂/kWh (IEA). Tree equivalence uses the EPA estimate of <strong className="text-foreground">21,000 g CO₂ per mature tree per year</strong>.
                Blocked data is counted as carbon saved since that traffic was prevented from being transmitted across the network.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "timeline" && (
        <div className="space-y-4">
          {/* Timeline sparkline */}
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border py-3 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium text-foreground">Carbon Timeline</CardTitle>
                  <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">{carbonHistory.length} snapshots</Badge>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-[10px] border-border" onClick={clearCarbonHistory} disabled={carbonHistory.length === 0}>
                  <RotateCcw className="size-3 mr-1" />
                  Clear History
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {carbonHistory.length >= 2 ? (
                <div className="space-y-6">
                  {/* Saved CO₂ timeline */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-medium text-neon-emerald flex items-center gap-1">
                        <Sprout className="size-3" /> CO₂ Saved
                      </span>
                      <span className="text-[9px] text-muted-foreground/60">
                        Current: {carbonStats.carbonSavedGrams.toFixed(2)}g
                      </span>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <MiniSparkline data={timelineSaved} color="#10b981" height={48} />
                    </div>
                    <div className="flex justify-between text-[8px] text-muted-foreground/40 mt-1">
                      <span>{carbonHistory[0]?.timestamp.slice(11, 19) || "start"}</span>
                      <span>{carbonHistory[carbonHistory.length - 1]?.timestamp.slice(11, 19) || "now"}</span>
                    </div>
                  </div>

                  {/* Footprint timeline */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-medium text-amber-400 flex items-center gap-1">
                        <Droplets className="size-3" /> CO₂ Footprint
                      </span>
                      <span className="text-[9px] text-muted-foreground/60">
                        Current: {carbonStats.carbonFootprintGrams.toFixed(2)}g
                      </span>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <MiniSparkline data={timelineFootprint} color="#f59e0b" height={48} />
                    </div>
                    <div className="flex justify-between text-[8px] text-muted-foreground/40 mt-1">
                      <span>{carbonHistory[0]?.timestamp.slice(11, 19) || "start"}</span>
                      <span>{carbonHistory[carbonHistory.length - 1]?.timestamp.slice(11, 19) || "now"}</span>
                    </div>
                  </div>

                  {/* Delta bars */}
                  {timelineDeltas.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                          <Zap className="size-3" /> CO₂ Saved Per Interval
                        </span>
                        <span className="text-[9px] text-muted-foreground/60">
                          Last: {timelineDeltas[timelineDeltas.length - 1]?.savedDelta.toFixed(3)}g
                        </span>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-4">
                        <MiniSparkline data={timelineDeltas.map(d => d.savedDelta * 1000)} color="#10b981" height={48} />
                      </div>
                      <div className="flex justify-between text-[8px] text-muted-foreground/40 mt-1">
                        <span>{timelineDeltas[0]?.timestamp.slice(11, 19) || "start"}</span>
                        <span>{timelineDeltas[timelineDeltas.length - 1]?.timestamp.slice(11, 19) || "now"}</span>
                      </div>
                    </div>
                  )}

                  {/* Raw data table */}
                  <details className="group">
                    <summary className="text-[10px] text-muted-foreground/60 cursor-pointer hover:text-foreground transition-colors">
                      View raw timeline data ({carbonHistory.length} entries)
                    </summary>
                    <div className="mt-2 max-h-48 overflow-auto">
                      <table className="w-full text-[9px] font-mono">
                        <thead>
                          <tr className="text-muted-foreground/40 border-b border-border">
                            <th className="text-left py-1 pr-2">Time</th>
                            <th className="text-right pr-2">Saved</th>
                            <th className="text-right">Footprint</th>
                          </tr>
                        </thead>
                        <tbody>
                          {carbonHistory.map((s, i) => (
                            <tr key={i} className="border-b border-border/30 hover:bg-accent/20">
                              <td className="py-1 pr-2 text-muted-foreground/60">{s.timestamp.slice(11, 19)}</td>
                              <td className="text-right pr-2 text-neon-emerald">{s.savedGrams.toFixed(3)}g</td>
                              <td className="text-right text-amber-400/80">{s.footprintGrams.toFixed(3)}g</td>
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
                    Timeline snapshots are recorded every 30 seconds while the app tracks network activity
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "report" && (
        <div className="space-y-4">
          <Card className="border-neon-emerald/20 bg-neon-emerald/5">
            <CardContent className="flex flex-col items-center gap-4 py-8">
              <FileText className="size-10 text-neon-emerald" />
              <div className="text-center">
                <h2 className="text-base font-semibold text-foreground">Export Sustainability Report</h2>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">
                  Download a detailed plain-text report with your carbon impact data, top savers, timeline, and methodology
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 w-full max-w-md mt-2">
                <div className="text-center p-3 rounded-lg border border-border bg-card">
                  <p className="text-lg font-bold text-neon-emerald tabular-nums">{carbonStats.carbonSavedGrams.toFixed(1)}g</p>
                  <p className="text-[9px] text-muted-foreground">CO₂ Saved</p>
                </div>
                <div className="text-center p-3 rounded-lg border border-border bg-card">
                  <p className="text-lg font-bold text-amber-400 tabular-nums">{carbonStats.carbonFootprintGrams.toFixed(1)}g</p>
                  <p className="text-[9px] text-muted-foreground">CO₂ Footprint</p>
                </div>
                <div className="text-center p-3 rounded-lg border border-border bg-card">
                  <p className="text-lg font-bold text-neon-emerald tabular-nums">{treesEquiv.toFixed(3)}</p>
                  <p className="text-[9px] text-muted-foreground">Trees/Year</p>
                </div>
              </div>
              <Button
                className="mt-2 gap-2 bg-neon-emerald/15 border border-neon-emerald/30 text-neon-emerald hover:bg-neon-emerald/25 hover:text-neon-emerald"
                variant="ghost"
                onClick={exportReport}
                disabled={carbonStats.carbonSavedGrams <= 0 && carbonStats.carbonFootprintGrams <= 0}
              >
                <Download className="size-4" />
                Download Climate Report (.txt)
              </Button>
              <p className="text-[9px] text-muted-foreground/50 mt-1">
                Report includes carbon metrics, top 10 savers, full timeline, and conversion methodology
              </p>
            </CardContent>
          </Card>

          {/* Report preview */}
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border py-3 px-5">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium text-foreground">Report Preview</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <pre className="text-[9px] font-mono text-muted-foreground/80 leading-relaxed whitespace-pre-wrap">
{`╔══════════════════════════════════════════╗
║      Data Guardian — Climate Report      ║
║           Generated: ${new Date().toLocaleDateString().padEnd(20)}║
╚══════════════════════════════════════════╝

CO₂ Saved:          ${carbonStats.carbonSavedGrams.toFixed(2)} grams
CO₂ Footprint:      ${carbonStats.carbonFootprintGrams.toFixed(2)} grams
Offset Rate:        ${offsetPct}%
Tree Equivalence:   ${treesEquiv.toFixed(4)} trees/year
Data Saved:         ${totalDataSaved.toFixed(1)} MB

── Top Carbon Savers ──
${topSavers.slice(0, 5).map((p, i) => `  ${i + 1}. ${p.name} — saved ${p.savedGrams.toFixed(3)}g`).join("\n") || "  (no data yet)"}

── Methodology ──
  Conversion: 0.03 g CO₂ per MB transferred
  Tree equivalence: 21,000 g CO₂ per tree/year (EPA)`}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
