// OpenCode 2.x passes the JSON object from a config plugin entry to the plugin
// unchanged as ctx.options. Environment variables do not reliably reach that
// process (the background service may be spawned by any parent shell), so the
// plugin also accepts its configuration through options:
//
//   {
//     "package": "@common-creation/opencode-plugin-automode",
//     "options": {
//       "environment": { "OPENCODE_AUTOMODE_LOG_PATH": "/tmp/automode.log" }
//     }
//   }
//
// Direct snake_case aliases are accepted as well. Options take precedence over
// ambient process.env because they are scoped to this plugin entry.

export const OPTION_ALIASES = {
  enabled: "OPENCODE_AUTOMODE_ENABLED",
  model: "OPENCODE_AUTOMODE_MODEL",
  fail_mode: "OPENCODE_AUTOMODE_FAIL_MODE",
  timeout_ms: "OPENCODE_AUTOMODE_TIMEOUT_MS",
  max_retries: "OPENCODE_AUTOMODE_MAX_RETRIES",
  log_path: "OPENCODE_AUTOMODE_LOG_PATH",
} as const

function stringify(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? value : undefined
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "boolean") return String(value)
  return undefined
}

// Build a process.env overlay from plugin options. Only OPENCODE_AUTOMODE_*
// keys are honored from the environment map so an unrelated variable in config
// cannot leak into the plugin's environment view.
export function envOverlayFromOptions(options: unknown): Record<string, string> {
  if (!options || typeof options !== "object" || Array.isArray(options)) return {}
  const record = options as Record<string, unknown>
  const overlay: Record<string, string> = {}

  const environment = record.environment
  if (environment && typeof environment === "object" && !Array.isArray(environment)) {
    for (const [key, value] of Object.entries(environment as Record<string, unknown>)) {
      if (!key.startsWith("OPENCODE_AUTOMODE_")) continue
      const text = stringify(value)
      if (text !== undefined) overlay[key] = text
    }
  }

  for (const [optionKey, envKey] of Object.entries(OPTION_ALIASES)) {
    const text = stringify(record[optionKey])
    if (text !== undefined) overlay[envKey] = text
  }

  return overlay
}
