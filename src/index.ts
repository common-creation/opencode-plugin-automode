import type { Plugin } from "@opencode-ai/plugin"
import { createClassifier } from "./classifier.js"
import { loadConfig } from "./config.js"
import { createLogger } from "./logger.js"
import { setupV2 } from "./v2.js"

const SERVICE = "automode"

export const AutoMode: Plugin = async ({ client, directory }) => {
  const config = loadConfig()
  const logger = createLogger(config.logPath)
  const classifier = createClassifier({
    client,
    directory,
    model: config.model,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    logger,
  })

  await client.app.log({
    body: {
      service: SERVICE,
      level: "info",
      message: "automode plugin initialized",
      extra: {
        enabled: config.enabled,
        failMode: config.failMode,
        model: config.model,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      },
    },
  })
  logger.info("automode plugin initialized", {
    enabled: config.enabled,
    failMode: config.failMode,
    model: config.model ? `${config.model.providerID}/${config.model.modelID}` : null,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    logPath: config.logPath,
  })

  let inFlight = false

  return {
    "tool.execute.before": async (input, output) => {
      if (!config.enabled) return
      if (input.tool !== "bash") return

      const command = output.args.command
      if (typeof command !== "string" || command.trim().length === 0) return
      if (inFlight) return

      inFlight = true
      try {
        const verdict = await classifier.classify(command, input.sessionID)

        if (!verdict.allowed) {
          await client.app.log({
            body: {
              service: SERVICE,
              level: "warn",
              message: "blocked dangerous command",
              extra: { command, reason: verdict.reason },
            },
          })
          logger.warn("blocked dangerous command", { command, reason: verdict.reason })
          throw new Error(
            `[automode] Command blocked by safety classifier.\n\nCommand: ${command}\n\nReason: ${verdict.reason}`,
          )
        }

        await client.app.log({
          body: {
            service: SERVICE,
            level: "debug",
            message: "allowed safe command",
            extra: { command, reason: verdict.reason },
          },
        })
        logger.debug("allowed safe command", { command, reason: verdict.reason })
      } catch (error) {
        if (classifier.isInfraError(error) && config.failMode === "open") {
          await client.app.log({
            body: {
              service: SERVICE,
              level: "warn",
              message: "classifier failed, allowing command (fail-open)",
              extra: { command, error: error.message },
            },
          })
          logger.warn("classifier failed, allowing command (fail-open)", {
            command,
            error: error.message,
          })
          return
        }
        logger.error("command classification failed", {
          command,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        inFlight = false
      }
    },
  }
}

// One default export serves both OpenCode generations, matching how the
// loaders pick their entry point:
//
// - OpenCode 1.x validates the module loosely and calls `server` with the
//   legacy plugin input ({ client, directory, ... }); the hooks object it
//   returns is registered. It also invokes `setup`, which no-ops there.
// - OpenCode 2.x schema-validates the default export as { id, setup } (extra
//   keys are tolerated) and registers hooks imperatively from `setup`; the
//   `server` function is never called.
type DualRuntimePlugin = {
  id: string
  server: Plugin
  setup: (context: unknown) => Promise<void> | void
}

export default {
  id: "common-creation.automode",
  server: AutoMode,
  setup: setupV2,
} satisfies DualRuntimePlugin
