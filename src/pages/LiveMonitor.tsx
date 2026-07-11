import { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from "react"
import {
  Search,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  PauseCircle,
  PlayCircle,
  Trash2,
  ArrowDownWideNarrow,
  ArrowDownAZ,
} from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useShield, type ProcessStatus, type ProcessEntry, type TotalThroughput } from "@/context/ShieldContext"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

const STATUS_CONFIG: Record<
  ProcessStatus,
  { label: string; dot: string; badge: string; row: string }
> = {
  blocked: {
    label: "BLOCKED",
    dot: "bg-destructive",
    badge: "border-destructive/40 text-destructive bg-destructive/5",
    row: "hover:bg-destructive/5",
  },
  active: {
    label: "ACTIVE",
    dot: "bg-neon-emerald",
    badge: "border-neon-emerald/30 text-neon-emerald bg-neon-emerald/5",
    row: "hover:bg-neon-emerald/5",
  },
  monitoring: {
    label: "MONITOR",
    dot: "bg-neon-cyan",
    badge: "border-neon-cyan/30 text-neon-cyan bg-neon-cyan/5",
    row: "hover:bg-neon-cyan/5",
  },
}

type SortKey = "name" | "status" | "sessionData" | "connections"
type SortDir = "asc" | "desc"

type ProcessGroup = {
  key: string
  exe: string
  name: string
  processes: ProcessEntry[]
  totalSessionData: number
  totalConnections: number
  pidCount: number
  status: ProcessStatus
  lastSeen: string
}

function groupProcesses(entries: ProcessEntry[]): ProcessGroup[] {
  const map = new Map<string, ProcessGroup>()

  for (const proc of entries) {
    const key = proc.exe.toLowerCase()
    const existing = map.get(key)

    if (existing) {
      existing.processes.push(proc)
      existing.totalSessionData += proc.sessionData
      existing.totalConnections += proc.connections
      existing.pidCount++
      // Status priority: blocked > active > monitoring
      if (proc.status === "blocked") {
        existing.status = "blocked"
      } else if (proc.status === "active" && existing.status !== "blocked") {
        existing.status = "active"
      }
      if (proc.lastSeen === "now") {
        existing.lastSeen = "now"
      }
    } else {
      map.set(key, {
        key,
        exe: proc.exe,
        name: proc.name,
        processes: [proc],
        totalSessionData: proc.sessionData,
        totalConnections: proc.connections,
        pidCount: 1,
        status: proc.status,
        lastSeen: proc.lastSeen,
      })
    }
  }

  return Array.from(map.values())
}

type StatusBadgeProps = {
  status: ProcessStatus
  className?: string
}

function StatusBadge({ status, className }: StatusBadgeProps) {
  const s = STATUS_CONFIG[status]
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] px-1.5 h-4 tracking-wider", s.badge, className)}
    >
      {s.label}
    </Badge>
  )
}

// ──────────────────── filter / system service helpers ────────────────

type FilterPreset = "all" | "active" | "system" | "paused"

function getExeName(path: string): string {
  return path.split(/[/\\]/).pop()?.toLowerCase() ?? ""
}

/// Executable names of known background data-hogging system services.
const SYSTEM_SERVICE_EXES = new Set([
  "svchost.exe",
  "wuauserv.exe",
  "msmpeng.exe",
  "onedrive.exe",
  "backgroundtransferhost.exe",
  "tiworker.exe",
  "trustedinstaller.exe",
  "sppsvc.exe",
  "deliveryoptimization.exe",
  "dosvc.exe",
  "mohelper.exe",
  "searchindexer.exe",
  "wermgr.exe",
  "dllhost.exe",
  "taskhostw.exe",
  "runtimebroker.exe",
  "sihost.exe",
  "startmenuexperiencehost.exe",
])

// ──────────────────────────── speed helpers ──────────────────────────

type SpeedTrend = "stable" | "rising" | "spiking"

