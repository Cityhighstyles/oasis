import { useState, useEffect, useRef } from "react"
import { useParams } from "react-router-dom"
import { invoke } from "@tauri-apps/api/core"
import { X, Terminal, Package, Container, GitBranch, Puzzle, FileCode, Cog, Download, Bot, HardHat } from "lucide-react"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import type { DetectedOperation } from "./DevSandbox"
import { Button } from "@/components/ui/button"

const appWindow = typeof window !== "undefined" ? getCurrentWebviewWindow() : null

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  package: Package,
  container: Container,
  "git-branch": GitBranch,
  puzzle: Puzzle,
  snake: FileCode,
  crab: Cog,
  download: Download,
  bot: Bot,
  "hard-hat": HardHat,
  beer: Package,
  linux: Terminal,
  dotnet: Terminal,
  globe: Package,
  terminal: Terminal,
}

export function SandboxOverlay() {
  const { operationId: paramId } = useParams()
  const [operationId, setOperationId] = useState<string | null>(paramId || null)
  const [operation, setOperation] = useState<DetectedOperation | null>(null)
  const hasReceivedEvent = useRef(false)

  // Resolve operationId from params or window data
  useEffect(() => {
    if (paramId) {
      setOperationId(paramId)
    } else {
      const win = window as any
      if (win.__SANDBOX_OP_ID__) {
        setOperationId(win.__SANDBOX_OP_ID__)
      }
    }
  }, [paramId])

  // Primary: listen for live updates via events
  useEffect(() => {
    if (!operationId) return
    const unlisten = appWindow?.listen<DetectedOperation>("sandbox-operation-updated", (event) => {
      if (event.payload.id === operationId) {
        setOperation(event.payload)
        hasReceivedEvent.current = true
      }
    })

    return () => {
      unlisten?.then((fn) => fn())
    }
  }, [operationId])

  // Fallback: poll backend every 5s if no event has been received yet
  useEffect(() => {
    if (!operationId) return

    const interval = setInterval(async () => {
      if (hasReceivedEvent.current) {
        clearInterval(interval)
        return
      }

      try {
        const operations: DetectedOperation[] = await invoke("get_sandbox_operations")
        const match = operations.find((op) => op.id === operationId)
        if (match) {
          setOperation(match)
        }
      } catch {
        // Silently retry on next tick
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [operationId])

  const close = async () => {
    if (operationId) {
      try {
        await invoke("close_sandbox_overlay", { operationId })
      } catch {
        // Fallback: close window directly if backend command fails
        appWindow?.close()
      }
    } else {
      appWindow?.close()
    }
  }

  const startDrag = () => {
    appWindow?.startDragging()
  }

  const Icon = operation ? ICON_MAP[operation.commandType.icon] || Terminal : Terminal
  const isEstimated = operation?.status === "estimated"
  const opacity = isEstimated ? "1" : "0.5"

  return (
    <div className="h-screen w-screen flex flex-col bg-background/80 backdrop-blur-xl border border-neon-emerald/20 rounded-xl overflow-hidden">
      {/* Drag handle */}
      <div
        className="flex items-center justify-between px-4 py-2 bg-card/50"
        onMouseDown={startDrag}
      >
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-neon-emerald animate-pulse" />
          <span className="text-[10px] font-mono text-muted-foreground tracking-wider uppercase">
            Sandbox Overlay
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 hover:bg-destructive/20"
          onClick={close}
        >
          <X className="size-3" />
        </Button>
      </div>

      {/* Content */}
      {operation ? (
        <div className="flex-1 p-4 space-y-3" style={{ opacity }}>
          {/* Icon + Title */}
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-neon-emerald/10 border border-neon-emerald/20 flex items-center justify-center">
              <Icon className="size-5 text-neon-emerald" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {operation.commandType.label}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground truncate">
                PID {operation.pid} · {operation.executable}
              </p>
            </div>
          </div>

          {/* Download estimate */}
          {isEstimated && (
            <div className="rounded-lg bg-gradient-to-br from-neon-emerald/5 to-neon-cyan/5 border border-neon-emerald/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Estimated Download
                </span>
                <span className="text-lg font-bold text-neon-emerald tabular-nums">
                  {operation.estimatedMb.toFixed(1)} MB
                </span>
              </div>
              {/* Range bar */}
              <div className="space-y-1">
                <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-neon-emerald to-neon-cyan"
                    style={{
                      width: `${Math.min(
                        ((operation.estimatedMb - operation.estimatedRangeMinMb) /
                          Math.max(operation.estimatedRangeMaxMb - operation.estimatedRangeMinMb, 1)) *
                          100,
                        100
                      )}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground">
                  <span>{operation.estimatedRangeMinMb.toFixed(0)} MB</span>
                  <span>{operation.estimatedRangeMaxMb.toFixed(0)} MB</span>
                </div>
              </div>
              {/* Confidence */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-neon-emerald transition-all duration-500"
                    style={{ width: `${operation.confidence * 100}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {Math.round(operation.confidence * 100)}% confidence
                </span>
              </div>
            </div>
          )}

          {/* AI Reasoning */}
          {operation.aiReasoning && (
            <div className="rounded-lg bg-muted/30 border border-border p-2.5">
              <p className="text-[10px] leading-relaxed text-muted-foreground italic">
                {operation.aiReasoning}
              </p>
            </div>
          )}

          {/* Status */}
          <div className="flex items-center gap-2 pt-1">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider ${
                isEstimated
                  ? "bg-neon-emerald/10 text-neon-emerald border border-neon-emerald/20"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
              }`}
            >
              <span className={`size-1.5 rounded-full ${isEstimated ? "bg-neon-emerald" : "bg-amber-400 animate-pulse"}`} />
              {isEstimated ? "Estimated" : "Detecting..."}
            </span>
            <span className="text-[9px] text-muted-foreground">{operation.detectedAt}</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="size-8 rounded-full border-2 border-neon-emerald/30 border-t-neon-emerald animate-spin mx-auto" />
            <p className="text-[10px] text-muted-foreground">Loading operation...</p>
          </div>
        </div>
      )}
    </div>
  )
}
