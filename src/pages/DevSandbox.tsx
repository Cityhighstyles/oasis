import { useState, useEffect, useRef, useCallback } from "react"
import {
  FlaskConical,
  Play,
  Square,
  Clock,
  Terminal,
  Package,
  Container,
  GitBranch,
  Puzzle,
  Snake,
  Crab,
  Download,
  Bot,
  HardHat,
  Globe,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Key,
  Trash2,
  Scan,
  Loader2,
  Info,
  ArrowUpRight,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

// ══════════════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════════════

export interface CommandType {
  label: string
  icon: string
}

export interface DetectedOperation {
  id: string
  commandType: { label: string; icon: string }
  commandLine: string
  executable: string
  pid: number
  detectedAt: string
  estimatedMb: number
  estimatedRangeMinMb: number
  estimatedRangeMaxMb: number
  confidence: number
  status: string
  packageName: string
  workingDir: string
  aiReasoning: string
}

interface SandboxStatus {
  isRunning: boolean
  hasGroqKey: boolean
  operationsCount: number
}

// ══════════════════════════════════════════════════════════════════════════════
// Icon map
// ══════════════════════════════════════════════════════════════════════════════

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  package: Package,
  container: Container,
  "git-branch": GitBranch,
  puzzle: Puzzle,
  snake: Snake,
  crab: Crab,
  download: Download,
  bot: Bot,
  "hard-hat": HardHat,
  beer: Package,
  linux: Terminal,
  dotnet: Terminal,
  globe: Globe,
  terminal: Terminal,
}

const COMMAND_COLORS: Record<string, string> = {
  "npm install": "neon-emerald",
  "pnpm install": "neon-emerald",
  "yarn install": "neon-emerald",
  "npx run": "emerald-300",
  "docker pull": "neon-cyan",
  "docker build": "neon-cyan",
  "docker compose": "cyan-300",
  "git clone": "blue-400",
  "git pull": "blue-300",
  "git fetch": "blue-200",
  "VS Code Extension Install": "purple-400",
  "VS Code Extension Update": "purple-300",
  "pip install": "amber-400",
  "pipenv install": "amber-300",
  "poetry install": "amber-200",
  "cargo install": "orange-400",
  "cargo build": "orange-400",
  "cargo test": "orange-300",
  "winget install": "sky-400",
  "choco install": "red-400",
  "scoop install": "green-400",
  "brew install": "pink-400",
  "apt-get install": "yellow-500",
  "nuget install": "indigo-400",
  "dotnet restore": "indigo-300",
  "dotnet build": "indigo-400",
  "go mod download": "teal-400",
  "go install": "teal-300",
  "go build": "teal-400",
  "maven build": "yellow-400",
  "Gradle build": "yellow-400",
  "Android Studio Download": "lime-400",
}

// ══════════════════════════════════════════════════════════════════════════════
// Duration options (preserved from existing)
// ══════════════════════════════════════════════════════════════════════════════

