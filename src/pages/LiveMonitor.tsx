import { useState, useEffect } from "react"
import { Search, RefreshCw, ChevronUp, ChevronDown } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

type ProcessStatus = "blocked" | "active" | "monitoring"

type ProcessEntry = {
  pid: number
  name: string
  exe: string
  status: ProcessStatus
  sessionData: number
  totalData: number
  connections: number
  lastSeen: string
}

const BASE_PROCESSES: ProcessEntry[] = [
  { pid: 1120, name: "Windows Update", exe: "svchost.exe", status: "blocked", sessionData: 0, totalData: 420, connections: 0, lastSeen: "14:32:01" },
  { pid: 4892, name: "Chrome", exe: "chrome.exe", status: "active", sessionData: 14.2, totalData: 88, connections: 4, lastSeen: "now" },
  { pid: 3304, name: "OneDrive", exe: "OneDrive.exe", status: "blocked", sessionData: 0, totalData: 680, connections: 0, lastSeen: "14:28:55" },
  { pid: 2288, name: "Delivery Optimization", exe: "svchost.exe", status: "blocked", sessionData: 0, totalData: 210, connections: 0, lastSeen: "14:27:03" },
  { pid: 9142, name: "Node.js", exe: "node.exe", status: "active", sessionData: 2.1, totalData: 12, connections: 2, lastSeen: "now" },
  { pid: 5580, name: "Microsoft Teams", exe: "Teams.exe", status: "blocked", sessionData: 0, totalData: 95, connections: 0, lastSeen: "14:31:48" },
  { pid: 7761, name: "Windows Defender", exe: "MsMpEng.exe", status: "monitoring", sessionData: 0.4, totalData: 8, connections: 1, lastSeen: "now" },
  { pid: 1852, name: "Dropbox", exe: "Dropbox.exe", status: "blocked", sessionData: 0, totalData: 110, connections: 0, lastSeen: "14:22:11" },
  { pid: 6384, name: "VS Code", exe: "Code.exe", status: "active", sessionData: 0.8, totalData: 5, connections: 1, lastSeen: "now" },
  { pid: 4400, name: "Slack", exe: "slack.exe", status: "active", sessionData: 3.4, totalData: 42, connections: 3, lastSeen: "now" },
  { pid: 2100, name: "WinStore App", exe: "WinStore.App.exe", status: "blocked", sessionData: 0, totalData: 180, connections: 0, lastSeen: "14:29:00" },
  { pid: 8840, name: "DNS Client", exe: "svchost.exe", status: "active", sessionData: 0.1, totalData: 0.8, connections: 8, lastSeen: "now" },
]

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

type SortKey = "name" | "status" | "sessionData" | "totalData"
type SortDir = "asc" | "desc"

export function LiveMonitor() {
  const { isShieldActive } = useShield()
  const [processes, setProcesses] = useState<ProcessEntry[]>(BASE_PROCESSES)
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("status")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [tick, setTick] = useState(0)

  // Simulate live data drift
  useEffect(() => {
    const interval = setInterval(() => {
      setProcesses((prev) =>
        prev.map((p) => {
          if (p.status === "active" && Math.random() > 0.4) {
            const delta = Math.random() * 0.3
            return { ...p, sessionData: Math.round((p.sessionData + delta) * 10) / 10 }
          }
          return p
        })
      )
      setTick((t) => t + 1)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const filtered = processes
    .filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.exe.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0
      if (sortKey === "name") cmp = a.name.localeCompare(b.name)
      else if (sortKey === "status") cmp = a.status.localeCompare(b.status)
      else if (sortKey === "sessionData") cmp = a.sessionData - b.sessionData
      else if (sortKey === "totalData") cmp = a.totalData - b.totalData
      return sortDir === "asc" ? cmp : -cmp
    })

  const blocked = processes.filter((p) => p.status === "blocked").length
  const active = processes.filter((p) => p.status === "active").length

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k)
      return <ChevronUp className="size-3 text-muted-foreground/40" />
    return sortDir === "asc" ? (
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
          LIVE — tick #{tick.toString().padStart(4, "0")}
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
              onClick={() => setProcesses([...BASE_PROCESSES])}
            >
              <RefreshCw className="size-3" />
              Reset
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
          <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr] gap-0 border-b border-border bg-muted/20 px-5 py-2">
            {(
              [
                { key: "name" as SortKey, label: "Process" },
                { key: null, label: "Executable" },
                { key: "status" as SortKey, label: "Status" },
                { key: "sessionData" as SortKey, label: "Session" },
                { key: "totalData" as SortKey, label: "Total" },
                { key: null, label: "Last Active" },
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
              return (
                <div
                  key={proc.pid}
                  className={cn(
                    "grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr] gap-0 px-5 py-3 transition-colors",
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

                  {/* Session */}
                  <span
                    className={cn(
                      "self-center tabular-nums font-medium",
                      proc.sessionData > 0 ? "text-foreground" : "text-muted-foreground/40"
                    )}
                  >
                    {proc.sessionData > 0 ? `${proc.sessionData} MB` : "—"}
                  </span>

                  {/* Total */}
                  <span className="self-center text-muted-foreground tabular-nums">
                    {proc.totalData} MB
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
