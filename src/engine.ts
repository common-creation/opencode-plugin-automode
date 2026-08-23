import { parseVerdict, type Verdict } from "./parse.js"
import type { Logger } from "./logger.js"

export type ModelSpec = { providerID: string; modelID: string }

export class ClassificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ClassificationError"
  }
}

// Transport-agnostic contract implemented once per OpenCode major version.
// OpenCode 1.x drives it through the SDK client; OpenCode 2.x drives it
// through the plugin context.
export type ClassifierTransport = {
  // Working directory shown to the classifier, or null when unavailable.
  directory(): Promise<string | null>
  // Model used for classification, or null for the server default.
  resolveModel(callerSessionID?: string): Promise<ModelSpec | null>
  // Create a throwaway classifier session pinned to the given model.
  // Failures here abort classification immediately (no retry), matching the
  // historical OpenCode 1.x behavior.
  createSession(model: ModelSpec | null): Promise<string>
  // Prompt the classifier session and resolve with its full text output.
  // Rejects with ClassificationError for infrastructure failures.
  prompt(sessionID: string, model: ModelSpec | null, promptText: string): Promise<string>
  // Best-effort cleanup of a throwaway classifier session. Must not throw.
  disposeSession(sessionID: string): Promise<void>
}

export type EngineOptions = {
  transport: ClassifierTransport
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

export const SYSTEM_PROMPT = `You are a safety classifier for bash commands executed by an AI coding agent inside a development workspace.

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

export function buildPrompt(directory: string | null, command: string, hint?: string): string {
  const dir = directory ? `Working directory: ${directory}\n\n` : ""
  const hintText = hint
    ? `\n\nYour previous response was not valid JSON. Respond with ONLY the JSON object again:\n${hint}`
    : ""
  return `${dir}Command:\n${command}\n\nReply with ONLY a JSON object: {"allowed": true|false, "reason": "one short sentence"}${hintText}`
}

export function createClassifierEngine(options: EngineOptions) {
  const { transport, timeoutMs, maxRetries, logger = NOOP_LOGGER } = options

  function isInfraError(error: unknown): error is ClassificationError {
    return error instanceof ClassificationError
  }

  async function classify(command: string, callerSessionID?: string): Promise<Verdict> {
    const [resolvedModel, directory] = await Promise.all([
      transport.resolveModel(callerSessionID),
      transport.directory().catch(() => null),
    ])
    logger.debug("classifying command", {
      command,
      model: resolvedModel ? `${resolvedModel.providerID}/${resolvedModel.modelID}` : null,
    })
    let lastError: string | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const sessionID = await transport.createSession(resolvedModel)
      try {
        const text = await transport.prompt(sessionID, resolvedModel, buildPrompt(directory, command, lastError ?? undefined))
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
        try {
          await transport.disposeSession(sessionID)
        } catch {
          // best-effort cleanup
        }
      }
    }
    logger.error("classification failed", { command, lastError })
    throw new ClassificationError(`classifier produced no valid verdict after ${maxRetries + 1} attempt(s): ${lastError ?? "unknown error"}`)
  }

  return { classify, isInfraError }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
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
