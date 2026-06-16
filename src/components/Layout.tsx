import { NavLink, Outlet } from "react-router-dom"
import {
  LayoutDashboard,
  SlidersHorizontal,
  Activity,
  FlaskConical,
  Shield,
  ShieldOff,
  Wifi,
  ChevronRight,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { useShield } from "@/context/ShieldContext"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/rules", icon: SlidersHorizontal, label: "Rules & Controls" },
  { to: "/monitor", icon: Activity, label: "Live Monitor" },
  { to: "/sandbox", icon: FlaskConical, label: "Dev Sandbox" },
]

export function Layout() {
  const { isShieldActive, toggleShield } = useShield()

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
                  {isActive && (
                    <ChevronRight className="size-3 text-neon-emerald/60" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom status */}
        <div className="border-t border-border px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <Wifi className="size-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Hotspot Active</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            AT&T Hotspot — 4G LTE
          </p>
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
                onCheckedChange={toggleShield}
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
    </div>
  )
}
