import { homedir } from "node:os"

export type AutoModeConfig = {
  enabled: boolean
  model: { providerID: string; modelID: string } | null
  failMode: "open" | "closed"
  timeoutMs: number
  maxRetries: number
  logPath: string
}

// Expand a leading "~" to the user's home directory. Node filesystem calls do
// not perform shell-style tilde expansion, so a literal "~" from config would
// otherwise be treated as a relative directory name. Both separators are
// accepted because OpenCode may run directly on Windows.
export function expandHomePath(path: string): string {
  if (path === "~") return homedir()
  if ((path[1] === "/" || path[1] === "\\") && path.startsWith("~")) {
    return homedir() + path.slice(1)
  }
  return path
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value === "true" || value === "1" || value === "yes"
}

function parseIntNonNegative(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AutoModeConfig {
  let model: AutoModeConfig["model"] = null
  const modelSpec = env.OPENCODE_AUTOMODE_MODEL?.trim()
  if (modelSpec) {
    const [providerID, modelID] = modelSpec.split("/")
    if (providerID && modelID) model = { providerID, modelID }
  }

  return {
    enabled: parseBool(env.OPENCODE_AUTOMODE_ENABLED, true),
    model,
    failMode: env.OPENCODE_AUTOMODE_FAIL_MODE?.trim().toLowerCase() === "open" ? "open" : "closed",
    timeoutMs: parseIntNonNegative(env.OPENCODE_AUTOMODE_TIMEOUT_MS, 30_000),
    maxRetries: parseIntNonNegative(env.OPENCODE_AUTOMODE_MAX_RETRIES, 2),
    logPath: expandHomePath(env.OPENCODE_AUTOMODE_LOG_PATH?.trim() ?? ""),
  }
}
