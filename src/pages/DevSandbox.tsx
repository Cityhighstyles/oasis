import { useState, useEffect, useRef, useCallback } from "react"
import {
  FlaskConical,
  Play,
  Square,
  Terminal,
  Package,
  Container,
  Puzzle,
  FileCode,
  Cog,
  Folder,
  Download,
  Bot,
  HardHat,
  Globe,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Trash2,
  Scan,
  Loader2,
  Info,
  Lock,
  PlayCircle,
  Leaf,
  Sprout,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { toast } from "sonner"

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
  puzzle: Puzzle,
  snake: FileCode,
  crab: Cog,
  download: Download,
  bot: Bot,
  "hard-hat": HardHat,
  beer: Package,
  linux: Terminal,
  dotnet: Terminal,
  globe: Globe,
  terminal: Terminal,
}

// Color map removed — icons and status badges provide sufficient visual cues.
// See COMMAND_COLORS in git history if per-label colors are needed later.

// ══════════════════════════════════════════════════════════════════════════════
// Duration options
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

  // ── Timer state ───────────────────────────────
  const [selectedDuration, setSelectedDuration] = useState(DURATIONS[0])
  const [isPaused, setIsPaused] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const [logLines, setLogLines] = useState<string[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Sandbox scanner state ───────────────────────────────────────────────
  const [operations, setOperations] = useState<DetectedOperation[]>([])
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null)
  // Groq API key is loaded from .env file at startup — no manual input needed
  const [isScanning, setIsScanning] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)

  const logRef = useRef<HTMLDivElement>(null)
  const operationsContainerRef = useRef<HTMLDivElement>(null)
  const operationsEndRef = useRef<HTMLDivElement>(null)

  const totalSeconds = selectedDuration.seconds
  const pct = isPaused ? ((totalSeconds - timeLeft) / totalSeconds) * 100 : 0
  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60

  // ── Listen for sandbox events (with proper cleanup) ────────────────────
  // IMPORTANT: The cleanup MUST complete before remount, otherwise duplicate
  // listeners accumulate and cause "two children with the same key" errors.
  // We use a ref + sync initialization pattern to avoid the async race.
  const unlistenRef = useRef<UnlistenFn[]>([])

  useEffect(() => {
    const setup = async () => {
      // Unregister any stale listeners first (defensive — effect cleanup
      // should have already done this, but Strict Mode double-mount can
      // cause races if the async setup outlives the cleanup)
      for (const fn of unlistenRef.current) {
        fn()
      }
      unlistenRef.current = []

      const u1 = await listen<DetectedOperation>("sandbox-operation-detected", (event) => {
        setOperations((prev) => {
          // Dedup by ID: if this operation is already in the list, skip it.
          // This handles race conditions where both the event and the polling
          // produce the same operation simultaneously.
          if (prev.some((op) => op.id === event.payload.id)) {
            return prev
          }
          return [event.payload, ...prev]
        })
        setLogLines((prev) => [
          ...prev,
          `[${event.payload.detectedAt}] Detected: ${event.payload.commandType.label} (PID ${event.payload.pid})`,
        ])
      })
      unlistenRef.current.push(u1)

      const u2 = await listen<DetectedOperation>("sandbox-operation-updated", (event) => {
        setOperations((prev) =>
          prev.map((op) => (op.id === event.payload.id ? event.payload : op))
        )
        if (event.payload.status === "estimated") {
          setLogLines((prev) => [
            ...prev,
            `[${event.payload.detectedAt}] AI Estimate: ${event.payload.commandType.label} → ${event.payload.estimatedMb.toFixed(1)} MB`,
          ])
        } else if (event.payload.status === "killed") {
          setLogLines((prev) => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] TERMINATED: ${event.payload.commandType.label} (PID ${event.payload.pid}) by user request`,
          ])
          toast.error(`${event.payload.commandType.label} Terminated`, {
            description: `Process (PID ${event.payload.pid}) was killed.`,
          })
        }
      })
      unlistenRef.current.push(u2)
    }
    setup()

    return () => {
      // Synchronously unregister all listeners. The ref ensures we always
      // have the latest list even if setup() hasn't resolved yet.
      for (const fn of unlistenRef.current) {
        fn()
      }
      unlistenRef.current = []
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
        const msg = err instanceof Error ? err.message : String(err)
        console.error("Failed to poll sandbox status:", err)
        toast.error("Sandbox status poll failed", { description: msg })
      } finally {
        setIsLoading(false)
      }
    }

    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [])

  // ── Auto-scroll operations (on by default; pauses if user scrolls up) ────
  useEffect(() => {
    if (autoScroll) {
      const container = operationsContainerRef.current
      if (container) {
        const isNearBottom =
          container.scrollHeight - container.scrollTop - container.clientHeight < 50
        if (isNearBottom) {
          operationsEndRef.current?.scrollIntoView({ behavior: "smooth" })
        }
      }
    }
  }, [operations, autoScroll])

  // ── Handle manual scroll to pause auto-follow ───────────────────────────
  const handleOperationsScroll = useCallback(() => {
    const container = operationsContainerRef.current
    if (!container) return
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 50
    if (!isNearBottom && autoScroll) {
      setAutoScroll(false)
    }
  }, [autoScroll])

  // ── Auto-scroll log ─────────────────────────────────────────────────────
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logLines])

  // ── Timer handlers (auto-control scanner) ────────────────────────────
  const startPause = () => {
    if (!isShieldActive) return
    setIsPaused(true)
    setTimeLeft(selectedDuration.seconds)
    setLogLines((prev) => [...prev, "Pausing WFP kernel filters..."])
    setTimeout(() => setLogLines((prev) => [...prev, "Sandbox mode ACTIVE — shield suspended"]), 400)
    // Auto-start scanner if not already running
    if (!isScanning) {
      invoke("start_sandbox_scanner").then(() => {
        setIsScanning(true)
        setLogLines((prev) => [...prev, "Scanner auto-started — watching for developer commands..."])
      }).catch((err) => {
        console.error("Failed to auto-start scanner:", err)
      })
    } else {
      setTimeout(() => setLogLines((prev) => [...prev, "Process scanner already running — watching for commands..."]), 800)
    }
  }

  const stopPause = () => {
    setIsPaused(false)
    setTimeLeft(0)
    // Auto-stop scanner when shield is restored
    if (isScanning) {
      invoke("stop_sandbox_scanner").then(() => {
        setIsScanning(false)
      }).catch((err) => {
        console.error("Failed to auto-stop scanner:", err)
      })
    }
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

  // ── Toggle scanner on/off ──────────────────────────────────────────────
  const [scannerLoading, setScannerLoading] = useState(false)

  const toggleScanner = useCallback(async () => {
    if (scannerLoading) return
    setScannerLoading(true)
    try {
      if (isScanning) {
        await invoke("stop_sandbox_scanner")
        setIsScanning(false)
        setLogLines((prev) => [...prev, "Scanner stopped."])
      } else {
        await invoke("start_sandbox_scanner")
        setIsScanning(true)
        setLogLines((prev) => [...prev, "Scanner started — watching for developer commands..."])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("Failed to toggle scanner:", err)
      toast.error("Scanner toggle failed", { description: msg })
    } finally {
      setScannerLoading(false)
    }
  }, [isScanning, scannerLoading])

  // ── Sandbox actions (Memoized with useCallback) ────────────────────────
  const clearOperations = useCallback(async () => {
    try {
      await invoke("clear_sandbox_operations")
      setOperations([])
      setLogLines((prev) => [...prev, "Operation history cleared."])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("Failed to clear operations:", err)
      toast.error("Failed to clear operations", { description: msg })
    }
  }, [])

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

          {/* AI Download Estimation status */}
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border py-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-medium text-foreground">
                  AI Download Estimation
                </CardTitle>
                <Badge
                  variant={sandboxStatus?.hasGroqKey ? "default" : "outline"}
                  className={cn(
                    "text-[9px] px-2 py-0.5",
                    sandboxStatus?.hasGroqKey
                      ? "bg-neon-emerald/10 text-neon-emerald border-neon-emerald/20"
                      : "text-muted-foreground border-border"
                  )}
                >
                  {sandboxStatus?.hasGroqKey ? "Groq AI" : "Local Only"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {sandboxStatus?.hasGroqKey
                  ? "Groq AI is configured via GROQ_API_KEY for intelligent download estimation."
                  : "Using local estimation. Set GROQ_API_KEY in .env for AI-powered predictions."}
              </p>
            </CardContent>
          </Card>

          {/* Scanner controls */}
          <div
            className={cn(
              "flex items-center gap-3 rounded-lg border px-4 py-3 transition-all duration-300",
              isScanning
                ? "border-neon-emerald/20 bg-neon-emerald/5"
                : "border-border bg-card"
            )}
          >
            {isScanning ? (
              <Scan className="size-4 text-neon-emerald shrink-0 animate-pulse" />
            ) : (
              <CheckCircle2 className="size-4 text-muted-foreground shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className={cn("text-xs font-medium", isScanning ? "text-neon-emerald" : "text-muted-foreground")}>
                {isScanning ? "Scanner Active" : "Scanner Off"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {isScanning
                  ? `Watching for developer commands`
                  : isShieldActive && !isPaused
                    ? "Start scanner to detect operations"
                    : isPaused
                      ? "Scanner paused — resume shield"
                      : "Enable shield to use scanner"}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[9px] text-muted-foreground">Detected</p>
              <p className={cn("text-xs font-bold tabular-nums", isScanning ? "text-neon-emerald" : "text-muted-foreground")}>
                {operations.length}
              </p>
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
                variant={autoScroll ? "default" : "outline"}
                size="sm"
                className={cn(
                  "h-7 text-[10px] border-border",
                  autoScroll
                    ? "bg-neon-emerald/20 text-neon-emerald border-neon-emerald/30 hover:bg-neon-emerald/30"
                    : ""
                )}
                onClick={() => {
                  setAutoScroll(!autoScroll)
                  if (!autoScroll) {
                    setTimeout(
                      () => operationsEndRef.current?.scrollIntoView({ behavior: "smooth" }),
                      0
                    )
                  }
                }}
              >
                <Lock className={cn("size-3 mr-1", autoScroll ? "" : "opacity-50")} />
                {autoScroll ? "Auto-Scroll On" : "Auto-Scroll Off"}
              </Button>
              {/* Scanner toggle */}
              <Button
                variant={isScanning ? "default" : "outline"}
                size="sm"
                className={cn(
                  "h-7 text-[10px] border-border",
                  isScanning
                    ? "bg-neon-emerald/20 text-neon-emerald border-neon-emerald/30 hover:bg-neon-emerald/30"
                    : "text-muted-foreground"
                )}
                onClick={toggleScanner}
                disabled={scannerLoading}
              >
                {scannerLoading ? (
                  <><Loader2 className="size-3 mr-1 animate-spin" /></>
                ) : isScanning ? (
                  <><Square className="size-3 mr-1" /> Stop Scanner</>
                ) : (
                  <><PlayCircle className="size-3 mr-1" /> Start Scanner</>
                )}
              </Button>
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
          <div 
            ref={operationsContainerRef}
            onScroll={handleOperationsScroll}
            className="space-y-2 max-h-[400px] overflow-y-auto pr-1 scrollbar-thin"
          >
            {isLoading ? (
              // Loading skeleton — prevents empty flash while backend responds
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="rounded-lg border border-border bg-card/50 p-3 animate-pulse">
                    <div className="flex items-start gap-3">
                      <div className="size-9 rounded-lg bg-muted shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-24 rounded bg-muted" />
                        <div className="h-2 w-48 rounded bg-muted/60" />
                        <div className="h-2 w-32 rounded bg-muted/40" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : operations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 rounded-lg border border-dashed border-border">
                <Scan className="size-8 text-muted-foreground/30 mb-3" />
                <p className="text-xs text-muted-foreground/60">No operations detected yet</p>
                <p className="text-[10px] text-muted-foreground/40 mt-1">
                  {isPaused
                    ? "Run npm install, docker pull, or similar commands while the shield is paused"
                    : "Pause the shield above to start monitoring"}
                </p>
              </div>
            ) : (
              operations.map((op) => {
                const Icon = ICON_MAP[op.commandType.icon] || Terminal
                const isEstimated = op.status === "estimated"
                const isKilled = op.status === "killed"
                const hasPackage = op.packageName && op.packageName.length > 0
                const hasWorkingDir = op.workingDir && op.workingDir.length > 0

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
                                  : isKilled
                                    ? "bg-destructive/10 text-destructive border border-destructive/20"
                                    : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              )}
                            >
                              <span
                                className={cn(
                                  "size-1 rounded-full",
                                  isEstimated
                                    ? "bg-neon-emerald"
                                    : isKilled
                                      ? "bg-destructive"
                                      : "bg-amber-400 animate-pulse"
                                )}
                              />
                              {isEstimated ? "Estimated" : isKilled ? "Terminated" : "Detecting"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[9px] font-mono text-muted-foreground">
                              PID {op.pid}
                            </span>
                            <span className="text-[9px] text-muted-foreground/40">·</span>
                            <span className="text-[9px] font-mono text-muted-foreground truncate max-w-[120px]">
                              {op.executable}
                            </span>
                            <span className="text-[9px] text-muted-foreground/40">·</span>
                            <span className="text-[9px] text-muted-foreground">{op.detectedAt}</span>
                            {hasPackage && (
                              <>
                                <span className="text-[9px] text-muted-foreground/40">·</span>
                                <span className="text-[9px] font-mono text-muted-foreground truncate max-w-[100px]">
                                  <Package className="size-2.5 inline mr-0.5 -mt-0.5" />
                                  {op.packageName}
                                </span>
                              </>
                            )}
                          </div>
                          {hasWorkingDir && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-[8px] font-mono text-muted-foreground/40 truncate max-w-full" title={op.workingDir}>
                                <Folder className="size-2.5 inline mr-0.5 -mt-0.5" />
                                {op.workingDir}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Carbon estimate */}
                      {isEstimated && op.estimatedMb > 0 && (
                        <div className="ml-12 flex items-center gap-3 mb-2">
                          <div className="flex items-center gap-1.5 rounded-full border border-neon-emerald/20 bg-neon-emerald/5 px-2.5 py-1">
                            <Leaf className="size-3 text-neon-emerald" />
                            <span className="text-[9px] text-neon-emerald font-medium">
                              ~{(op.estimatedMb * 0.03).toFixed(2)}g CO₂
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[8px] text-muted-foreground/60">
                            <Sprout className="size-2.5" />
                            <span>
                              ≈{((op.estimatedMb * 0.03) / 21000).toFixed(5)} trees/year
                            </span>
                          </div>
                        </div>
                      )}

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

                      {/* Not yet estimated and not killed */}
                      {!isEstimated && !isKilled && (
                        <div className="ml-12 flex items-center gap-2">
                          <Loader2 className="size-3 text-amber-400 animate-spin" />
                          <span className="text-[9px] text-muted-foreground">
                            Estimating download size...
                          </span>
                        </div>
                      )}

                      {/* Killed indicator */}
                      {isKilled && (
                        <div className="ml-12 flex items-center gap-2">
                          <AlertTriangle className="size-3 text-destructive" />
                          <span className="text-[9px] text-destructive font-medium">
                            Process terminated by user request.
                          </span>
                        </div>
                      )}

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
                  <div className="flex items-center gap-2">
                    <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" />
                    <span className="text-muted-foreground/40">
                      Awaiting sandbox activation...
                    </span>
                  </div>
                ) : (
                  logLines.map((line, i) => (
                    <div key={i} className="flex gap-2 mb-1">
                      <ChevronRight className="size-3 text-muted-foreground/40 shrink-0 mt-0.5" />
                      <span
                        className={cn(
                          "transition-colors",
                          line.includes("ACTIVE") || line.includes("started")
                            ? "text-amber-400"
                            : line.includes("TERMINATED")
                              ? "text-destructive font-bold"
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