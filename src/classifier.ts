import type { createOpencodeClient, SessionPromptData } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import {
  SYSTEM_PROMPT,
  ClassificationError,
  createClassifierEngine,
  withTimeout,
  type ClassifierTransport,
  type ModelSpec,
} from "./engine.js"
import type { Logger } from "./logger.js"

export type Client = ReturnType<typeof createOpencodeClient>
export type { ClassificationError, ModelSpec }

// Tool names a classifier session must never be able to call.
const DENIED_TOOLS = {
  bash: false,
  edit: false,
  write: false,
  create: false,
  delete: false,
  webfetch: false,
  task: false,
}

export type ClassifierOptions = {
  client: Client
  directory: string
  model: ModelSpec | null
  timeoutMs: number
  maxRetries: number
  logger?: Logger
}

// OpenCode 1.x transport: drives the classifier through the SDK client.
export function createClassifier(options: ClassifierOptions) {
  const { client, directory, timeoutMs, maxRetries, logger } = options

  const transport: ClassifierTransport = {
    directory: async () => directory,

    resolveModel: async (callerSessionID) => {
      if (options.model) return options.model
      if (callerSessionID) {
        try {
          const messages = unwrap(await client.session.messages({ path: { id: callerSessionID }, query: { limit: 10 } }))
          if (Array.isArray(messages)) {
            for (const entry of [...messages].reverse()) {
              const info = entry?.info
              if (info && typeof info.providerID === "string" && typeof info.modelID === "string") {
                return { providerID: info.providerID, modelID: info.modelID }
              }
            }
          }
        } catch {
          // fall through to config
        }
      }
      try {
        const cfg = unwrap(await client.config.get())
        if (cfg && typeof cfg.model === "string") {
          const [providerID, modelID] = cfg.model.split("/")
          if (providerID && modelID) return { providerID, modelID }
        }
      } catch {
        // fall through to no model
      }
      return null
    },

    createSession: async () => {
      const session = await client.session.create({ body: { title: "automode classifier" } })
      return unwrap(session).id as string
    },

    prompt: async (sessionID, resolvedModel, promptText) => {
      const body: SessionPromptData["body"] = {
        system: SYSTEM_PROMPT,
        tools: DENIED_TOOLS,
        parts: [{ type: "text", text: promptText }],
      }
      if (resolvedModel) body.model = resolvedModel

      const result = await withTimeout(client.session.prompt({ path: { id: sessionID }, body }), timeoutMs)
      const unwrapped = unwrap(result)
      if (!unwrapped || isErrorLike(unwrapped)) {
        throw new ClassificationError("classifier prompt failed: " + describe(unwrapped))
      }
      return textFromParts(Array.isArray(unwrapped.parts) ? unwrapped.parts : [])
    },

    disposeSession: async (sessionID) => {
      try {
        await client.session.delete({ path: { id: sessionID } })
      } catch {
        // best-effort cleanup
      }
    },
  }

  return createClassifierEngine({
    transport,
    timeoutMs,
    maxRetries,
    logger,
  })
}

function textFromParts(parts: Part[]): string {
  return parts
    .filter((part): part is Part & { text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

function unwrap(result: unknown): any {
  if (result && typeof result === "object" && "data" in (result as Record<string, unknown>)) {
    return (result as Record<string, unknown>).data
  }
  return result
}

function isErrorLike(value: unknown): boolean {
  return !!value && typeof value === "object" && "error" in (value as Record<string, unknown>)
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
