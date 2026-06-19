import { useState, useEffect } from "react"
import { Search, RefreshCw, ChevronUp, ChevronDown, Shield, ShieldOff } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useShield, type ProcessStatus, type ProcessEntry } from "@/context/ShieldContext"
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

export function LiveMonitor() {
  const { isShieldActive, processes, blockApp, unblockApp, refreshProcesses, wfpAvailable } = useShield()
  const [loading, setLoading] = useState<boolean>(true)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortKey>("sessionData")
  const [sortOrder, setSortOrder] = useState<SortDir>("desc")
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const handleToggleBlock = async (proc: ProcessEntry) => {
    setActionInProgress(proc.exe)
    try {
      if (proc.status === "blocked") {
        await unblockApp(proc.exe)
      } else {
        await blockApp(proc.exe)
      }
    } finally {
      setActionInProgress(null)
    }
  }

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

  const filtered = processes
    .filter((p) => {
      return (
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.exe.toLowerCase().includes(search.toLowerCase())
      )
    })
    .sort((a, b) => {
      let cmp = 0
      if (sortField === "name") cmp = a.name.localeCompare(b.name)
      else if (sortField === "status") cmp = a.status.localeCompare(b.status)
      else if (sortField === "sessionData") cmp = a.sessionData - b.sessionData
      else if (sortField === "connections") cmp = a.connections - b.connections
      return sortOrder === "asc" ? cmp : -cmp
    })

  const blocked = processes.filter((p) => p.status === "blocked").length
  const active = processes.filter((p) => p.status === "active").length

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
            Real-time view of processes and network activity
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 font-mono">
          <div className="size-1.5 rounded-full bg-neon-emerald animate-pulse" />
          LIVE
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Processes", value: processes.length, color: "text-foreground" },
          { label: "Blocked", value: blocked, color: "text-destructive" },
          { label: "Active", value: active, color: "text-neon-emerald" },
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
              <span className={cn("size-1.5 rounded-full", isShieldActive ? "bg-neon-emerald" : "bg-muted-foreground")} />
              {isShieldActive ? "Shield Active" : "Shield Off"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_80px] gap-0 border-b border-border bg-muted/20 px-5 py-2">
            {(
              [
                { key: "name" as SortKey, label: "Process" },
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

          {/* Rows */}
          <div className="divide-y divide-border font-mono text-xs">
            {filtered.map((proc) => {
              const s = STATUS_CONFIG[proc.status]
              const isBlocked = proc.status === "blocked"
              const isOperating = actionInProgress === proc.exe
              return (                  <div
                    key={proc.pid}
                    className={cn(
                      "grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_80px] gap-0 px-5 py-3 transition-colors",
                      s.row
                    )}
                  >
                  {/* Process name */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        s.dot,
                        proc.status === "active" && "animate-pulse"
                      )}
                    />
                    <div className="min-w-0">
                      <span className="text-foreground font-medium truncate block">
                        {proc.name}
                      </span>
                      <span className="text-muted-foreground/50 text-[10px]">
                        PID {proc.pid}
                      </span>
                    </div>
                  </div>

                  {/* Exe */}
                  <span className="text-muted-foreground self-center truncate pr-2">
                    {proc.exe}
                  </span>

                  {/* Status */}
                  <div className="self-center">
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] px-1.5 h-4 tracking-wider", s.badge)}
                    >
                      {s.label}
                    </Badge>
                  </div>

                  {/* Session data usage */}
                  <span
                    className={cn(
                      "self-center tabular-nums font-medium",
                      proc.sessionData > 0 ? "text-foreground" : "text-muted-foreground/40"
                    )}
                  >
                    {proc.sessionData > 0 ? `${proc.sessionData} MB` : "—"}
                  </span>

                  {/* Last active */}
                  <span
                    className={cn(
                      "self-center",
                      proc.lastSeen === "now"
                        ? "text-neon-emerald"
                        : "text-muted-foreground/50"
                    )}
                  >
                    {proc.lastSeen}
                  </span>

                  {/* Action button */}
                  <div className="self-center flex justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-6 w-6 p-0",
                        isBlocked
                          ? "text-neon-emerald hover:text-neon-emerald hover:bg-neon-emerald/10"
                          : "text-destructive hover:text-destructive hover:bg-destructive/10"
                      )}
                      onClick={() => handleToggleBlock(proc)}
                      disabled={!wfpAvailable || isOperating}
                      title={isBlocked ? "Unblock this process" : "Block this process"}
                    >
                      {isOperating ? (
                        <RefreshCw className="size-3 animate-spin" />
                      ) : isBlocked ? (
                        <ShieldOff className="size-3" />
                      ) : (
                        <Shield className="size-3" />
                      )}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          {filtered.length === 0 && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              No processes match your filter
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
