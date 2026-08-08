import type { createOpencodeClient, SessionPromptData } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import { parseVerdict, type Verdict } from "./parse.js"
import type { Logger } from "./logger.js"

export type Client = ReturnType<typeof createOpencodeClient>
export type ModelSpec = { providerID: string; modelID: string } | null

export class ClassificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ClassificationError"
  }
}

export type ClassifierOptions = {
  client: Client
  directory: string
  model: ModelSpec
  timeoutMs: number
  maxRetries: number
  logger?: Logger
}

const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const SYSTEM_PROMPT = `You are a safety classifier for bash commands executed by an AI coding agent inside a development workspace.

A single bash command will be provided. Determine whether running it is SAFE or DANGEROUS.

Consider the command SAFE when it is a routine development operation, for example:
- Read-only inspection (ls, cat, grep, find, git status/log/diff/show, pwd, env, which, head, tail, wc, file, stat, curl/wget with a plain GET request)
- Operations confined to the project: creating or editing files, installing declared dependencies (npm install, bun add, pip install, go get, brew install), running builds, tests, linters, formatters, dev servers, git add/commit/push on the current repository
- Network access to well-known, benign endpoints

Consider the command DANGEROUS when it could harm the system, the project, or the user, for example:
- Irreversible or destructive operations: rm -rf on system/root/home paths, dd, mkfs, diskutil erase, truncate, shred
- Privilege escalation or permission changes: sudo, chmod/chown on sensitive paths, setuid
- Exfiltrating secrets or data: reading and uploading .env, SSH keys, credentials, tokens, or git remotes; curl/git push of repository contents to unknown endpoints
- Persistence or backdoors: modifying cron, launchd, systemd, shell profiles (~/.bashrc, ~/.zshrc), ~/.ssh/authorized_keys, rc files
- Executing untrusted remote code: curl ... | bash/sh, downloading and running scripts from unknown sources
- Attacks or disruption: shutdown, reboot, kill of critical processes, disabling firewalls/SIP/AV, crypto mining, ransomware-like behavior
- Anything that changes state outside the current workspace without a clear development purpose

Respond with ONLY a JSON object, no markdown, no commentary:
{"allowed": true|false, "reason": "one short sentence"}
If unsure, set "allowed" to false.`

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

export function createClassifier(options: ClassifierOptions) {
  const { client, directory, model, timeoutMs, maxRetries, logger = NOOP_LOGGER } = options

  function isInfraError(error: unknown): error is ClassificationError {
    return error instanceof ClassificationError
  }

  async function createSession() {
    const session = await client.session.create({ body: { title: "automode classifier" } })
    return unwrap(session)
  }

  async function deleteSession(id: string) {
    try {
      await client.session.delete({ path: { id } })
    } catch {
      // best-effort cleanup
    }
  }

  function buildPrompt(command: string, hint?: string) {
    const hintText = hint ? `\n\nYour previous response was not valid JSON. Respond with ONLY the JSON object again:\n${hint}` : ""
    return `Working directory: ${directory}\n\nCommand:\n${command}\n\nReply with ONLY a JSON object: {"allowed": true|false, "reason": "one short sentence"}${hintText}`
  }

  async function promptSession(sessionID: string, resolvedModel: ModelSpec, command: string, hint?: string): Promise<string> {
    const body: SessionPromptData["body"] = {
      system: SYSTEM_PROMPT,
      tools: DENIED_TOOLS,
      parts: [{ type: "text", text: buildPrompt(command, hint) }],
    }
    if (resolvedModel) body.model = resolvedModel

    const result = await withTimeout(client.session.prompt({ path: { id: sessionID }, body }), timeoutMs)
    const unwrapped = unwrap(result)
    if (!unwrapped || isErrorLike(unwrapped)) {
      throw new ClassificationError("classifier prompt failed: " + describe(unwrapped))
    }
    return textFromParts(Array.isArray(unwrapped.parts) ? unwrapped.parts : [])
  }

  async function resolveModel(callerSessionID: string): Promise<ModelSpec> {
    if (model) return model
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
  }

  async function classify(command: string, callerSessionID: string): Promise<Verdict> {
    const resolvedModel = await resolveModel(callerSessionID)
    logger.debug("classifying command", {
      command,
      model: resolvedModel ? `${resolvedModel.providerID}/${resolvedModel.modelID}` : null,
    })
    let lastError: string | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const session = await createSession()
      try {
        const text = await promptSession(session.id, resolvedModel, command, lastError ?? undefined)
        const verdict = parseVerdict(text)
        if (verdict) {
          logger.debug("classification verdict", {
            attempt,
            allowed: verdict.allowed,
            reason: verdict.reason,
          })
          return verdict
        }
        lastError = text.slice(0, 200)
        logger.warn("classifier returned unparseable response", { attempt, text: lastError })
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        logger.warn("classifier attempt failed", { attempt, error: lastError })
      } finally {
        await deleteSession(session.id)
      }
    }
    logger.error("classification failed", { command, lastError })
    throw new ClassificationError(`classifier produced no valid verdict after ${maxRetries + 1} attempt(s): ${lastError ?? "unknown error"}`)
  }

  return { classify, isInfraError }
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ClassificationError(`classifier timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
