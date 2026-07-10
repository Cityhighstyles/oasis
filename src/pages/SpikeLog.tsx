import { useState, useMemo, useCallback } from "react"
import {
  Zap,
  Search,
  Trash2,
  AlertTriangle,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Clock,
  Gauge,
  Flame,
  Bell,
  BarChart3,
  RotateCcw,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useShield, type SpikeEvent } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

// ── Constants ───────────────────────────────────────────────────────

type SortKey = "timestamp" | "name" | "ratio" | "currentSpeedBytes"
type SortDir = "asc" | "desc"
type SeverityFilter = "all" | "critical" | "high" | "moderate"

const SEVERITY_CONFIG = {
  critical: { label: "Critical", color: "text-destructive", dot: "bg-destructive", border: "border-destructive/30", bg: "bg-destructive/5", minRatio: 10 },
  high: { label: "High", color: "text-amber-400", dot: "bg-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/5", minRatio: 5 },
  moderate: { label: "Moderate", color: "text-neon-cyan", dot: "bg-neon-cyan", border: "border-neon-cyan/20", bg: "bg-neon-cyan/5", minRatio: 3 },
}

function getSeverity(ratio: number): "critical" | "high" | "moderate" {
  if (ratio >= 10) return "critical"
  if (ratio >= 5) return "high"
  return "moderate"
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
  } else if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
  }
  return `${bytesPerSecond.toFixed(0)} B/s`
}

function formatTimestamp(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  }
}

// ── Sparkline component ─────────────────────────────────────────────