const DURATIONS = [
  { label: "15 min", seconds: 15 * 60 },
  { label: "30 min", seconds: 30 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
]

// ══════════════════════════════════════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════════════════════════════════════

export function DevSandbox() {
  const { isShieldActive } = useShield()

  // ── Timer state (preserved from existing) ───────────────────────────────
  const [selectedDuration, setSelectedDuration] = useState(DURATIONS[0])
  const [isPaused, setIsPaused] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const [logLines, setLogLines] = useState<string[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Sandbox scanner state ───────────────────────────────────────────────
  const [operations, setOperations] = useState<DetectedOperation[]>([])
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null)
  const [groqKeyInput, setGroqKeyInput] = useState("")
  const [showGroqInput, setShowGroqInput] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [overlayWindows, setOverlayWindows] = useState<Set<string>>(new Set())

  const logRef = useRef<HTMLDivElement>(null)
  const operationsEndRef = useRef<HTMLDivElement>(null)

  const totalSeconds = selectedDuration.seconds
  const pct = isPaused ? ((totalSeconds - timeLeft) / totalSeconds) * 100 : 0
  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60

  // ── Listen for sandbox events ───────────────────────────────────────────
  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = []

    const setup = async () => {
      const u1 = await listen<DetectedOperation>("sandbox-operation-detected", (event) => {
        setOperations((prev) => [event.payload, ...prev])
        setLogLines((prev) => [
          ...prev,
          `[${event.payload.detectedAt}] Detected: ${event.payload.commandType.label} (PID ${event.payload.pid})`,
        ])
      })
      unlisteners.push(Promise.resolve(u1))

      const u2 = await listen<DetectedOperation>("sandbox-operation-updated", (event) => {
        setOperations((prev) =>
          prev.map((op) => (op.id === event.payload.id ? event.payload : op))
        )
        if (event.payload.status === "estimated") {
          setLogLines((prev) => [
            ...prev,
            `[${event.payload.detectedAt}] AI Estimate: ${event.payload.commandType.label} → ${event.payload.estimatedMb.toFixed(1)} MB`,
          ])
        }
      })
      unlisteners.push(Promise.resolve(u2))
    }
    setup()

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()))
    }
  }, [])

  // ── Poll sandbox status ─────────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const status: SandboxStatus = await invoke("get_sandbox_status")
        setSandboxStatus(status)
        setIsScanning(status.isRunning)

        const ops: DetectedOperation[] = await invoke("get_sandbox_operations")
        setOperations(ops)
      } catch (err) {
        console.error("Failed to poll sandbox status:", err)
      }
    }

    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [])

  // ── Auto-scroll operations ──────────────────────────────────────────────
  useEffect(() => {
    operationsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [operations])

  // ── Auto-scroll log ─────────────────────────────────────────────────────
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logLines])

  // ── Timer handlers (preserved) ──────────────────────────────────────────
  const startPause = () => {
    if (!isShieldActive) return
    setIsPaused(true)
    setTimeLeft(selectedDuration.seconds)
    setLogLines((prev) => [...prev, "Pausing WFP kernel filters..."])
    setTimeout(() => setLogLines((prev) => [...prev, "Sandbox mode ACTIVE — shield suspended"]), 400)
    setTimeout(() => setLogLines((prev) => [...prev, "Process scanner running — watching for commands..."]), 800)
  }

  const stopPause = () => {
    setIsPaused(false)
    setTimeLeft(0)
    setLogLines((prev) => [...prev, "Shield restored — all rules re-applied."])
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  useEffect(() => {
    if (!isPaused) return
    intervalRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          setIsPaused(false)
          setLogLines((prev) => [...prev, "Timer elapsed — Shield auto-restored."])
          clearInterval(intervalRef.current!)
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isPaused])

  // ── Sandbox actions ────────────────────────────────────────────────────
  const clearOperations = async () => {
    try {
      await invoke("clear_sandbox_operations")
      setOperations([])
      setLogLines((prev) => [...prev, "Operation history cleared."])
    } catch (err) {
      console.error("Failed to clear operations:", err)
    }
  }

  const setGroqKey = async () => {
    if (!groqKeyInput.trim()) return
    try {
      await invoke("set_groq_api_key", { key: groqKeyInput.trim() })
      setShowGroqInput(false)
      setGroqKeyInput("")
      setLogLines((prev) => [...prev, "Groq AI API key configured — AI estimates enabled."])
    } catch (err) {
      console.error("Failed to set Groq API key:", err)
    }
  }

  const openOverlay = async (opId: string) => {
    try {
      await invoke("create_sandbox_overlay", { operationId: opId })
      setOverlayWindows((prev) => new Set(prev).add(opId))
    } catch (err) {
      console.error("Failed to open overlay:", err)
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  const getColorClass = (label: string) => {
    const color = COMMAND_COLORS[label] || "muted-foreground"
    return color
  }

  const ringColor = timeLeft > 300 ? "#10b981" : timeLeft > 60 ? "#f59e0b" : "#ef4444"

  // ══════════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <FlaskConical className="size-5 text-neon-emerald" />
            Developer Sandbox
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time command detection, AI download estimation, and process monitoring
          </p>
        </div>
        {/* Scanner status indicator */}
        {sandboxStatus && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 border text-[11px] font-medium",
              sandboxStatus.isRunning
                ? "border-neon-emerald/20 bg-neon-emerald/5 text-neon-emerald"
                : "border-border bg-muted/40 text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                sandboxStatus.isRunning ? "bg-neon-emerald animate-pulse" : "bg-muted-foreground"
              )}
            />
            {sandboxStatus.isRunning ? "Scanner Active" : "Scanner Off"}
          </div>
        )}
      </div>

      {!isShieldActive && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="size-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-400">
            The Master Shield is already inactive. Enable it first to use the sandbox.
          </p>
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* LEFT COLUMN: Timer + Controls */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          {/* Big timer display (preserved from existing) */}
          <Card
            className={cn(
              "border transition-all duration-500",
              isPaused
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-border bg-card"
            )}
          >
            <CardContent className="flex flex-col items-center gap-5 py-7">
              {/* Circular timer */}
              <div className="relative">
                <svg width="160" height="160" className="-rotate-90">
                  <circle cx="80" cy="80" r="64" fill="none" stroke="oklch(0.2 0.012 264)" strokeWidth="8" />
                  <circle
                    cx="80" cy="80" r="64"
                    fill="none"
                    stroke={ringColor}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 64}
                    strokeDashoffset={2 * Math.PI * 64 * (1 - pct / 100)}
                    style={{
                      filter: isPaused ? `drop-shadow(0 0 6px ${ringColor})` : "none",
                      transition: "stroke-dashoffset 1s linear, stroke 0.5s ease",
                    }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  {isPaused ? (
                    <>
                      <span className="text-3xl font-bold tabular-nums text-foreground font-mono">
                        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
                      </span>
                      <span className="text-xs text-amber-400 font-semibold tracking-widest uppercase mt-1">
                        Bypass Active
                      </span>
                    </>
                  ) : (
                    <>
                      <FlaskConical className="size-8 text-muted-foreground mb-1" />
                      <span className="text-xs text-muted-foreground">Ready</span>
                    </>
                  )}
                </div>
              </div>

              {/* Duration selector */}
              <div className="flex gap-2 w-full">
                {DURATIONS.map((d) => (
                  <button
                    key={d.label}
                    onClick={() => !isPaused && setSelectedDuration(d)}
                    disabled={isPaused}
                    className={cn(
                      "flex-1 rounded-md border py-2 text-xs font-medium transition-all",
                      selectedDuration.label === d.label
                        ? "border-neon-emerald/40 bg-neon-emerald/10 text-neon-emerald"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                      isPaused && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 w-full">
                {!isPaused ? (
                  <Button
                    className="flex-1 gap-2 bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 hover:text-amber-300"
                    variant="ghost"
                    onClick={startPause}
                    disabled={!isShieldActive}
                  >
                    <Play className="size-4" />
                    Pause Shield
                  </Button>
                ) : (
                  <Button
                    className="flex-1 gap-2 bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20"
                    variant="ghost"
                    onClick={stopPause}
                  >
                    <Square className="size-4" />
                    Restore Shield
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="border-border hover:bg-accent"
                  onClick={() => { setTimeLeft(selectedDuration.seconds); setIsPaused(false); setLogLines([]) }}
                  disabled={isPaused}
                >
                  <RotateCcw className="size-4" />
                </Button>
              </div>

              {isPaused && (
                <div className="w-full">
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1.5">
                    <span>Time elapsed</span>
                    <span>{Math.round(pct)}%</span>
                  </div>
                  <Progress value={pct} className="h-1" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Groq API key */}
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border py-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-medium text-foreground flex items-center gap-2">
                  <Key className="size-3.5 text-muted-foreground" />
                  AI Download Estimation
                </CardTitle>
                {!showGroqInput && (
                  <Badge
                    variant={sandboxStatus?.hasGroqKey ? "default" : "outline"}
                    className={cn(
                      "text-[9px] px-2 py-0.5",
                      sandboxStatus?.hasGroqKey
                        ? "bg-neon-emerald/10 text-neon-emerald border-neon-emerald/20"
                        : "text-muted-foreground border-border"
                    )}
                  >
                    {sandboxStatus?.hasGroqKey ? "Groq Ready" : "Local Only"}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-3">
              {showGroqInput ? (
                <div className="flex gap-2">
                  <Input
                    placeholder="gsk_..."
                    value={groqKeyInput}
                    onChange={(e) => setGroqKeyInput(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                  <Button size="sm" className="h-8 text-xs" onClick={setGroqKey}>
                    Save
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {sandboxStatus?.hasGroqKey
                      ? "Groq AI is configured for intelligent download estimation."
                      : "Using local estimation. Connect Groq for AI-powered predictions based on command analysis."}
                  </p>
                  {!sandboxStatus?.hasGroqKey && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] w-full border-dashed"
                      onClick={() => setShowGroqInput(true)}
                    >
                      <Key className="size-3 mr-1" />
                      Configure Groq API Key
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Scanner controls */}
          <div
            className={cn(
              "flex items-center gap-3 rounded-lg border px-4 py-3 transition-all duration-300",
              isPaused
                ? "border-amber-500/30 bg-amber-500/5"
                : isShieldActive
                  ? "border-neon-emerald/20 bg-neon-emerald/5"
                  : "border-border bg-card"
            )}
          >
            {isPaused ? (
              <Clock className="size-4 text-amber-400 shrink-0" />
            ) : (
              <CheckCircle2 className={cn("size-4 shrink-0", isShieldActive ? "text-neon-emerald" : "text-muted-foreground")} />
            )}
            <div className="flex-1 min-w-0">
              <p className={cn("text-xs font-medium", isPaused ? "text-amber-400" : isShieldActive ? "text-neon-emerald" : "text-muted-foreground")}>
                {isPaused ? `Shield paused — ${minutes}m ${seconds}s remaining` : isShieldActive ? "Shield active — scanner running" : "Shield inactive"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {isScanning
                  ? `Watching for developer commands...`
                  : "Scanner not running"}
              </p>
            </div>
            <div className="flex gap-1">
              <Scan className={cn("size-3.5", isScanning ? "text-neon-emerald animate-pulse" : "text-muted-foreground")} />
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* MIDDLE + RIGHT: Detected operations + Log                       */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          {/* Operations header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-foreground">Detected Operations</h2>
              <Badge variant="outline" className="text-[9px] border-border text-muted-foreground">
                {operations.length}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] border-border"
                onClick={clearOperations}
                disabled={operations.length === 0}
              >
                <Trash2 className="size-3 mr-1" />
                Clear
              </Button>
            </div>
          </div>

          {/* Operations feed */}
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 scrollbar-thin">
            {operations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 rounded-lg border border-dashed border-border">
                <Scan className="size-8 text-muted-foreground/30 mb-3" />
                <p className="text-xs text-muted-foreground/60">No operations detected yet</p>
                <p className="text-[10px] text-muted-foreground/40 mt-1">
                  {isPaused
                    ? "Run npm install, docker pull, git clone, or similar commands while the shield is paused"
                    : "Pause the shield above to start monitoring"}
                </p>
              </div>
            ) : (
              operations.map((op) => {
                const Icon = ICON_MAP[op.commandType.icon] || Terminal
                const isEstimated = op.status === "estimated"
                const colorClass = getColorClass(op.commandType.label)
                const isOverlayOpen = overlayWindows.has(op.id)

                return (
                  <div
                    key={op.id}
                    className={cn(
                      "group rounded-lg border transition-all duration-300",
                      isEstimated
                        ? "border-neon-emerald/10 bg-card hover:border-neon-emerald/20"
                        : "border-border bg-card/50 hover:border-amber-500/20"
                    )}
                  >
                    <div className="p-3 space-y-2">
                      {/* Top row: icon, name, status */}
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-lg border transition-all",
                            isEstimated
                              ? "border-neon-emerald/20 bg-neon-emerald/5"
                              : "border-amber-500/20 bg-amber-500/5"
                          )}
                        >
                          <Icon
                            className={cn(
                              "size-4",
                              isEstimated ? "text-neon-emerald" : "text-amber-400"
                            )}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium text-foreground truncate">
                              {op.commandType.label}
                            </p>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wider",
                                isEstimated
                                  ? "bg-neon-emerald/10 text-neon-emerald border border-neon-emerald/20"
                                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              )}
                            >
                              <span className={cn("size-1 rounded-full", isEstimated ? "bg-neon-emerald" : "bg-amber-400 animate-pulse")} />
                              {isEstimated ? "Estimated" : "Detecting"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[9px] font-mono text-muted-foreground">
                              PID {op.pid}
                            </span>
                            <span className="text-[9px] text-muted-foreground/40">·</span>
                            <span className="text-[9px] font-mono text-muted-foreground truncate">
                              {op.executable}
                            </span>
                            <span className="text-[9px] text-muted-foreground/40">·</span>
                            <span className="text-[9px] text-muted-foreground">{op.detectedAt}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 hover:bg-neon-emerald/10 hover:text-neon-emerald opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => openOverlay(op.id)}
                                  disabled={isOverlayOpen}
                                >
                                  <ArrowUpRight className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="text-[10px]">
                                {isOverlayOpen ? "Overlay already open" : "Open overlay window"}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>

                      {/* Download estimate */}
                      {isEstimated && op.estimatedMb > 0 && (
                        <div className="ml-12 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
                              Estimated Download
                            </span>
                            <span className="text-sm font-bold text-neon-emerald tabular-nums">
                              {op.estimatedMb.toFixed(1)} MB
                            </span>
                          </div>
                          {/* Range bar */}
                          <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-neon-emerald to-neon-cyan transition-all duration-500"
                              style={{
                                width: `${Math.min(
                                  ((op.estimatedMb - op.estimatedRangeMinMb) /
                                    Math.max(op.estimatedRangeMaxMb - op.estimatedRangeMinMb, 1)) *
                                    100,
                                  100
                                )}%`,
                              }}
                            />
                          </div>
                          <div className="flex justify-between text-[8px] text-muted-foreground/60">
                            <span>{op.estimatedRangeMinMb.toFixed(0)} MB min</span>
                            <span>{op.estimatedRangeMaxMb.toFixed(0)} MB max</span>
                          </div>
                          {/* Confidence + AI reasoning */}
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-neon-emerald transition-all duration-500"
                                style={{ width: `${op.confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-[9px] font-mono text-muted-foreground">
                              {Math.round(op.confidence * 100)}%
                            </span>
                          </div>
                          {op.aiReasoning && (
                            <div className="flex items-start gap-1.5 rounded-md bg-muted/30 border border-border p-2">
                              <Info className="size-3 text-muted-foreground shrink-0 mt-0.5" />
                              <p className="text-[9px] leading-relaxed text-muted-foreground italic">
                                {op.aiReasoning}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Not yet estimated */}
                      {!isEstimated && (
                        <div className="ml-12 flex items-center gap-2">
                          <Loader2 className="size-3 text-amber-400 animate-spin" />
                          <span className="text-[9px] text-muted-foreground">
                            Estimating download size...
                          </span>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="ml-12 flex items-center gap-2 pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[9px] gap-1 hover:bg-neon-emerald/10 hover:text-neon-emerald"
                          onClick={() => openOverlay(op.id)}
                          disabled={isOverlayOpen}
                        >
                          <ExternalLink className="size-3" />
                          {isOverlayOpen ? "Overlay Open" : "Open Overlay"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={operationsEndRef} />
          </div>

          <Separator className="bg-border" />

          {/* Terminal log */}
          <Card className="border-border bg-card overflow-hidden">
            <CardHeader className="border-b border-border py-2 px-4">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="size-2 rounded-full bg-destructive/60" />
                  <div className="size-2 rounded-full bg-amber-400/60" />
                  <div className="size-2 rounded-full bg-neon-emerald/60" />
                </div>
                <span className="text-[10px] text-muted-foreground font-mono tracking-wider">
                  sandbox.log — event stream
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div
                ref={logRef}
                className="h-40 overflow-auto bg-background/80 p-4 font-mono text-xs"
              >
                {logLines.length === 0 ? (
                  <span className="text-muted-foreground/40">
                    {">"} Awaiting sandbox activation...
                  </span>
                ) : (
                  logLines.map((line, i) => (
                    <div key={i} className="flex gap-2 mb-1">
                      <span className="text-muted-foreground/40 shrink-0">{">"}</span>
                      <span
                        className={cn(
                          "transition-colors",
                          line.includes("ACTIVE") || line.includes("started")
                            ? "text-amber-400"
                            : line.includes("restored") || line.includes("re-applied") || line.includes("auto-restored")
                              ? "text-neon-emerald"
                              : line.includes("Estimate") || line.includes("AI")
                                ? "text-neon-cyan"
                                : line.includes("Detected")
                                  ? "text-amber-300"
                                  : "text-muted-foreground"
                        )}
                      >
                        {line}
                      </span>
                    </div>
                  ))
                )}
                {(isPaused || isScanning) && (
                  <span className="text-neon-emerald/60 animate-pulse">_</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
