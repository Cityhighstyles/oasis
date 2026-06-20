import { useCallback, useState } from "react"
import {
  MonitorDown,
  RefreshCw,
  Cloud,
  Package,
  Globe,
  HardDrive,
  ChevronRight,
  Info,
  Wifi,
  Plus,
  Trash2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useShield, type Rule } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

// ──────────────────────────── helpers ───────────────────────────────────────

/**
 * Map a rule ID to its display icon component.
 */
function ruleIcon(id: string): React.ElementType {
  switch (id) {
    case "windows-update":
      return MonitorDown
    case "delivery-opt":
      return RefreshCw
    case "windows-store":
      return Package
    case "telemetry":
      return HardDrive
    case "chrome-update":
      return Globe
    case "onedrive":
      return Cloud
    case "dropbox":
      return Cloud
    case "teams-update":
      return Package
    default:
      return Wifi
  }
}

/**
 * Convert raw `data_blocked_bytes` into a scannable human-readable string
 * (e.g. "1.2 GB", "420 MB", "28 MB", "950 B").
 */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const k = 1024
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1)
  const value = bytes / Math.pow(k, i)
  return `${i === 0 ? value.toFixed(0) : value.toFixed(i === 1 ? 0 : 1)} ${units[i]}`
}

/**
 * Aggregate the total data-blocked bytes across an array of rules.
 */
function totalBlockedBytes(rules: Rule[]): number {
  return rules.reduce((sum, r) => sum + r.dataBlockedBytes, 0)
}

const RISK_STYLES = {
  high: "border-destructive/40 text-destructive bg-destructive/5",
  medium: "border-amber-500/40 text-amber-400 bg-amber-500/5",
  low: "border-border text-muted-foreground bg-muted/30",
}

// ──────────────────────────── RuleRow ───────────────────────────────────────

