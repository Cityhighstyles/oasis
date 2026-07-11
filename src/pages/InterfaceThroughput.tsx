import { useState, useEffect, useMemo, useRef } from "react"
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Gauge,
  TrendingUp,
  BarChart3,
  RotateCcw,
  Info,
  Database,
  Zap,
  ArrowDownUp,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

// ── Constants ─────────────────────────────────────────────────────────────

/// Maximum number of samples to keep in the real-time chart window.
const MAX_SAMPLES = 60 // 120 seconds at 2s intervals

/// Maximum reference speed for the chart Y-axis (auto-scales).
/// Starts at 10 MB/s and doubles until it exceeds the max value.
const BASE_MAX_SPEED = 10 * 1024 * 1024 // 10 MB/s

// ── Helpers ───────────────────────────────────────────────────────────────

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024 * 1024)).toFixed(2)} GB/s`
  } else if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
  } else if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
  }
  return `${Math.round(bytesPerSecond)} B/s`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  } else if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`
  }
  return `${Math.round(bytes)} B`
}

interface ThroughputSample {
  timestamp: number
  recv: number
  send: number
}

// ── DualLineChart Component ───────────────────────────────────────────────

function DualLineChart({
  samples,
  maxVal,
}: {
  samples: ThroughputSample[]
  maxVal: number
}) {
  const width = 720
  const height = 240
  const padding = { top: 20, right: 16, bottom: 24, left: 56 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  if (samples.length < 2 || maxVal <= 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground/40"
        style={{ width, height }}
      >
        <Activity className="size-6" />
        <span className="text-xs ml-2">Waiting for data...</span>
      </div>
    )
  }

  const yMax = maxVal * 1.15 // 15% headroom
  const xStep = chartW / Math.max(samples.length - 1, 1)

  const toX = (i: number) => padding.left + i * xStep
  const toY = (v: number) => padding.top + chartH - (v / yMax) * chartH

  // Build SVG path strings
  const recvPath = samples
    .map((s, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(s.recv).toFixed(1)}`)
    .join("")

  const sendPath = samples
    .map((s, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(s.send).toFixed(1)}`)
    .join("")

  // Filled area under recv
  const recvArea =
    recvPath +
    `L${toX(samples.length - 1).toFixed(1)},${toY(0).toFixed(1)}` +
    `L${toX(0).toFixed(1)},${toY(0).toFixed(1)}Z`

  // Filled area under send
  const sendArea =
    sendPath +
    `L${toX(samples.length - 1).toFixed(1)},${toY(0).toFixed(1)}` +
    `L${toX(0).toFixed(1)},${toY(0).toFixed(1)}Z`

  // Y-axis ticks (4 evenly-spaced values)
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0].map((f) => ({
    value: f * yMax,
    label: formatSpeed(f * yMax),
    y: toY(f * yMax),
  }))

  // X-axis labels (show ~5 evenly-spaced timestamps)
  const xLabelCount = 5
  const xLabelStep = Math.max(1, Math.floor((samples.length - 1) / (xLabelCount - 1)))
  const xLabels: { i: number; label: string }[] = []
  for (let i = 0; i < samples.length; i += xLabelStep) {
    const s = samples[i]
    const secsAgo = Math.round((Date.now() - s.timestamp) / 1000)
    xLabels.push({
      i,
      label: secsAgo === 0 ? "now" : secsAgo < 60 ? `-${secsAgo}s` : `-${Math.floor(secsAgo / 60)}m`,
    })
  }
  // Always include the last
  const last = samples.length - 1
  if (xLabels.length === 0 || xLabels[xLabels.length - 1].i !== last) {
    xLabels.push({ i: last, label: "now" })
  }

  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Grid lines (horizontal) */}
      {yTicks.map((tick, i) => (
        <g key={i}>
          <line
            x1={padding.left}
            y1={tick.y}
            x2={padding.left + chartW}
            y2={tick.y}
            stroke="oklch(0.2 0.012 264)"
            strokeWidth={1}
          />
          <text
            x={padding.left - 8}
            y={tick.y + 3}
            textAnchor="end"
            fill="oklch(0.5 0.02 264)"
            className="text-[10px] font-mono tabular-nums"
          >
            {tick.label}
          </text>
        </g>
      ))}

      {/* Recv area fill */}
      <path d={recvArea} fill="oklch(0.72 0.19 165 / 0.12)" />

      {/* Send area fill */}
      <path d={sendArea} fill="oklch(0.65 0.2 225 / 0.10)" />

      {/* Recv line */}
      <path
        d={recvPath}
        fill="none"
        stroke="oklch(0.72 0.19 165)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          filter: "drop-shadow(0 0 4px oklch(0.72 0.19 165 / 0.5))",
          transition: "d 0.3s ease",
        }}
      />

      {/* Send line */}
      <path
        d={sendPath}
        fill="none"
        stroke="oklch(0.65 0.2 225)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          filter: "drop-shadow(0 0 4px oklch(0.65 0.2 225 / 0.5))",
          transition: "d 0.3s ease",
        }}
      />

      {/* X-axis labels */}
      {xLabels.map((xl, i) => (
        <text
          key={i}
          x={toX(xl.i)}
          y={height - 4}
          textAnchor="middle"
          fill="oklch(0.4 0.015 264)"
          className="text-[9px] font-mono tabular-nums"
        >
          {xl.label}
        </text>
      ))}

      {/* Latest dot on recv */}
      <circle
        cx={toX(last)}
        cy={toY(samples[last].recv)}
        r={3}
        fill="oklch(0.72 0.19 165)"
        style={{ filter: "drop-shadow(0 0 6px oklch(0.72 0.19 165 / 0.8))" }}
      />

      {/* Latest dot on send */}
      <circle
        cx={toX(last)}
        cy={toY(samples[last].send)}
        r={3}
        fill="oklch(0.65 0.2 225)"
        style={{ filter: "drop-shadow(0 0 6px oklch(0.65 0.2 225 / 0.8))" }}
      />
    </svg>
  )
}