function RatioBar({ ratio, maxRatio }: { ratio: number; maxRatio: number }) {
  const pct = Math.min((ratio / Math.max(maxRatio, 1)) * 100, 100)
  const sev = getSeverity(ratio)
  const color = sev === "critical" ? "oklch(0.63 0.22 25)" : sev === "high" ? "oklch(0.75 0.16 80)" : "oklch(0.7 0.18 200)"

  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 rounded-full bg-muted/30 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-bold tabular-nums w-10 text-right shrink-0">
        {ratio.toFixed(1)}x
      </span>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────

export function SpikeLog() {
  const {
    spikeEvents,
    clearSpikeEvents,
    spikeSettings,
    setSpikeThreshold,
    setSpikeMinSpeed,
    refreshSpikeSettings,
  } = useShield()

  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortKey>("timestamp")
  const [sortOrder, setSortOrder] = useState<SortDir>("desc")
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all")

  // ── Settings editing ──────────────────────────────────────────────
  const [editingThreshold, setEditingThreshold] = useState(false)
  const [editThreshold, setEditThreshold] = useState(spikeSettings.threshold)
  const [editingMinSpeed, setEditingMinSpeed] = useState(false)
  const [editMinSpeed, setEditMinSpeed] = useState(spikeSettings.minSpeedBytes)

  const handleApplyThreshold = useCallback(() => {
    setSpikeThreshold(editThreshold)
    setEditingThreshold(false)
  }, [editThreshold, setSpikeThreshold])

  const handleApplyMinSpeed = useCallback(() => {
    setSpikeMinSpeed(editMinSpeed)
    setEditingMinSpeed(false)
  }, [editMinSpeed, setSpikeMinSpeed])

  // ── Computed values ───────────────────────────────────────────────
  const maxRatio = useMemo(() => {
    if (spikeEvents.length === 0) return 10
    return Math.max(...spikeEvents.map(s => s.ratio), 10)
  }, [spikeEvents])

  const filteredAndSorted = useMemo(() => {
    let filtered = spikeEvents

    // Search filter
    const lowerSearch = search.toLowerCase()
    if (lowerSearch) {
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(lowerSearch) ||
        s.exe.toLowerCase().includes(lowerSearch) ||
        String(s.pid).includes(lowerSearch)
      )
    }

    // Severity filter
    if (severityFilter !== "all") {
      const minR = SEVERITY_CONFIG[severityFilter].minRatio
      if (severityFilter === "critical") {
        filtered = filtered.filter(s => s.ratio >= 10)
      } else if (severityFilter === "high") {
        filtered = filtered.filter(s => s.ratio >= 5 && s.ratio < 10)
      } else {
        filtered = filtered.filter(s => s.ratio >= 3 && s.ratio < 5)
      }
    }

    // Sort
    filtered.sort((a, b) => {
      let cmp = 0
      if (sortField === "timestamp") cmp = a.timestamp.localeCompare(b.timestamp)
      else if (sortField === "name") cmp = a.name.localeCompare(b.name)
      else if (sortField === "ratio") cmp = a.ratio - b.ratio
      else if (sortField === "currentSpeedBytes") cmp = a.currentSpeedBytes - b.currentSpeedBytes
      return sortOrder === "asc" ? cmp : -cmp
    })

    return filtered
  }, [spikeEvents, search, sortField, sortOrder, severityFilter])

  // ── Aggregate stats ───────────────────────────────────────────────
  const stats = useMemo(() => {
    if (spikeEvents.length === 0) return null
    const total = spikeEvents.length
    const avgRatio = spikeEvents.reduce((s, e) => s + e.ratio, 0) / total
    const maxRatioVal = Math.max(...spikeEvents.map(e => e.ratio))
    const worstSpike = spikeEvents.reduce((worst, e) => e.ratio > worst.ratio ? e : worst, spikeEvents[0])
    const criticalCount = spikeEvents.filter(e => e.ratio >= 10).length
    const highCount = spikeEvents.filter(e => e.ratio >= 5 && e.ratio < 10).length
    const uniqueApps = new Set(spikeEvents.map(e => e.exe.toLowerCase())).size
    return { total, avgRatio, maxRatio: maxRatioVal, worstSpike, criticalCount, highCount, uniqueApps }
  }, [spikeEvents])

  const handleSort = (key: SortKey) => {
    if (sortField === key) {
      setSortOrder(d => d === "asc" ? "desc" : "asc")
    } else {
      setSortField(key)
      setSortOrder("desc")
    }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortField !== k) return <ChevronUp className="size-3 text-muted-foreground/40" />
    return sortOrder === "asc" ? (
      <ChevronUp className="size-3 text-neon-emerald" />
    ) : (
      <ChevronDown className="size-3 text-neon-emerald" />
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Zap className="size-5 text-destructive" />
            Spike Log
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track sudden data usage spikes across all monitored processes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={clearSpikeEvents}
            disabled={spikeEvents.length === 0}
            className="gap-1.5 border-border"
          >
            <Trash2 className="size-3.5" />
            Clear All
          </Button>
        </div>
      </div>

      {/* Stats summary */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          <Card className="border-border bg-card">
            <CardContent className="flex items-center gap-3 py-3 px-4">
              <Bell className="size-5 shrink-0 text-destructive" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Total Spikes</p>
                <p className="text-lg font-bold tabular-nums text-foreground">{stats.total}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardContent className="flex items-center gap-3 py-3 px-4">
              <Flame className="size-5 shrink-0 text-amber-400" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Worst Spike</p>
                <p className="text-lg font-bold tabular-nums text-amber-400">{stats.maxRatio.toFixed(1)}x</p>
                <p className="text-[9px] text-muted-foreground/60 truncate max-w-28">{stats.worstSpike.name}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardContent className="flex items-center gap-3 py-3 px-4">
              <TrendingUp className="size-5 shrink-0 text-neon-cyan" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Avg Ratio</p>
                <p className="text-lg font-bold tabular-nums text-neon-cyan">{stats.avgRatio.toFixed(1)}x</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-destructive/20 bg-destructive/5">
            <CardContent className="flex items-center gap-3 py-3 px-4">
              <AlertTriangle className="size-5 shrink-0 text-destructive" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Critical</p>
                <p className="text-lg font-bold tabular-nums text-destructive">{stats.criticalCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardContent className="flex items-center gap-3 py-3 px-4">
              <BarChart3 className="size-5 shrink-0 text-amber-400" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Apps Affected</p>
                <p className="text-lg font-bold tabular-nums text-amber-400">{stats.uniqueApps}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!stats && (
        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Zap className="size-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm font-medium">No spike events detected</p>
            <p className="text-xs text-muted-foreground/60 mt-1 text-center max-w-md">
              Data spikes are detected when a process suddenly starts consuming significantly more bandwidth
              than its recent average. They will appear here automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Spike table */}
      {stats && (
        <Card className="border-border bg-card overflow-hidden">
          <CardHeader className="border-b border-border py-3 px-5">
            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 max-w-56">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search spikes..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 bg-background/50 text-xs border-border focus-visible:ring-ring/50"
                />
              </div>

              {/* Severity filter tabs */}
              <div className="flex items-center gap-0.5 bg-muted/60 rounded-md p-0.5 border border-border/50">
                {(["all", "critical", "high", "moderate"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSeverityFilter(s)}
                    className={cn(
                      "px-2 py-1 rounded text-[10px] font-medium transition-all duration-150",
                      severityFilter === s
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground/60 hover:text-foreground"
                    )}
                  >
                    {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>

              {/* Refresh button */}
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs border-border"
                onClick={() => { refreshSpikeSettings() }}
              >
                <RotateCcw className="size-3" />
                Refresh
              </Button>

              <Badge
                variant="outline"
                className="ml-auto text-[10px] border-border text-muted-foreground"
              >
                {filteredAndSorted.length} of {spikeEvents.length}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {/* Table header */}
            <div className="grid grid-cols-[140px_1fr_80px_120px_1fr] gap-3 border-b border-border bg-muted/20 px-5 py-2">
              {([
                { key: "timestamp" as SortKey, label: "Time" },
                { key: "name" as SortKey, label: "Process" },
                { key: null, label: "PID" },
                { key: "currentSpeedBytes" as SortKey, label: "Speed" },
                { key: "ratio" as SortKey, label: "Spike Ratio" },
              ] as { key: SortKey | null; label: string }[]).map(({ key, label }) => (
                <button
                  key={label}
                  onClick={() => key && handleSort(key)}
                  disabled={!key}
                  className={cn(
                    "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground text-left",
                    key && "hover:text-foreground cursor-pointer transition-colors"
                  )}
                >
                  {label}
                  {key && <SortIcon k={key} />}
                </button>
              ))}
            </div>

            {/* Rows */}
            <div className="divide-y divide-border">
              {filteredAndSorted.length > 0 ? (
                filteredAndSorted.map((spike, i) => {
                  const sev = getSeverity(spike.ratio)
                  const sevCfg = SEVERITY_CONFIG[sev]
                  const { date, time } = formatTimestamp(spike.timestamp)
                  const speedMBs = (spike.currentSpeedBytes / (1024 * 1024)).toFixed(1)
                  const avgMBs = (spike.averageSpeedBytes / (1024 * 1024)).toFixed(2)

                  return (
                    <div
                      key={`${spike.pid}-${spike.timestamp}-${i}`}
                      className={cn(
                        "grid grid-cols-[140px_1fr_80px_120px_1fr] gap-3 px-5 py-3 items-center transition-colors",
                        sev === "critical" ? "bg-destructive/3 hover:bg-destructive/8" :
                        sev === "high" ? "hover:bg-amber-500/5" :
                        "hover:bg-accent/20"
                      )}
                    >
                      {/* Timestamp */}
                      <div className="flex items-center gap-2 min-w-0">
                        <Clock className="size-3 text-muted-foreground/50 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-foreground/70 tabular-nums">{time}</p>
                          <p className="text-[9px] text-muted-foreground/50">{date}</p>
                        </div>
                      </div>

                      {/* Process name + exe */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("size-1.5 shrink-0 rounded-full", sevCfg.dot)} />
                          <p className="text-xs font-medium text-foreground truncate">{spike.name}</p>
                          <Badge variant="outline" className={cn("text-[8px] h-4 px-1", sevCfg.border, sevCfg.color)}>
                            {sevCfg.label}
                          </Badge>
                        </div>
                        <p className="text-[9px] font-mono text-muted-foreground/50 truncate">{spike.exe}</p>
                      </div>

                      {/* PID */}
                      <div className="self-center">
                        <span className="text-xs font-mono tabular-nums text-muted-foreground/70">
                          {spike.pid}
                        </span>
                      </div>

                      {/* Speed info */}
                      <div className="self-center">
                        <p className={cn(
                          "text-xs font-bold tabular-nums",
                          sev === "critical" ? "text-destructive" : sev === "high" ? "text-amber-400" : "text-neon-cyan"
                        )}>
                          {formatSpeed(spike.currentSpeedBytes)}
                        </p>
                        <p className="text-[9px] text-muted-foreground/50">
                          avg {formatSpeed(spike.averageSpeedBytes)}
                        </p>
                      </div>

                      {/* Ratio bar */}
                      <div className="self-center pr-4">
                        <RatioBar ratio={spike.ratio} maxRatio={maxRatio} />
                        <p className="text-[9px] text-muted-foreground/40 mt-0.5 text-right">
                          {speedMBs} MB/s vs avg {avgMBs} MB/s
                        </p>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
                  {search || severityFilter !== "all"
                    ? "No spikes match your filters"
                    : "No spike events recorded"}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detection Settings */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Gauge className="size-4 text-neon-cyan" />
            Spike Detection Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-3 gap-6">
            {/* Threshold */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground mb-1.5 block">
                Sensitivity Threshold
              </label>
              <div className="flex items-center gap-2">
                {editingThreshold ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1.5}
                      max={50}
                      step={0.5}
                      value={editThreshold}
                      onChange={(e) => setEditThreshold(Number(e.target.value))}
                      className="w-16 h-7 text-xs font-mono text-right bg-muted/50 border border-border rounded px-1 outline-none focus:border-neon-cyan"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleApplyThreshold()
                        if (e.key === "Escape") setEditingThreshold(false)
                      }}
                      onBlur={handleApplyThreshold}
                    />
                    <span className="text-[10px] text-muted-foreground/60">x avg</span>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditThreshold(spikeSettings.threshold); setEditingThreshold(true) }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border hover:border-neon-cyan/30 hover:bg-neon-cyan/5 transition-all"
                  >
                    <span className="text-sm font-bold tabular-nums text-foreground">{spikeSettings.threshold.toFixed(1)}</span>
                    <span className="text-[9px] text-muted-foreground/60">x avg</span>
                  </button>
                )}
              </div>
              <p className="text-[9px] text-muted-foreground/50 mt-1">
                Lower = more sensitive (more alerts). Default: 3.0x
              </p>
            </div>

            {/* Min Speed */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground mb-1.5 block">
                Minimum Transfer Speed
              </label>
              <div className="flex items-center gap-2">
                {editingMinSpeed ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1024}
                      step={1024}
                      value={editMinSpeed}
                      onChange={(e) => setEditMinSpeed(Math.max(1024, Number(e.target.value)))}
                      className="w-20 h-7 text-xs font-mono text-right bg-muted/50 border border-border rounded px-1 outline-none focus:border-neon-cyan"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleApplyMinSpeed()
                        if (e.key === "Escape") setEditingMinSpeed(false)
                      }}
                      onBlur={handleApplyMinSpeed}
                    />
                    <span className="text-[10px] text-muted-foreground/60">B/s</span>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditMinSpeed(spikeSettings.minSpeedBytes); setEditingMinSpeed(true) }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border hover:border-neon-cyan/30 hover:bg-neon-cyan/5 transition-all"
                  >
                    <span className="text-sm font-bold tabular-nums text-foreground">{formatSpeed(spikeSettings.minSpeedBytes)}</span>
                  </button>
                )}
              </div>
              <p className="text-[9px] text-muted-foreground/50 mt-1">
                Ignore spikes below this speed. Default: 100 KB/s
              </p>
            </div>

            {/* Window Info */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground mb-1.5 block">
                Detection Window
              </label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border">
                  <span className="text-sm font-bold tabular-nums text-foreground">{spikeSettings.windowSize}</span>
                  <span className="text-[9px] text-muted-foreground/60">samples</span>
                </div>
                <span className="text-[10px] text-muted-foreground/50">
                  ≈ {spikeSettings.windowSize * 2}s window
                </span>
              </div>
              <p className="text-[9px] text-muted-foreground/50 mt-1">
                Rolling average window. Default: 6 samples (12s)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-border/50">
            <Badge variant="outline" className="text-[9px] border-destructive/30 text-destructive">
              Critical: 10x+
            </Badge>
            <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">
              High: 5x–10x
            </Badge>
            <Badge variant="outline" className="text-[9px] border-neon-cyan/30 text-neon-cyan">
              Moderate: 3x–5x
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