function RuleRow({
  rule,
  onToggle,
  onDelete,
  shieldActive,
  isCustom,
}: {
  rule: Rule
  onToggle: (id: string, newEnabled: boolean) => void
  onDelete: (id: string) => void
  shieldActive: boolean
  isCustom: boolean
}) {
  const Icon = ruleIcon(rule.id)
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
          {isCustom && (
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 border border-border rounded px-1">
              custom
            </span>
          )}
          <Badge
            variant="outline"
            className={cn("text-[10px] h-4 px-1.5 capitalize tracking-wider", RISK_STYLES[rule.risk])}
          >
            {rule.risk}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">{rule.description}</p>
      </div>

      <div className="text-right shrink-0 mr-2">
        <p className="text-[10px] text-muted-foreground">Saved</p>
        <p
          className={cn(
            "text-sm font-semibold tabular-nums",
            isOn ? "text-neon-emerald" : "text-muted-foreground"
          )}
        >
          {formatBytes(rule.dataBlockedBytes)}
        </p>
      </div>

      <Switch
        checked={rule.enabled}
        onCheckedChange={(checked) => onToggle(rule.id, checked)}
        disabled={!shieldActive}
        className={cn(
          "transition-all",
          rule.enabled && shieldActive ? "data-[state=checked]:bg-neon-emerald" : ""
        )}
      />

      {isCustom && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              className="opacity-0 group-hover:opacity-100 transition-opacity size-7 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
              title="Delete rule"
            >
              <Trash2 className="size-3.5" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="border-border bg-card max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground">Delete Rule</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                Are you sure you want to delete <span className="font-medium text-foreground">{rule.name}</span>?
                This action cannot be undone. The rule will be removed and its targets
                will no longer be blocked.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onDelete(rule.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-medium"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

// ──────────────────────────── AddRuleDialog ─────────────────────────────────

function AddRuleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { addRule } = useShield()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [risk, setRisk] = useState<"high" | "medium" | "low">("medium")
  const [targetsStr, setTargetsStr] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    setError(null)
    const targets = targetsStr
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)

    if (!name.trim()) {
      setError("Rule name is required")
      return
    }
    if (targets.length === 0) {
      setError("At least one target executable is required")
      return
    }

    setSubmitting(true)
    try {
      await addRule(name.trim(), description.trim(), risk, targets)
      // Reset form
      setName("")
      setDescription("")
      setRisk("medium")
      setTargetsStr("")
      onOpenChange(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-border bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">New Rule</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            Create a custom rule to block specific executable targets.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="rule-name" className="text-xs text-muted-foreground uppercase tracking-wider">
              Name
            </Label>
            <Input
              id="rule-name"
              placeholder="e.g. Discord Updater"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-border bg-muted/40 text-foreground placeholder:text-muted-foreground/60"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="rule-desc" className="text-xs text-muted-foreground uppercase tracking-wider">
              Description
            </Label>
            <Input
              id="rule-desc"
              placeholder="e.g. Background Discord auto-update service"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="border-border bg-muted/40 text-foreground placeholder:text-muted-foreground/60"
            />
          </div>

          {/* Risk */}
          <div className="space-y-1.5">
            <Label htmlFor="rule-risk" className="text-xs text-muted-foreground uppercase tracking-wider">
              Risk Level
            </Label>
            <div className="flex gap-2">
              {(["high", "medium", "low"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setRisk(level)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-xs font-medium capitalize transition-all",
                    risk === level
                      ? level === "high"
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : level === "medium"
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                          : "border-border bg-muted/60 text-muted-foreground"
                      : "border-border bg-muted/20 text-muted-foreground/60 hover:bg-muted/40"
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Targets */}
          <div className="space-y-1.5">
            <Label htmlFor="rule-targets" className="text-xs text-muted-foreground uppercase tracking-wider">
              Targets
            </Label>
            <Input
              id="rule-targets"
              placeholder="e.g. discord.exe, DiscordUpdater.exe"
              value={targetsStr}
              onChange={(e) => setTargetsStr(e.target.value)}
              className="border-border bg-muted/40 text-foreground placeholder:text-muted-foreground/60"
            />
            <p className="text-[10px] text-muted-foreground/60">
              Comma-separated executable or DLL names
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel className="border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-neon-emerald text-black hover:bg-neon-emerald/90 font-medium"
          >
            {submitting ? "Adding…" : "Add Rule"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ──────────────────────────── RulesControls ─────────────────────────────────

export function RulesControls() {
  const { isShieldActive, rules, toggleRule, deleteRule } = useShield()
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  // Canonical rule IDs — everything else is a custom rule
  const defaultIds = new Set([
    "windows-update",
    "delivery-opt",
    "windows-store",
    "telemetry",
    "chrome-update",
    "onedrive",
    "dropbox",
    "teams-update",
  ])

  const handleToggle = useCallback(
    async (id: string, newEnabled: boolean) => {
      await toggleRule(id, newEnabled).catch(() => {})
    },
    [toggleRule]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteRule(id)
      } catch (err) {
        console.error("Failed to delete rule:", err)
      }
    },
    [deleteRule]
  )

  // Split rules into OS and Application groups using the canonical sort order
  const osIds = new Set(["windows-update", "delivery-opt", "windows-store", "telemetry"])
  const osRules = rules.filter((r) => osIds.has(r.id))
  const appRules = rules.filter((r) => !osIds.has(r.id))

  const osEnabled = osRules.filter((r) => r.enabled).length
  const appEnabled = appRules.filter((r) => r.enabled).length
  const totalSaved = totalBlockedBytes(rules)

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
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAddDialogOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-neon-emerald/30 bg-neon-emerald/10 px-3 py-2 text-xs font-medium text-neon-emerald transition-all hover:bg-neon-emerald/20"
          >
            <Plus className="size-3.5" />
            New Rule
          </button>
          {!isShieldActive && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <Info className="size-4 text-amber-400 shrink-0" />
              <span className="text-xs text-amber-400">
                Enable the Master Shield to activate rules
              </span>
            </div>
          )}
        </div>
      </div>

      <AddRuleDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      {/* Summary chips */}
      <div className="flex gap-3">
        {[
          { label: "OS Rules Active", value: osEnabled, total: osRules.length },
          { label: "App Rules Active", value: appEnabled, total: appRules.length },
          {
            label: "Total Data Savings",
            value: formatBytes(totalSaved),
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
        <CardContent className="p-0 divide-y divide-border">            {osRules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={handleToggle}
              onDelete={handleDelete}
              shieldActive={isShieldActive}
              isCustom={!defaultIds.has(rule.id)}
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
              onToggle={handleToggle}
              onDelete={handleDelete}
              shieldActive={isShieldActive}
              isCustom={!defaultIds.has(rule.id)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
