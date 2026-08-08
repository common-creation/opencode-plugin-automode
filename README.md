# @common-creation/opencode-plugin-automode

An [OpenCode](https://opencode.ai) plugin that acts as a safety classifier for the `bash` tool: every bash command is judged by an LLM before it runs — safe commands are allowed, dangerous ones are rejected.

> **日本語版はこちら**: [README.ja.md](README.ja.md)

## How it works

1. The plugin hooks `tool.execute.before` and intercepts every `bash` call.
2. The command is sent to an LLM (via the `@opencode-ai/sdk` client) with a system prompt describing what counts as safe vs. dangerous.
3. The LLM replies with a JSON verdict: `{"allowed": true|false, "reason": "..."}`.
4. `allowed: true` → the command runs as usual.
5. `allowed: false` → the tool call is rejected with an error the agent can react to (no user prompt needed).

Classification runs in a dedicated throwaway session that is deleted after each call. The classifier session cannot invoke `bash`, `edit`, `write`, `create`, `delete`, `webfetch`, or `task`.

## Installation

As an npm plugin:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@common-creation/opencode-plugin-automode"]
}
```

Or load it directly from a local build (e.g. `dist/index.js`) via a path spec in your `opencode.json`.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `OPENCODE_AUTOMODE_ENABLED` | `true` | Set to `false` to disable the plugin entirely. |
| `OPENCODE_AUTOMODE_MODEL` | *(auto)* | Classifier model in `provider/model` format (e.g. `opencode-go/deepseek-v4-flash`). Defaults to the model of the calling session, then to the configured default model. |
| `OPENCODE_AUTOMODE_FAIL_MODE` | `closed` | `closed` = block when the classifier fails or times out (fail-closed). `open` = allow in that case (fail-open). |
| `OPENCODE_AUTOMODE_TIMEOUT_MS` | `30000` | Timeout for a single classification call. |
| `OPENCODE_AUTOMODE_MAX_RETRIES` | `2` | Extra attempts when the classifier response is not valid JSON. |
| `OPENCODE_AUTOMODE_LOG_PATH` | *(empty)* | File to write plugin logs to (one JSON object per line). Empty disables file logging. |

## Security notes

- This is a **guardrail, not a sandbox**. A malicious agent or prompt-injected content is not stopped by this plugin.
- The classifier only sees the bare command (no assistant prose or tool outputs), which reduces rationalization and prompt-injection attacks on the classifier itself.
- Commands touching paths outside the project are still subject to OpenCode's own permission system (e.g. `external_directory` prompts).
- In-project destructive operations (e.g. `rm -rf` of a project subdirectory) may be classified as safe, as they are routine development cleanup. Tune expectations per your threat model.

## Development

```sh
bun install
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
bun test            # unit tests for the JSON parser
bun run scripts/manual-test.ts  # boots a server and classifies a battery of safe/dangerous commands
```

The manual test exits non-zero if any command is misclassified. It needs a working OpenCode install with authentication; set `AUTOMODE_MODEL` to choose the classifier model (defaults to `opencode-go/deepseek-v4-flash`).

## License

MIT
