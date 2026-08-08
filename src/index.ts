import type { Plugin } from "@opencode-ai/plugin"
import { createClassifier } from "./classifier.js"
import { loadConfig } from "./config.js"

const SERVICE = "automode"

export const AutoMode: Plugin = async ({ client, directory }) => {
  const config = loadConfig()
  const classifier = createClassifier({
    client,
    directory,
    model: config.model,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
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
          return
        }
        throw error
      } finally {
        inFlight = false
      }
    },
  }
}
