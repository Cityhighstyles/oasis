import { useState } from "react"
import {
  MonitorDown,
  RefreshCw,
  Cloud,
  Package,
  Globe,
  HardDrive,
  ChevronRight,
  Info,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

type Rule = {
  id: string
  name: string
  description: string
  icon: React.ElementType
  enabled: boolean
  dataBlocked?: string
  risk: "high" | "medium" | "low"
}

const INITIAL_OS_RULES: Rule[] = [
  {
    id: "windows-update",
    name: "Windows Update",
    description: "Background OS update downloads and delta patches",
    icon: MonitorDown,
    enabled: true,
    dataBlocked: "1.2 GB",
    risk: "high",
  },
  {
    id: "delivery-opt",
    name: "Delivery Optimization",
    description: "P2P update sharing with other Windows devices",
    icon: RefreshCw,
    enabled: true,
    dataBlocked: "420 MB",
    risk: "high",
  },
  {
    id: "windows-store",
    name: "Microsoft Store",
    description: "App auto-updates from the Windows Store",
    icon: Package,
    enabled: true,
    dataBlocked: "180 MB",
    risk: "medium",
  },
  {
    id: "telemetry",
    name: "Telemetry & Diagnostics",
    description: "Windows diagnostic data uploads to Microsoft servers",
    icon: HardDrive,
    enabled: false,
    dataBlocked: "28 MB",
    risk: "low",
  },
]

const INITIAL_APP_RULES: Rule[] = [
  {
    id: "chrome-update",
    name: "Chrome / Brave Updater",
    description: "Background browser binary auto-update service",
    icon: Globe,
    enabled: true,
    dataBlocked: "240 MB",
    risk: "medium",
  },
  {
    id: "onedrive",
    name: "OneDrive Sync",
    description: "Automatic file synchronization to cloud storage",
    icon: Cloud,
    enabled: true,
    dataBlocked: "680 MB",
    risk: "high",
  },
  {
    id: "dropbox",
    name: "Dropbox Sync",
    description: "Background Dropbox file sync and indexing",
    icon: Cloud,
    enabled: false,
    dataBlocked: "110 MB",
    risk: "medium",
  },
  {
    id: "teams-update",
    name: "Microsoft Teams",
    description: "Teams background auto-updates and presence sync",
    icon: Package,
    enabled: true,
    dataBlocked: "95 MB",
    risk: "medium",
  },
]

const RISK_STYLES = {
  high: "border-destructive/40 text-destructive bg-destructive/5",
  medium: "border-amber-500/40 text-amber-400 bg-amber-500/5",
  low: "border-border text-muted-foreground bg-muted/30",
}

function RuleRow({
  rule,
  onToggle,
  shieldActive,
}: {
  rule: Rule
  onToggle: (id: string) => void
  shieldActive: boolean
}) {
  const Icon = rule.icon
  const isOn = rule.enabled && shieldActive

  return (
    <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-accent/20 transition-colors group">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-200",
          isOn
            ? "border-neon-emerald/30 bg-neon-emerald/10"
            : "border-border bg-muted/40"
        )}
      >
        <Icon
          className={cn(
            "size-4 transition-colors duration-200",
            isOn ? "text-neon-emerald" : "text-muted-foreground"
          )}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-foreground">{rule.name}</span>
          <Badge
            variant="outline"
            className={cn("text-[10px] h-4 px-1.5 capitalize tracking-wider", RISK_STYLES[rule.risk])}
          >
            {rule.risk}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">{rule.description}</p>
      </div>

      {rule.dataBlocked && (
        <div className="text-right shrink-0 mr-2">
          <p className="text-[10px] text-muted-foreground">Saved</p>
          <p className={cn("text-sm font-semibold tabular-nums", isOn ? "text-neon-emerald" : "text-muted-foreground")}>
            {rule.dataBlocked}
          </p>
        </div>
      )}

      <Switch
        checked={rule.enabled}
        onCheckedChange={() => onToggle(rule.id)}
        disabled={!shieldActive}
        className={cn(
          "transition-all",
          rule.enabled && shieldActive ? "data-[state=checked]:bg-neon-emerald" : ""
        )}
      />
    </div>
  )
}

export function RulesControls() {
  const { isShieldActive } = useShield()
  const [osRules, setOsRules] = useState<Rule[]>(INITIAL_OS_RULES)
  const [appRules, setAppRules] = useState<Rule[]>(INITIAL_APP_RULES)

  const toggleRule = (
    setter: React.Dispatch<React.SetStateAction<Rule[]>>,
    id: string
  ) => {
    setter((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)))
  }

  const osEnabled = osRules.filter((r) => r.enabled).length
  const appEnabled = appRules.filter((r) => r.enabled).length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Rules &amp; Controls
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure which services are blocked when the shield is active
          </p>
        </div>
        {!isShieldActive && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <Info className="size-4 text-amber-400 shrink-0" />
            <span className="text-xs text-amber-400">
              Enable the Master Shield to activate rules
            </span>
          </div>
        )}
      </div>

      {/* Summary chips */}
      <div className="flex gap-3">
        {[
          { label: "OS Rules Active", value: osEnabled, total: osRules.length },
          { label: "App Rules Active", value: appEnabled, total: appRules.length },
          {
            label: "Total Data Savings",
            value: "3.0 GB",
            total: null,
            highlight: true,
          },
        ].map(({ label, value, total, highlight }) => (
          <div
            key={label}
            className={cn(
              "flex-1 rounded-lg border px-4 py-3",
              highlight
                ? "border-neon-emerald/20 bg-neon-emerald/5"
                : "border-border bg-card"
            )}
          >
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
              {label}
            </p>
            <p
              className={cn(
                "text-lg font-bold tabular-nums",
                highlight ? "text-neon-emerald" : "text-foreground"
              )}
            >
              {value}
              {total !== null && (
                <span className="text-xs font-normal text-muted-foreground">
                  /{total}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* OS Level section */}
      <Card className="border-border bg-card overflow-hidden">
        <CardHeader className="border-b border-border py-3 px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MonitorDown className="size-4 text-neon-cyan" />
              <CardTitle className="text-sm font-semibold text-foreground">
                OS Level
              </CardTitle>
              <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                Windows Services
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{osEnabled}/{osRules.length} active</span>
              <ChevronRight className="size-3" />
            </div>
          </div>
          <CardDescription className="text-xs mt-0.5">
            Kernel-level rules targeting Windows background services
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-border">
          {osRules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={(id) => toggleRule(setOsRules, id)}
              shieldActive={isShieldActive}
            />
          ))}
        </CardContent>
      </Card>

      <Separator className="bg-border" />

      {/* Applications section */}
      <Card className="border-border bg-card overflow-hidden">
        <CardHeader className="border-b border-border py-3 px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-neon-emerald" />
              <CardTitle className="text-sm font-semibold text-foreground">
                Applications
              </CardTitle>
              <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                3rd Party Apps
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{appEnabled}/{appRules.length} active</span>
              <ChevronRight className="size-3" />
            </div>
          </div>
          <CardDescription className="text-xs mt-0.5">
            Application-layer rules for background updaters and sync services
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-border">
          {appRules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={(id) => toggleRule(setAppRules, id)}
              shieldActive={isShieldActive}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
