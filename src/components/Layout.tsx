import { useState, useCallback } from "react"
import { NavLink, Outlet } from "react-router-dom"
import {
  LayoutDashboard,
  SlidersHorizontal,
  Activity,
  FlaskConical,
  Brain,
  Globe,
  Gauge,
  Shield,
  ShieldOff,
  ChevronRight,
  PauseCircle,
  Monitor,
  LogIn,
  Loader2,
  Bell,
  Zap,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Toaster } from "@/components/ui/sonner"
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
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/climate", icon: Globe, label: "Climate Impact" },
  { to: "/budget", icon: Gauge, label: "Data Budget" },
  { to: "/focus", icon: Brain, label: "Digital Wellness" },
  { to: "/rules", icon: SlidersHorizontal, label: "Rules & Controls" },
  { to: "/throughput", icon: Activity, label: "Throughput" },
  { to: "/monitor", icon: Monitor, label: "Live Monitor" },
  { to: "/sandbox", icon: FlaskConical, label: "Dev Sandbox" },
  { to: "/spikes", icon: Zap, label: "Spike Log" },
]

export function Layout() {
  const {
    isShieldActive,
    toggleShield,
    suspendedPids,
    spikeEvents,
    isAutostartEnabled,
    autostartLoading,
    toggleAutostart,
  } = useShield()
  const [shieldConfirmOpen, setShieldConfirmOpen] = useState(false)

  const handleShieldToggle = useCallback(
    (checked: boolean) => {
      // If turning shield OFF and there are suspended processes, show confirmation
      if (!checked && isShieldActive && suspendedPids.size > 0) {
        setShieldConfirmOpen(true)
        return
      }
      toggleShield()
    },
    [isShieldActive, suspendedPids, toggleShield]
  )

  const confirmShieldToggle = useCallback(() => {
    setShieldConfirmOpen(false)
    toggleShield()
  }, [toggleShield])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* === SIDEBAR === */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-lg transition-all duration-300",
              isShieldActive
                ? "bg-neon-emerald/15 glow-emerald-sm"
                : "bg-muted"
            )}
          >
            {isShieldActive ? (
              <Shield className="size-4 text-neon-emerald" />
            ) : (
              <ShieldOff className="size-4 text-muted-foreground" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">
              Data Guardian
            </p>
            <p className="text-[10px] text-muted-foreground tracking-widest uppercase">
              v1.0.0
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-1 px-3 py-4 flex-1">
          <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Navigation
          </p>
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-150",
                  isActive
                    ? "bg-neon-emerald/10 text-neon-emerald font-medium glow-emerald-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn("size-4 shrink-0", isActive ? "text-neon-emerald" : "")} />
                  <span className="flex-1">{label}</span>
                  {/* Spike badge on Live Monitor */}
                  {to === "/monitor" && spikeEvents.length > 0 && !isActive && (
                    <Badge className="text-[8px] h-4 px-1 min-w-4 bg-destructive/20 text-destructive border-destructive/30">
                      {spikeEvents.length}
                    </Badge>
                  )}
                  {isActive && (
                    <ChevronRight className="size-3 text-neon-emerald/60" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section — Autostart + Background status */}
        <div className="border-t border-border px-4 py-3 space-y-3">
          {/* Background running indicator */}
          <div className="flex items-center gap-2">
            <div className="size-1.5 rounded-full bg-neon-emerald animate-pulse" />
            <span className="text-[10px] text-muted-foreground font-medium">
              Running in Background
            </span>
          </div>

          {/* Autostart toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <LogIn className="size-3 text-muted-foreground shrink-0" />
              <span className="text-[10px] text-muted-foreground truncate">
                Launch on Startup
              </span>
            </div>
            <button
              onClick={toggleAutostart}
              disabled={autostartLoading}
              className={cn(
                "relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-200",
                autostartLoading ? "opacity-50 cursor-wait" :
                isAutostartEnabled ? "bg-neon-emerald" : "bg-muted-foreground/30"
              )}
            >
              {autostartLoading ? (
                <Loader2 className="size-3 text-muted-foreground animate-spin mx-auto" />
              ) : (
                <span
                  className={cn(
                    "inline-block size-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                    isAutostartEnabled ? "translate-x-[15px]" : "translate-x-[2px]"
                  )}
                />
              )}
            </button>
          </div>

          {/* Spike alert count — clickable to navigate */}
          {spikeEvents.length > 0 && (
            <NavLink
              to="/spikes"
              className="flex items-center gap-2 text-[10px] text-destructive hover:text-destructive/80 transition-colors"
            >
              <Bell className="size-3" />
              <span>{spikeEvents.length} data spike{spikeEvents.length !== 1 ? "s" : ""}</span>
            </NavLink>
          )}
        </div>
      </aside>

      {/* === MAIN AREA === */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex items-center justify-between border-b border-border bg-card/50 px-6 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "size-1.5 rounded-full transition-all duration-500",
                isShieldActive
                  ? "bg-neon-emerald animate-pulse glow-emerald-sm"
                  : "bg-muted-foreground"
              )}
            />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
              System Status
            </span>
            {/* Spike warning indicator */}
            {spikeEvents.length > 0 && (
              <Badge
                variant="outline"
                className="ml-2 text-[9px] h-5 gap-1 border-destructive/30 text-destructive bg-destructive/5 animate-pulse"
              >
                <Bell className="size-2.5" />
                {spikeEvents.length} spike{spikeEvents.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {/* Master Shield Toggle */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background/80 px-4 py-2">
              <div className="flex flex-col items-end">
                <span className="text-xs font-semibold tracking-wide text-foreground">
                  Data Shield
                </span>
                <span
                  className={cn(
                    "text-[10px] font-medium tracking-widest uppercase transition-colors duration-300",
                    isShieldActive ? "text-neon-emerald" : "text-muted-foreground"
                  )}
                >
                  {isShieldActive ? "Active" : "Inactive"}
                </span>
              </div>
              <Switch
                checked={isShieldActive}
                onCheckedChange={handleShieldToggle}
                className={cn(
                  "transition-all duration-300",
                  isShieldActive
                    ? "data-[state=checked]:bg-neon-emerald"
                    : ""
                )}
              />
            </div>

            <Badge
              variant="outline"
              className={cn(
                "gap-1.5 border transition-all duration-300 text-[10px] tracking-wider uppercase font-semibold",
                isShieldActive
                  ? "border-neon-emerald/30 bg-neon-emerald/5 text-neon-emerald"
                  : "border-border text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isShieldActive ? "bg-neon-emerald" : "bg-muted-foreground"
                )}
              />
              {isShieldActive ? "Protected" : "Unprotected"}
            </Badge>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto grid-bg">
          <div className="scanline min-h-full">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Suspend confirmation dialog */}
      <AlertDialog open={shieldConfirmOpen} onOpenChange={setShieldConfirmOpen}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground flex items-center gap-2">
              <PauseCircle className="size-4 text-amber-400" />
              Deactivate Shield?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              There are <span className="font-semibold text-foreground">{suspendedPids.size} suspended process{suspendedPids.size !== 1 ? "es" : ""}</span>.
              Deactivating the shield will resume them. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmShieldToggle}
              className="bg-amber-500 text-black hover:bg-amber-500/90 font-medium"
            >
              Resume & Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Toast notifications */}
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  )
}
