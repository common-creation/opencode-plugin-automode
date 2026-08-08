import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

export type LogLevel = "debug" | "info" | "warn" | "error"

export type Logger = {
  debug(message: string, extra?: Record<string, unknown>): void
  info(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
  error(message: string, extra?: Record<string, unknown>): void
}

const NOOP: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export function createLogger(logPath: string): Logger {
  const path = logPath.trim()
  if (!path) return NOOP

  let ready: Promise<void> | null = null
  let queue: Promise<unknown> = Promise.resolve()

  function ensureDir(): Promise<void> {
    ready ??= mkdir(dirname(path), { recursive: true }).then(() => {}).catch(() => {})
    return ready
  }

  function write(level: LogLevel, message: string, extra?: Record<string, unknown>) {
    const line =
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        message,
        ...(extra && Object.keys(extra).length > 0 ? { extra } : {}),
      }) + "\n"
    queue = queue
      .then(ensureDir)
      .then(() => appendFile(path, line, "utf8"))
      .catch((error) => {
        console.error(`[automode:logger] failed to write ${level} log to ${path}:`, error)
      })
  }

  return {
    debug: (message, extra) => write("debug", message, extra),
    info: (message, extra) => write("info", message, extra),
    warn: (message, extra) => write("warn", message, extra),
    error: (message, extra) => write("error", message, extra),
  }
}
