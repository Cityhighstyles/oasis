import { createContext, useContext, useState, useCallback } from "react"

type ShieldContextType = {
  isShieldActive: boolean
  toggleShield: () => void
  dataBudgetUsed: number
  dataBudgetTotal: number
  lastHotspotDetected: string | null
  firewallStatus: "active" | "inactive" | "partial"
}

const ShieldContext = createContext<ShieldContextType | null>(null)

export function ShieldProvider({ children }: { children: React.ReactNode }) {
  const [isShieldActive, setIsShieldActive] = useState(true)
  const [dataBudgetUsed] = useState(142)
  const [dataBudgetTotal] = useState(500)
  const [lastHotspotDetected] = useState("2 minutes ago")
  const [firewallStatus] = useState<"active" | "inactive" | "partial">("active")

  const toggleShield = useCallback(() => {
    setIsShieldActive((prev) => !prev)
  }, [])

  return (
    <ShieldContext.Provider
      value={{
        isShieldActive,
        toggleShield,
        dataBudgetUsed,
        dataBudgetTotal,
        lastHotspotDetected,
        firewallStatus,
      }}
    >
      {children}
    </ShieldContext.Provider>
  )
}

export function useShield() {
  const ctx = useContext(ShieldContext)
  if (!ctx) throw new Error("useShield must be used within ShieldProvider")
  return ctx
}