function computeTrend(history: number[]): SpeedTrend {
  if (history.length < 3) return "stable"
  const latest = history[history.length - 1]
  if (latest <= 0) return "stable"
  const prevAvg = history.slice(0, -1).reduce((s, v) => s + v, 0) / (history.length - 1)
  if (prevAvg <= 0) return latest > 0 ? "rising" : "stable"
  const ratio = latest / prevAvg
  if (ratio >= 3) return "spiking"
  if (ratio >= 1.5) return "rising"
  return "stable"
}

const TREND_TEXT: Record<SpeedTrend, string> = {
  stable: "text-neon-emerald",
  rising: "text-amber-400",
  spiking: "text-destructive",
}

const TREND_BG: Record<SpeedTrend, string> = {
  stable: "bg-neon-emerald/50",
  rising: "bg-amber-400/50",
  spiking: "bg-destructive/50",
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
  } else if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
  } else if (bytesPerSecond > 0) {
    return `${bytesPerSecond.toFixed(0)} B/s`
  }
  return ""
}

function MicroSparkline({ samples, maxVal, trend = "stable" }: { samples: number[]; maxVal: number; trend?: SpeedTrend }) {
  const barCount = 6
  // Take the most recent samples, pad with 0s if fewer than barCount
  const filled = [...Array(barCount - Math.min(barCount, samples.length)).fill(0), ...samples.slice(-barCount)]

  return (
    <div className="flex items-end gap-[2px] h-3">
      {filled.map((val, i) => {
        const pct = maxVal > 0 ? Math.min(100, (val / maxVal) * 100) : 0
        return (
          <div
            key={i}
            className={cn("w-[3px] rounded-[1px] transition-all duration-300", TREND_BG[trend])}
            style={{ height: `${Math.max(pct > 0 ? 2 : 1, pct)}%`, minHeight: pct > 0 ? "2px" : "1px" }}
          />
        )
      })}
    </div>
  )
}

type ProcessRowProps = {
  proc: ProcessEntry
  isOperating: string | null
  wfpAvailable: boolean
  isSuspended: boolean
  onSuspend: (pid: number) => void
  onResume: (pid: number) => void
  onKill: (pid: number, name: string) => void
  onDropdownOpenChange: (open: boolean) => void
  speedTrend: SpeedTrend
  isLocked: boolean
}

