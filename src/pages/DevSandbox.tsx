import { useState, useEffect, useRef } from "react"
import {
  FlaskConical,
  Play,
  Square,
  Clock,
  Terminal,
  Package,
  Container,
  Globe,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

const DURATIONS = [
  { label: "15 min", seconds: 15 * 60 },
  { label: "30 min", seconds: 30 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
]

const PRESET_TASKS = [
  { icon: Package, label: "npm install", description: "Node.js package installation", data: "~50 MB", command: "npm install" },
  { icon: Container, label: "docker pull", description: "Pull container images", data: "~200 MB", command: "docker pull ubuntu" },
  { icon: Globe, label: "pip install", description: "Python package installation", data: "~30 MB", command: "pip install -r requirements.txt" },
  { icon: Terminal, label: "Custom bypass", description: "Full internet access bypass", data: "unlimited", command: "" },
]

const LOG_MESSAGES = [
  "Pausing WFP kernel filters...",
  "Removing netsh advfirewall rules...",
  "Disabling outbound block policies...",
  "Sandbox mode ACTIVE — shield suspended",
  "Timer started — auto-restore scheduled",
]

export function DevSandbox() {
  const { isShieldActive } = useShield()
  const [selectedDuration, setSelectedDuration] = useState(DURATIONS[0])
  const [selectedTask, setSelectedTask] = useState(PRESET_TASKS[0])
  const [isPaused, setIsPaused] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const [logLines, setLogLines] = useState<string[]>([])
  const [logIndex, setLogIndex] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const totalSeconds = selectedDuration.seconds
  const pct = isPaused ? ((totalSeconds - timeLeft) / totalSeconds) * 100 : 0

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60

  const startPause = () => {
    if (!isShieldActive) return
    setIsPaused(true)
    setTimeLeft(selectedDuration.seconds)
    setLogLines([])
    setLogIndex(0)
  }

  const stopPause = () => {
    setIsPaused(false)
    setTimeLeft(0)
    setLogLines((prev) => [...prev, "Shield restored — all rules re-applied."])
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  // Countdown
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

  // Fake log output when pause starts
  useEffect(() => {
    if (!isPaused) return
    if (logIndex >= LOG_MESSAGES.length) return
    const t = setTimeout(() => {
      setLogLines((prev) => [...prev, LOG_MESSAGES[logIndex]])
      setLogIndex((i) => i + 1)
    }, logIndex * 400)
    return () => clearTimeout(t)
  }, [isPaused, logIndex])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logLines])

  const ringColor = timeLeft > 300 ? "#10b981" : timeLeft > 60 ? "#f59e0b" : "#ef4444"

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Developer Sandbox
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Temporarily suspend the Data Shield for development operations
        </p>
      </div>

      {!isShieldActive && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="size-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-400">
            The Master Shield is already inactive. Enable it first to use the sandbox.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Timer control */}
        <div className="space-y-4">
          {/* Big timer display */}
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
                  onClick={() => { setTimeLeft(selectedDuration.seconds); setIsPaused(false); setLogLines([]); setLogIndex(0) }}
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
                  <Progress
                    value={pct}
                    className="h-1"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status indicator */}
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
                {isPaused ? `Shield paused — ${minutes}m ${seconds}s remaining` : isShieldActive ? "Shield active — ready to pause" : "Shield inactive"}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Presets + log */}
        <div className="space-y-4">
          {/* Task presets */}
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border py-3 px-5">
              <CardTitle className="text-sm font-medium">Operation Presets</CardTitle>
              <CardDescription className="text-xs">
                Select the operation you're about to run
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {PRESET_TASKS.map((task) => {
                const Icon = task.icon
                const isSelected = selectedTask.label === task.label
                return (
                  <button
                    key={task.label}
                    onClick={() => setSelectedTask(task)}
                    className={cn(
                      "flex w-full items-center gap-3 px-5 py-3 text-left transition-colors",
                      isSelected
                        ? "bg-neon-emerald/5"
                        : "hover:bg-accent/30"
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg border transition-all",
                        isSelected
                          ? "border-neon-emerald/30 bg-neon-emerald/10"
                          : "border-border bg-muted/40"
                      )}
                    >
                      <Icon className={cn("size-3.5", isSelected ? "text-neon-emerald" : "text-muted-foreground")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-xs font-medium", isSelected ? "text-neon-emerald" : "text-foreground")}>
                        {task.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">{task.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                        {task.data}
                      </Badge>
                    </div>
                    {isSelected && <ChevronRight className="size-3 text-neon-emerald shrink-0" />}
                  </button>
                )
              })}
            </CardContent>
          </Card>

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
                  guardian.sys — kernel log
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
                              : "text-muted-foreground"
                        )}
                      >
                        {line}
                      </span>
                    </div>
                  ))
                )}
                {isPaused && (
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
