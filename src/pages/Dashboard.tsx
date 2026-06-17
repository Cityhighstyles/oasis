import { Shield, Wifi, Clock, TrendingDown, Zap, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

function DataBudgetRing({
  used,
  total,
}: {
  used: number
  total: number
}) {
  const pct = Math.min((used / total) * 100, 100)
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (pct / 100) * circumference

  const color =
    pct > 85
      ? "oklch(0.63 0.22 25)"
      : pct > 65
        ? "oklch(0.75 0.16 80)"
        : "oklch(0.72 0.19 165)"

  return (
    <div className="relative flex items-center justify-center">
      <svg width="140" height="140" className="-rotate-90">
        {/* Track */}
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="oklch(0.2 0.012 264)"
          strokeWidth="10"
        />
        {/* Progress */}
        <circle
          cx="70"
          cy="70"
          r={radius}
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
        <span className="text-2xl font-bold text-foreground tabular-nums">
          {used}
        </span>
        <span className="text-xs text-muted-foreground">MB used</span>
        <span className="mt-0.5 text-[10px] text-muted-foreground/60">
          of {total} MB
        </span>
      </div>
    </div>
  )
}

const RECENT_EVENTS = [
  { time: "14:32:01", event: "Blocked: Windows Update (Background)", type: "blocked" },
  { time: "14:31:48", event: "Allowed: DNS resolution", type: "allowed" },
  { time: "14:30:12", event: "Blocked: OneDrive sync attempt", type: "blocked" },
  { time: "14:28:55", event: "Blocked: Chrome auto-update", type: "blocked" },
  { time: "14:27:03", event: "Shield activated", type: "info" },
]

export function Dashboard() {
  const { isShieldActive, dataBudgetUsed, dataBudgetTotal, lastHotspotDetected, firewallStatus } =
    useShield()

  const pct = Math.round((dataBudgetUsed / dataBudgetTotal) * 100)
  const remaining = dataBudgetTotal - dataBudgetUsed
  const savedMB = 318

  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          System overview and data budget status
        </p>
      </div>

      {/* Top row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Data Budget Card */}
        <Card className="col-span-1 border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today's Data Budget
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <DataBudgetRing used={dataBudgetUsed} total={dataBudgetTotal} />
            <div className="w-full space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{pct}% consumed</span>
                <span>{remaining} MB left</span>
              </div>
              <Progress
                value={pct}
                className="h-1.5 bg-border"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 w-full">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Used</p>
                <p className="text-sm font-semibold text-foreground">{dataBudgetUsed} MB</p>
              </div>
              <div className="rounded-md bg-neon-emerald/5 border border-neon-emerald/20 px-3 py-2 text-center">
                <p className="text-[10px] text-neon-emerald/70 uppercase tracking-wider">Saved</p>
                <p className="text-sm font-semibold text-neon-emerald">{savedMB} MB</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status Cards */}
        <div className="col-span-2 grid grid-rows-2 gap-4">
          {/* Firewall Status */}
          <Card
            className={cn(
              "border transition-all duration-300",
              isShieldActive
                ? "border-neon-emerald/20 bg-neon-emerald/5"
                : "border-border bg-card"
            )}
          >
            <CardContent className="flex items-center gap-4 py-4 px-5">
              <div
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-xl border transition-all duration-300",
                  isShieldActive
                    ? "border-neon-emerald/30 bg-neon-emerald/10 glow-emerald-sm"
                    : "border-border bg-muted"
                )}
              >
                <Shield
                  className={cn(
                    "size-5 transition-colors duration-300",
                    isShieldActive ? "text-neon-emerald" : "text-muted-foreground"
                  )}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-foreground">Firewall Engine</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] h-4 px-1.5 tracking-wider uppercase",
                      firewallStatus === "active"
                        ? "border-neon-emerald/30 text-neon-emerald bg-neon-emerald/5"
                        : "border-border text-muted-foreground"
                    )}
                  >
                    {firewallStatus}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  WFP kernel-mode driver engaged — {isShieldActive ? "Blocking 12 rules" : "All rules disabled"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground">Blocked today</p>
                <p className={cn("text-lg font-bold tabular-nums", isShieldActive ? "text-neon-emerald" : "text-foreground")}>
                  47
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Hotspot Detection */}
          <Card className="border-border bg-card">
            <CardContent className="flex items-center gap-4 py-4 px-5">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-neon-cyan/30 bg-neon-cyan/10">
                <Wifi className="size-5 text-neon-cyan" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-foreground">Hotspot Detection</p>
                  <Badge
                    variant="outline"
                    className="border-neon-cyan/30 text-neon-cyan bg-neon-cyan/5 text-[10px] h-4 px-1.5 tracking-wider uppercase"
                  >
                    Detected
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  Metered connection identified — Auto-shield triggered
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="flex items-center gap-1 justify-end text-muted-foreground mb-0.5">
                  <Clock className="size-3" />
                  <span className="text-[10px]">Last seen</span>
                </div>
                <p className="text-sm font-semibold text-foreground">{lastHotspotDetected}</p>
              </div>
            </CardContent>
          </Card>

          {/* Stats row */}
          <div className="col-span-2 grid grid-cols-3 gap-3">
            {[
              { icon: Zap, label: "Avg. Block Rate", value: "94%", sub: "last 7 days", color: "text-neon-emerald" },
              { icon: TrendingDown, label: "Data Saved (Week)", value: "2.1 GB", sub: "vs no shield", color: "text-neon-cyan" },
              { icon: AlertTriangle, label: "Threats Detected", value: "128", sub: "this month", color: "text-amber-400" },
            ].map(({ icon: Icon, label, value, sub, color }) => (
              <Card key={label} className="border-border bg-card">
                <CardContent className="flex items-center gap-3 py-3 px-4">
                  <Icon className={cn("size-5 shrink-0", color)} />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground truncate">{label}</p>
                    <p className={cn("text-base font-bold tabular-nums", color)}>{value}</p>
                    <p className="text-[10px] text-muted-foreground/60">{sub}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Recent activity log */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-foreground">
              Recent Activity
            </CardTitle>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">
              Live Feed
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-3 p-0">
          <div className="font-mono text-xs divide-y divide-border">
            {RECENT_EVENTS.map((ev, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-5 py-2.5 hover:bg-accent/30 transition-colors"
              >
                <span className="text-muted-foreground/60 tabular-nums shrink-0">
                  {ev.time}
                </span>
                <span
                  className={cn(
                    "shrink-0 w-14 text-[10px] uppercase tracking-wider font-semibold",
                    ev.type === "blocked"
                      ? "text-destructive"
                      : ev.type === "allowed"
                        ? "text-neon-emerald"
                        : "text-neon-cyan"
                  )}
                >
                  {ev.type}
                </span>
                <span className="text-muted-foreground truncate">{ev.event}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