function PidSubRow({ proc, isOperating, wfpAvailable, isSuspended, onSuspend, onResume, onKill, onDropdownOpenChange, speedTrend, isLocked }: ProcessRowProps) {
  const s = STATUS_CONFIG[proc.status]
  const isOperatingNow = isOperating === proc.exe

  return (
    <div
      className={cn(
        "grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_80px] gap-0 px-5 py-2 transition-colors",
        s.row
      )}
    >
      {/* Process name — indented with PID info */}
      <div className="flex items-center gap-2 min-w-0 pl-8">
        <span
          className={cn(
            "size-1 shrink-0 rounded-full",
            isSuspended ? "bg-amber-400" : s.dot,
            proc.status === "active" && !isSuspended && "animate-pulse"
          )}
        />
        <div className="min-w-0">
          <span className="text-muted-foreground/70 text-[10px] font-mono">
            PID {proc.pid}
          </span>
          {isSuspended && (
            <span className="text-amber-400/70 text-[9px] font-mono ml-1.5">
              (suspended)
            </span>
          )}
        </div>
      </div>

      {/* Exe */}
      <span className="text-muted-foreground/40 self-center truncate text-[10px] pr-2">
        {proc.exe}
      </span>

      {/* Status */}
      <div className="self-center">
        {isSuspended ? (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 h-4 tracking-wider border-amber-500/30 text-amber-400 bg-amber-500/5"
          >
            SUSPENDED
          </Badge>
        ) : (
          <StatusBadge status={proc.status} />
        )}
      </div>

      {/* Session data usage + speed */}
      <div className="self-center">
        <span
          className={cn(
            "tabular-nums font-medium text-[11px]",
            proc.sessionData > 0 ? "text-foreground/70" : "text-muted-foreground/40"
          )}
        >
          {proc.sessionData > 0 ? `${proc.sessionData} MB` : "—"}
        </span>
        {proc.speed > 0 && (
          <span className={cn("block text-[9px] tabular-nums font-medium leading-tight mt-0.5", TREND_TEXT[speedTrend])}>
            ↑ {formatSpeed(proc.speed)}
          </span>
        )}
      </div>

      {/* Last active */}
      <span
        className={cn(
          "self-center text-[11px]",
          proc.lastSeen === "now"
            ? "text-neon-emerald/70"
            : "text-muted-foreground/40"
        )}
      >
        {proc.lastSeen === "now" ? "now" : proc.lastSeen}
      </span>

      {/* Action dropdown */}
      <div className="self-center flex justify-center">
        <DropdownMenu onOpenChange={(open) => onDropdownOpenChange(open)}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground hover:bg-accent/50"
              disabled={isLocked || (!wfpAvailable && !isSuspended) || isOperatingNow}
            >
              {isLocked ? (
                <RefreshCw className="size-3 animate-spin text-muted-foreground/50" />
              ) : (
                <MoreVertical className="size-3" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            {/* Suspend / Resume */}
            <DropdownMenuItem
              onClick={() => isSuspended ? onResume(proc.pid) : onSuspend(proc.pid)}
              disabled={isLocked}
              className="gap-2"
            >
              {isSuspended ? (
                <PlayCircle className="size-3.5 text-neon-emerald" />
              ) : (
                <PauseCircle className="size-3.5 text-amber-400" />
              )}
              <span>{isSuspended ? "Resume Process" : "Suspend Process"}</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Kill */}
            <DropdownMenuItem
              onClick={() => onKill(proc.pid, proc.name)}
              disabled={isLocked}
              variant="destructive"
              className="gap-2"
            >
              <Trash2 className="size-3.5" />
              <span>Kill Process</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// ──────────────────────────── main component ─────────────────────────

export function LiveMonitor() {
  const { isShieldActive, processes, refreshProcesses, wfpAvailable, suspendProcess, resumeProcess, killProcess, suspendedPids, totalThroughput } = useShield()
  const [loading, setLoading] = useState<boolean>(true)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortKey>("sessionData")
  const [sortOrder, setSortOrder] = useState<SortDir>("desc")
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [killConfirm, setKillConfirm] = useState<{ pid: number; name: string } | null>(null)
  const processingLock = useRef(false)

  // ─── Filter preset ───
  const [filterPreset, setFilterPreset] = useState<FilterPreset>("all")

  // ─── Sort freeze (prevent reordering while interacting) ───
  const frozenGroupsRef = useRef<ProcessGroup[]>([])
  const [isHovering, setIsHovering] = useState(false)
  const [dropdownOpenCount, setDropdownOpenCount] = useState(0)
  const isFrozen = isHovering || dropdownOpenCount > 0

  const handleMouseEnter = useCallback(() => setIsHovering(true), [])
  const handleMouseLeave = useCallback(() => setIsHovering(false), [])
  const handleDropdownOpenChange = useCallback((open: boolean) => {
    setDropdownOpenCount((prev) => Math.max(0, prev + (open ? 1 : -1)))
  }, [])

  // ─── Speed history for sparklines ───
  const speedHistoryRef = useRef<Map<string, number[]>>(new Map())
  const pidSpeedHistoryRef = useRef<Map<number, number[]>>(new Map())

  // ─── FLIP animation for smooth reordering ───
  const containerRef = useRef<HTMLDivElement>(null)
  const prevPositionsRef = useRef<Map<string, DOMRect>>(new Map())

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const children = Array.from(container.children) as HTMLElement[]
    const newPositions = new Map<string, DOMRect>()

    for (const child of children) {
      const key = child.getAttribute("data-group-key")
      if (!key) continue
      const rect = child.getBoundingClientRect()
      newPositions.set(key, { ...rect })

      const prevRect = prevPositionsRef.current.get(key)
      if (prevRect && !isFrozen) {
        const dx = prevRect.left - rect.left
        const dy = prevRect.top - rect.top
        if (dx !== 0 || dy !== 0) {
          child.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: "translate(0, 0)" },
            ],
            {
              duration: 350,
              easing: "cubic-bezier(0.4, 0, 0.2, 1)",
              fill: "both",
            }
          )
        }
      }
    }

    prevPositionsRef.current = newPositions
  })

  const withLock = useCallback(
    <T,>(fn: () => Promise<T>): Promise<T> | undefined => {
      if (processingLock.current) return undefined
      processingLock.current = true
      return fn().finally(() => {
        processingLock.current = false
      })
    },
    []
  )

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const handleSuspend = useCallback(async (pid: number) => {
    const result = withLock(async () => {
      setActionInProgress(`suspend:${pid}`)
      try {
        const count = await suspendProcess(pid)
        toast.success("Process suspended", {
          description: `PID ${pid} — ${count} thread${count === 1 ? "" : "s"} paused`,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error("Suspend failed", {
          description: msg,
        })
      } finally {
        setActionInProgress(null)
      }
    })
    if (result === undefined) {
      toast.info("Please wait", { description: "Another action is still in progress." })
    }
  }, [suspendProcess, withLock])

  const handleResume = useCallback(async (pid: number) => {
    const result = withLock(async () => {
      setActionInProgress(`resume:${pid}`)
      try {
        const count = await resumeProcess(pid)
        toast.success("Process resumed", {
          description: `PID ${pid} — ${count} thread${count === 1 ? "" : "s"} resumed`,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error("Resume failed", {
          description: msg,
        })
      } finally {
        setActionInProgress(null)
      }
    })
    if (result === undefined) {
      toast.info("Please wait", { description: "Another action is still in progress." })
    }
  }, [resumeProcess, withLock])

  const handleKill = useCallback(async (pid: number, name: string) => {
    // Clear modal instantly so UI doesn't visually hang open
    setKillConfirm(null)

    const result = withLock(async () => {
      setActionInProgress(`kill:${pid}`)
      try {
        await killProcess(pid)
        toast.success("Process terminated", { description: `${name} (PID ${pid}) killed.` })
      } catch (err) {
        toast.error("Termination failed", { description: String(err) })
      } finally {
        setActionInProgress(null)
      }
    })
    if (result === undefined) {
      toast.info("Please wait", { description: "Another action is still in progress." })
    }
  }, [killProcess, withLock])

  const handleGroupSuspendAll = useCallback(async (group: ProcessGroup) => {
    const result = withLock(async () => {
      setActionInProgress(`suspend-group:${group.key}`)
      let count = 0
      try {
        for (const proc of group.processes) {
          if (!suspendedPids.has(proc.pid)) {
            await suspendProcess(proc.pid)
            count++
          }
        }
        toast.success("Processes suspended", {
          description: `${group.name} — ${count} of ${group.processes.length} PIDs paused`,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error("Suspend failed", {
          description: msg,
        })
      } finally {
        setActionInProgress(null)
      }
    })
    if (result === undefined) {
      toast.info("Please wait", { description: "Another action is still in progress." })
    }
  }, [suspendProcess, suspendedPids, withLock])

  const handleGroupResumeAll = useCallback(async (group: ProcessGroup) => {
    const result = withLock(async () => {
      setActionInProgress(`resume-group:${group.key}`)
      let count = 0
      try {
        for (const proc of group.processes) {
          if (suspendedPids.has(proc.pid)) {
            await resumeProcess(proc.pid)
            count++
          }
        }
        toast.success("Processes resumed", {
          description: `${group.name} — ${count} of ${group.processes.length} PIDs resumed`,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error("Resume failed", {
          description: msg,
        })
      } finally {
        setActionInProgress(null)
      }
    })
    if (result === undefined) {
      toast.info("Please wait", { description: "Another action is still in progress." })
    }
  }, [resumeProcess, suspendedPids, withLock])

  useEffect(() => {
    setLoading(false)
  }, [])

  const handleSort = (key: SortKey) => {
    if (sortField === key) {
      setSortOrder((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(key)
      setSortOrder("asc")
    }
  }

  // Filter, group, and sort
  const { groups, blocked, active } = useMemo(() => {
    let filtered = processes

    // Apply filter preset
    if (filterPreset === "active") {
      filtered = filtered.filter((p) => p.status === "active")
    } else if (filterPreset === "system") {
      filtered = filtered.filter((p) => SYSTEM_SERVICE_EXES.has(getExeName(p.exe)))
    } else if (filterPreset === "paused") {
      filtered = filtered.filter((p) => suspendedPids.has(p.pid))
    }

    // Apply search text
    const lowerSearch = search.toLowerCase()
    if (lowerSearch) {
      filtered = filtered.filter((p) => {
        return (
          p.name.toLowerCase().includes(lowerSearch) ||
          p.exe.toLowerCase().includes(lowerSearch)
        )
      })
    }

    const grouped = groupProcesses(filtered)

    grouped.sort((a, b) => {
      let cmp = 0
      if (sortField === "name") cmp = a.name.localeCompare(b.name)
      else if (sortField === "status") cmp = a.status.localeCompare(b.status)
      else if (sortField === "sessionData") cmp = a.totalSessionData - b.totalSessionData
      else if (sortField === "connections") cmp = a.totalConnections - b.totalConnections
      // Stable tiebreakers — prevent arbitrary reordering when primary values match
      if (cmp === 0) cmp = a.name.localeCompare(b.name)
      if (cmp === 0) cmp = a.key.localeCompare(b.key)
      return sortOrder === "asc" ? cmp : -cmp
    })

    // Sort PIDs within each group by PID ascending
    for (const group of grouped) {
      group.processes.sort((a, b) => a.pid - b.pid)
    }

    // Update frozen snapshot when not interacting
    if (!isFrozen) {
      frozenGroupsRef.current = grouped
    }

    const blockedCount = processes.filter((p) => p.status === "blocked").length
    const activeCount = processes.filter((p) => p.status === "active").length

    return {
      groups: isFrozen ? frozenGroupsRef.current : grouped,
      blocked: blockedCount,
      active: activeCount,
    }
  }, [processes, search, sortField, sortOrder, filterPreset, suspendedPids, isFrozen])

  // Track speed history for sparklines (group + per-PID)
  useEffect(() => {
    const sh = speedHistoryRef.current
    const ph = pidSpeedHistoryRef.current
    for (const group of groups) {
      const totalSpeed = group.processes.reduce((s, p) => s + p.speed, 0)
      const prev = sh.get(group.key) ?? []
      sh.set(group.key, [...prev.slice(-11), totalSpeed])

      for (const proc of group.processes) {
        const pidPrev = ph.get(proc.pid) ?? []
        ph.set(proc.pid, [...pidPrev.slice(-11), proc.speed])
      }
    }
  }, [groups])

  function SortIcon({ k }: { k: SortKey }) {
    if (sortField !== k)
      return <ChevronUp className="size-3 text-muted-foreground/40" />
    return sortOrder === "asc" ? (
      <ChevronUp className="size-3 text-neon-emerald" />
    ) : (
      <ChevronDown className="size-3 text-neon-emerald" />
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Live Network Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time view of processes grouped by application
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 font-mono">
          <div className="size-1.5 rounded-full bg-neon-emerald animate-pulse" />
          LIVE
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Applications", value: groups.length, color: "text-foreground" },
          { label: "Active", value: active, color: "text-neon-emerald" },
          { label: "Blocked", value: blocked, color: "text-destructive" },
          {
            label: "Session Usage",
            value: `${processes.reduce((s, p) => s + p.sessionData, 0).toFixed(1)} MB`,
            color: "text-neon-cyan",
          },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              {label}
            </p>
            <p className={cn("text-xl font-bold tabular-nums", color)}>{value}</p>
          </div>
        ))}
        {/* NDIS Interface Throughput — Task Manager Performance tab style */}
        <div className="rounded-lg border border-neon-cyan/20 bg-neon-cyan/5 px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-neon-cyan animate-pulse" />
            Interface Throughput
          </p>
          <p className="text-lg font-bold tabular-nums text-neon-cyan">
            {totalThroughput.bytesReceivedPerSec > 0
              ? formatSpeed(totalThroughput.bytesReceivedPerSec)
              : "—"}
          </p>
          <p className="text-[9px] text-muted-foreground/50 mt-0.5">
            NDIS miniport / {formatSpeed(totalThroughput.bytesSentPerSec)} sent
          </p>
        </div>
      </div>

      {/* Table */}
      <Card className="border-border bg-card overflow-hidden">
        <CardHeader className="border-b border-border py-3 px-5">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Filter processes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 bg-background/50 text-xs border-border focus-visible:ring-ring/50"
              />
            </div>

            {/* Sort mode toggle */}
            <div className="flex items-center gap-0.5 bg-muted/60 rounded-md p-0.5 border border-border/50">
              <button
                onClick={() => {
                  setSortField("sessionData")
                  setSortOrder("desc")
                }}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-150",
                  sortField === "sessionData" && sortOrder === "desc"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground/60 hover:text-foreground"
                )}
                title="Sort by data usage (highest first)"
              >
                <ArrowDownWideNarrow className="size-3" />
                Data
              </button>
              <button
                onClick={() => {
                  setSortField("name")
                  setSortOrder("asc")
                }}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-150",
                  sortField === "name" && sortOrder === "asc"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground/60 hover:text-foreground"
                )}
                title="Sort alphabetically by name"
              >
                <ArrowDownAZ className="size-3" />
                Name
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs border-border hover:bg-accent"
              onClick={refreshProcesses}
              disabled={loading}
            >
              <RefreshCw className="size-3" />
              Refresh
            </Button>
            <Badge
              variant="outline"
              className={cn(
                "ml-auto text-[10px] gap-1.5",
                isShieldActive
                  ? "border-neon-emerald/30 text-neon-emerald"
                  : "border-border text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isShieldActive ? "bg-neon-emerald" : "bg-muted-foreground"
                )}
              />
              {isShieldActive ? "Shield Active" : "Shield Off"}
            </Badge>
          </div>

          {/* Filter preset tabs */}
          <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/40">
            {([
              { key: "all" as FilterPreset, label: "All Processes" },
              { key: "active" as FilterPreset, label: "Active" },
              { key: "system" as FilterPreset, label: "System" },
              { key: "paused" as FilterPreset, label: "Paused" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterPreset(key)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150",
                  filterPreset === key
                    ? "bg-accent text-foreground shadow-sm"
                    : "text-muted-foreground/60 hover:text-foreground hover:bg-accent/40"
                )}
              >
                {label}
              </button>
            )))}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_80px] gap-0 border-b border-border bg-muted/20 px-5 py-2">
            {(
              [
                { key: "name" as SortKey, label: "Application" },
                { key: null, label: "Executable" },
                { key: "status" as SortKey, label: "Status" },
                { key: "sessionData" as SortKey, label: "Data Usage" },
                { key: null, label: "Last Active" },
                { key: null, label: "Action" },
              ] as { key: SortKey | null; label: string }[]
            ).map(({ key, label }) => (
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

          {/* Grouped rows */}
          <div
            ref={containerRef}
            className="divide-y divide-border font-mono text-xs"
            style={{ overflowAnchor: "auto" }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {groups.map((group) => {
              const s = STATUS_CONFIG[group.status]
              const isExpanded = expandedGroups.has(group.key)
              const isOperating = actionInProgress === group.exe
              const groupAllSuspended = group.processes.every((p) =>
                suspendedPids.has(p.pid)
              )
              const isSuspendOperating =
                actionInProgress === `suspend-group:${group.key}` ||
                actionInProgress === `resume-group:${group.key}`

              const totalSpeed = group.processes.reduce((s, p) => s + p.speed, 0)
              const history = speedHistoryRef.current.get(group.key) ?? []
              const maxSpeed = Math.max(1, ...history)
              const trend = computeTrend(history)

              return (
                <Collapsible
                  key={group.key}
                  data-group-key={group.key}
                  open={isExpanded}
                  onOpenChange={() => toggleGroup(group.key)}
                >
                  {/* Group header row */}
                  <CollapsibleTrigger asChild>
                    <div
                      className={cn(
                        "grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_80px] gap-0 px-5 py-3 transition-colors cursor-pointer select-none",
                        s.row
                      )}
                    >
                      {/* Process name + PID count */}
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronRight
                          className={cn(
                            "size-3 shrink-0 text-muted-foreground/50 transition-transform duration-200",
                            isExpanded && "rotate-90"
                          )}
                        />
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            s.dot,
                            group.status === "active" && "animate-pulse"
                          )}
                        />
                        <div className="min-w-0">
                          <span className="text-foreground font-medium truncate block">
                            {group.name}
                          </span>
                          <span className="text-muted-foreground/50 text-[10px]">
                            {group.pidCount} {group.pidCount === 1 ? "PID" : "PIDs"}
                          </span>
                        </div>
                      </div>

                      {/* Exe */}
                      <span className="text-muted-foreground self-center truncate pr-2">
                        {group.exe}
                      </span>

                      {/* Status */}
                      <div className="self-center">
                        <StatusBadge status={group.status} />
                      </div>

                      {/* Session data usage (aggregate) + speed */}
                      <div className="self-center">
                        <span
                          className={cn(
                            "tabular-nums font-medium",
                            group.totalSessionData > 0
                              ? "text-foreground"
                              : "text-muted-foreground/40"
                          )}
                        >
                          {group.totalSessionData > 0
                            ? `${group.totalSessionData} MB`
                            : "—"}
                        </span>
                        {totalSpeed > 0 && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className={cn("text-[9px] tabular-nums font-medium", TREND_TEXT[trend])}>
                              ↑ {formatSpeed(totalSpeed)}
                            </span>
                            <MicroSparkline samples={history} maxVal={maxSpeed} trend={trend} />
                          </div>
                        )}
                      </div>

                      {/* Last active */}
                      <span
                        className={cn(
                          "self-center",
                          group.lastSeen === "now"
                            ? "text-neon-emerald"
                            : "text-muted-foreground/50"
                        )}
                      >
                        {group.lastSeen === "now"
                          ? "now"
                          : group.lastSeen}
                      </span>

                      {/* Action button (group-level) */}
                      <div className="self-center flex justify-center gap-1">
                        {/* Suspend / Resume all */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-6 w-6 p-0",
                            groupAllSuspended
                              ? "text-neon-emerald hover:text-neon-emerald hover:bg-neon-emerald/10"
                              : "text-amber-400 hover:text-amber-400 hover:bg-amber-400/10"
                          )}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (groupAllSuspended) {
                              handleGroupResumeAll(group)
                            } else {
                              handleGroupSuspendAll(group)
                            }
                          }}
                          disabled={isSuspendOperating}
                          title={
                            groupAllSuspended
                              ? "Resume all processes"
                              : "Suspend all processes"
                          }
                        >
                          {isSuspendOperating ? (
                            <RefreshCw className="size-3 animate-spin" />
                          ) : groupAllSuspended ? (
                            <PlayCircle className="size-3" />
                          ) : (
                            <PauseCircle className="size-3" />
                          )}
                        </Button>

          
                      </div>
                    </div>
                  </CollapsibleTrigger>

                  {/* Expanded PID sub-rows */}
                  <CollapsibleContent>
                    <div className="divide-y divide-border/50">
                      {group.processes.map((proc) => {
                        const pidHistory = pidSpeedHistoryRef.current.get(proc.pid) ?? []
                        const pidTrend = computeTrend(pidHistory)
                        return (
                          <PidSubRow
                            key={proc.pid}
                            proc={proc}
                            isOperating={actionInProgress}
                            wfpAvailable={wfpAvailable}
                            isSuspended={suspendedPids.has(proc.pid)}
                            onSuspend={handleSuspend}
                            onResume={handleResume}
                            onKill={(pid, name) => setKillConfirm({ pid, name })}
                            onDropdownOpenChange={handleDropdownOpenChange}
                            speedTrend={pidTrend}
                            isLocked={processingLock.current}
                          />
                        )
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>

          {groups.length === 0 && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              {processes.length === 0
                ? "No network activity detected"
                : "No processes match your filter"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kill confirmation dialog */}
      <AlertDialog
        open={killConfirm !== null}
        onOpenChange={(open) => !open && setKillConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kill Process</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to terminate{" "}
              <span className="font-semibold text-foreground">
                {killConfirm?.name ?? "this process"}
              </span>{" "}
              (PID {killConfirm?.pid})? This action cannot be undone. The
              process will be forcefully terminated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                killConfirm &&
                handleKill(killConfirm.pid, killConfirm.name)
              }
            >
              Kill Process
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}