import type * as PluginV2 from "@opencode-ai/plugin-v2"
import {
  SYSTEM_PROMPT,
  createClassifierEngine,
  withTimeout,
  type ClassifierTransport,
} from "./engine.js"
import { loadConfig } from "./config.js"
import { envOverlayFromOptions } from "./options.js"
import { createLogger } from "./logger.js"

const CLASSIFIER_TITLE = "automode classifier"

// The shell tool is named "bash" in OpenCode 1.x and "shell" in OpenCode 2.x.
const SHELL_TOOL_NAMES = new Set(["bash", "shell"])

// OpenCode 2.x beta entry point. Under OpenCode 1.x this function also runs
// (the loader invokes both `server` and `setup`) but receives a legacy context
// without the tool/session domains; the feature check below makes it a no-op
// there so the V1 `server` entry keeps handling hooks.
export async function setupV2(context: unknown): Promise<void> {
  if (!isV2Context(context)) return
  const ctx = context

  // Options from the config entry override ambient environment variables:
  // the service process may be spawned without OPENCODE_AUTOMODE_* exports.
  const config = loadConfig({ ...process.env, ...envOverlayFromOptions(ctx.options) })
  const logger = createLogger(config.logPath)

  // Classifier sessions currently prompting through ctx.session.generate.
  // The session hook matches on these IDs to pin the classifier system prompt
  // and strip every tool from the model request.
  const activeSessions = new Set<string>()

  await ctx.session.hook("context", (event) => {
    if (!activeSessions.has(event.sessionID)) return
    event.system = [{ type: "text", text: SYSTEM_PROMPT }]
    for (const key of Object.keys(event.tools)) delete event.tools[key]
    logger.debug("classifier session context pinned", {
      sessionID: event.sessionID,
      toolsRemoved: Object.keys(event.tools).length === 0,
    })
  })

  const transport: ClassifierTransport = {
    // Resolve the working directory once, from the catalog's default-model
    // location. Falls back to null (prompt omits the line).
    directory: async () => {
      try {
        const output = await ctx.catalog.model.default()
        const directory = output?.location?.directory
        return typeof directory === "string" ? directory : null
      } catch {
        return null
      }
    },

    resolveModel: async () => {
      if (config.model) return config.model
      try {
        const output = await ctx.catalog.model.default()
        const info = output?.data
        if (info && typeof info.providerID === "string" && typeof info.id === "string") {
          return { providerID: info.providerID, modelID: info.id }
        }
      } catch {
        // fall through to no model
      }
      return null
    },

    createSession: async (model) => {
      const info = await ctx.session.create({
        title: CLASSIFIER_TITLE,
        ...(model ? { model: { providerID: model.providerID, id: model.modelID } } : {}),
      })
      activeSessions.add(info.id)
      return info.id
    },

    prompt: async (sessionID, _model, promptText) => {
      const result = await withTimeout(ctx.session.generate({ sessionID, prompt: promptText }), config.timeoutMs)
      return typeof result?.text === "string" ? result.text : ""
    },

    disposeSession: async (sessionID) => {
      activeSessions.delete(sessionID)
      try {
        // Session removal is not part of the beta plugin context type but may
        // be available on the underlying client; call it defensively.
        const anySession = ctx.session as unknown as {
          remove?: (input: { sessionID: string }) => Promise<unknown>
        }
        await anySession.remove?.({ sessionID })
      } catch {
        // best-effort cleanup
      }
    },
  }

  const engine = createClassifierEngine({
    transport,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    logger,
  })

  let inFlight = false

  await ctx.tool.hook("execute.before", async (event) => {
    if (!config.enabled) return
    if (!SHELL_TOOL_NAMES.has(event.tool)) return

    let command: string | undefined
    if (typeof event.input === "object" && event.input !== null) {
      const candidate = (event.input as { command?: unknown }).command
      if (typeof candidate === "string") command = candidate
    }
    if (!command || command.trim().length === 0) return
    if (inFlight) return

    inFlight = true
    try {
      const verdict = await engine.classify(command, event.sessionID)

      if (!verdict.allowed) {
        logger.warn("blocked dangerous command", { command, reason: verdict.reason })
        throw new Error(
          `[automode] Command blocked by safety classifier.\n\nCommand: ${command}\n\nReason: ${verdict.reason}`,
        )
      }

      logger.debug("allowed safe command", { command, reason: verdict.reason })
    } catch (error) {
      if (engine.isInfraError(error) && config.failMode === "open") {
        logger.warn("classifier failed, allowing command (fail-open)", {
          command,
          error: error instanceof Error ? error.message : String(error),
        })
        return
      }
      throw error
    } finally {
      inFlight = false
    }
  })

  logger.info("automode plugin initialized", {
    runtime: "opencode-2",
    enabled: config.enabled,
    failMode: config.failMode,
    model: config.model ? `${config.model.providerID}/${config.model.modelID}` : null,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    logPath: config.logPath,
  })
}

function isV2Context(value: unknown): value is PluginV2.Plugin.Context {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<PluginV2.Plugin.Context>
  return (
    typeof candidate.tool?.hook === "function" &&
    typeof candidate.session?.create === "function" &&
    typeof candidate.session?.generate === "function"
  )
}