// ── MiniBarChart Component ────────────────────────────────────────────────

function MiniBarChart({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data)
  return (
    <div className="flex items-end gap-[2px] h-8">
      {data.slice(-30).map((val, i) => {
        const pct = (val / max) * 100
        return (
          <div
            key={i}
            className="w-[3px] rounded-[1px] transition-all duration-300"
            style={{
              height: `${Math.max(pct > 0 ? 2 : 1, pct)}%`,
              backgroundColor: color,
              minHeight: "1px",
            }}
          />
        )
      })}
    </div>
  )
}

// ── Main Page Component ──────────────────────────────────────────────────

export function InterfaceThroughput() {
  const { totalThroughput } = useShield()

  const [samples, setSamples] = useState<ThroughputSample[]>([])
  const [totalRecv, setTotalRecv] = useState(0)
  const [totalSend, setTotalSend] = useState(0)
  const [peakRecv, setPeakRecv] = useState(0)
  const [peakSend, setPeakSend] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef(Date.now())

  // ── Track throughput history every 2 seconds ──────────────────────
  useEffect(() => {
    const now = Date.now()
    const tp = totalThroughput

    // Accumulate total data transferred (bytes = bytes/sec * 2s)
    const intervalSec = 2
    const recvDelta = tp.bytesReceivedPerSec * intervalSec
    const sendDelta = tp.bytesSentPerSec * intervalSec

    setTotalRecv((prev) => prev + recvDelta)
    setTotalSend((prev) => prev + sendDelta)

    setPeakRecv((prev) => Math.max(prev, tp.bytesReceivedPerSec))
    setPeakSend((prev) => Math.max(prev, tp.bytesSentPerSec))

    setSamples((prev) => {
      const updated = [
        ...prev,
        { timestamp: now, recv: tp.bytesReceivedPerSec, send: tp.bytesSentPerSec },
      ].slice(-MAX_SAMPLES)
      return updated
    })

    setElapsed(Math.floor((now - startTimeRef.current) / 1000))
  }, [totalThroughput])

  // ── Compute dynamic Y-axis max ───────────────────────────────────
  const chartMax = useMemo(() => {
    if (samples.length === 0) return BASE_MAX_SPEED
    const maxVal = Math.max(
      ...samples.map((s) => Math.max(s.recv, s.send)),
      BASE_MAX_SPEED
    )
    // Scale up to next "nice" number
    let scale = BASE_MAX_SPEED
    while (scale < maxVal) {
      scale *= 2
    }
    return scale
  }, [samples])

  // ── Stats ─────────────────────────────────────────────────────────
  const avgRecv = useMemo(() => {
    if (samples.length === 0) return 0
    return samples.reduce((sum, s) => sum + s.recv, 0) / samples.length
  }, [samples])

  const avgSend = useMemo(() => {
    if (samples.length === 0) return 0
    return samples.reduce((sum, s) => sum + s.send, 0) / samples.length
  }, [samples])

  const isActive = totalThroughput.bytesReceivedPerSec > 0 || totalThroughput.bytesSentPerSec > 0

  // ── Sample recv/send arrays for mini sparklines ──────────────────
  const recvSamples = useMemo(() => samples.map((s) => s.recv), [samples])
  const sendSamples = useMemo(() => samples.map((s) => s.send), [samples])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Activity className="size-5 text-neon-cyan" />
            Interface Throughput
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time NDIS miniport driver bandwidth — exactly like Task Manager's Performance tab
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 font-mono">
          <div
            className={cn(
              "size-1.5 rounded-full",
              isActive ? "bg-neon-emerald animate-pulse" : "bg-muted-foreground/40"
            )}
          />
          {isActive ? "LIVE" : "IDLE"}
          {elapsed > 0 && (
            <span className="ml-2 text-muted-foreground/40">
              {elapsed >= 60
                ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
                : `${elapsed}s`}
            </span>
          )}
        </div>
      </div>

      {/* Live Speed Cards */}
      <div className="grid grid-cols-4 gap-4">
        {/* Download */}
        <Card className="border-neon-emerald/20 bg-neon-emerald/5 col-span-1">
          <CardContent className="flex flex-col items-center gap-2 py-5 px-4">
            <div className="flex items-center gap-1.5">
              <ArrowDown className="size-4 text-neon-emerald" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                Download
              </span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-neon-emerald">
              {formatSpeed(totalThroughput.bytesReceivedPerSec)}
            </p>
            <div className="w-full">
              <MiniBarChart data={recvSamples} color="oklch(0.72 0.19 165)" />
            </div>
            <p className="text-[9px] text-muted-foreground/50">
              Peak: {formatSpeed(peakRecv)}
            </p>
          </CardContent>
        </Card>

        {/* Upload */}
        <Card className="border-neon-cyan/20 bg-neon-cyan/5 col-span-1">
          <CardContent className="flex flex-col items-center gap-2 py-5 px-4">
            <div className="flex items-center gap-1.5">
              <ArrowUp className="size-4 text-neon-cyan" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                Upload
              </span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-neon-cyan">
              {formatSpeed(totalThroughput.bytesSentPerSec)}
            </p>
            <div className="w-full">
              <MiniBarChart data={sendSamples} color="oklch(0.65 0.2 225)" />
            </div>
            <p className="text-[9px] text-muted-foreground/50">
              Peak: {formatSpeed(peakSend)}
            </p>
          </CardContent>
        </Card>

        {/* Total Throughput */}
        <Card className="border-border bg-card col-span-1">
          <CardContent className="flex flex-col items-center gap-2 py-5 px-4">
            <div className="flex items-center gap-1.5">
              <Gauge className="size-4 text-amber-400" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                Total
              </span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-amber-400">
              {formatSpeed(totalThroughput.bytesReceivedPerSec + totalThroughput.bytesSentPerSec)}
            </p>
            <div className="h-8 flex items-center justify-center">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-[9px]">
                  <span className="size-1.5 rounded-full bg-neon-emerald" />
                  <span className="text-muted-foreground/60">{formatSpeed(totalThroughput.bytesReceivedPerSec)}</span>
                </span>
                <span className="flex items-center gap-1 text-[9px]">
                  <span className="size-1.5 rounded-full bg-neon-cyan" />
                  <span className="text-muted-foreground/60">{formatSpeed(totalThroughput.bytesSentPerSec)}</span>
                </span>
              </div>
            </div>
            <p className="text-[9px] text-muted-foreground/50">
              Recv + Send combined
            </p>
          </CardContent>
        </Card>

        {/* Data Transferred */}
        <Card className="border-border bg-card col-span-1">
          <CardContent className="flex flex-col items-center gap-2 py-5 px-4">
            <div className="flex items-center gap-1.5">
              <Database className="size-4 text-violet-400" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                Transferred
              </span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-violet-400">
              {formatBytes(totalRecv + totalSend)}
            </p>
            <div className="h-8 flex items-center justify-center">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-[9px]">
                  <ArrowDown className="size-2.5 text-neon-emerald" />
                  <span className="text-muted-foreground/60">{formatBytes(totalRecv)}</span>
                </span>
                <span className="flex items-center gap-1 text-[9px]">
                  <ArrowUp className="size-2.5 text-neon-cyan" />
                  <span className="text-muted-foreground/60">{formatBytes(totalSend)}</span>
                </span>
              </div>
            </div>
            <p className="text-[9px] text-muted-foreground/50">
              This session (cumulative)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Real-time Chart */}
      <Card className="border-border bg-card overflow-hidden">
        <CardHeader className="border-b border-border py-3 px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium text-foreground">
                Real-time Bandwidth
              </CardTitle>
              <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">
                {samples.length} samples
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-neon-emerald" />
                  <span className="text-muted-foreground/60">Download</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-neon-cyan" />
                  <span className="text-muted-foreground/60">Upload</span>
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[9px] gap-1 text-muted-foreground/60 hover:text-foreground"
                onClick={() => {
                  setSamples([])
                  setTotalRecv(0)
                  setTotalSend(0)
                  setPeakRecv(0)
                  setPeakSend(0)
                  startTimeRef.current = Date.now()
                  setElapsed(0)
                }}
              >
                <RotateCcw className="size-2.5" />
                Reset
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 flex justify-center">
          <DualLineChart samples={samples} maxVal={chartMax} />
        </CardContent>
      </Card>

      {/* Statistics Grid */}
      <div className="grid grid-cols-4 gap-4">
        {/* Average Download */}
        <Card className="border-border bg-card">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neon-emerald/20 bg-neon-emerald/5">
              <TrendingUp className="size-4 text-neon-emerald" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-medium">
                Avg Download
              </p>
              <p className="text-sm font-bold tabular-nums text-neon-emerald">
                {formatSpeed(avgRecv)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Average Upload */}
        <Card className="border-border bg-card">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/20 bg-neon-cyan/5">
              <TrendingUp className="size-4 text-neon-cyan" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-medium">
                Avg Upload
              </p>
              <p className="text-sm font-bold tabular-nums text-neon-cyan">
                {formatSpeed(avgSend)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Peak Download */}
        <Card className="border-border bg-card">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/5">
              <Zap className="size-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-medium">
                Peak Download
              </p>
              <p className="text-sm font-bold tabular-nums text-amber-400">
                {formatSpeed(peakRecv)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Peak Upload */}
        <Card className="border-border bg-card">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/5">
              <ArrowDownUp className="size-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-medium">
                Peak Upload
              </p>
              <p className="text-sm font-bold tabular-nums text-amber-400">
                {formatSpeed(peakSend)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Interface Info */}
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Info className="size-3.5 text-muted-foreground" />
            <p className="text-[10px] font-medium text-muted-foreground">About this data</p>
          </div>
          <p className="text-[9px] text-muted-foreground/60 leading-relaxed">
            Interface throughput is measured at the <strong className="text-foreground">NDIS miniport driver</strong> layer using{' '}
            <strong className="text-foreground">Windows Performance Counters</strong> (PDH). This is the same data source
            that the <strong className="text-foreground">Task Manager Performance tab</strong> uses to render its network
            graph. Unlike per-process tracking (which measures which application is talking), this measures total
            hardware-level bandwidth consumed by the physical network adapter — the "highway" itself.
          </p>
          <div className="flex items-center gap-3 mt-3 text-[8px] text-muted-foreground/40 font-mono">
            <span>Source: \Network Interface(*)\Bytes Received/sec</span>
            <span>·</span>
            <span>Polling: 2s interval</span>
            <span>·</span>
            <span>Window: {MAX_SAMPLES * 2}s ({MAX_SAMPLES} samples)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
