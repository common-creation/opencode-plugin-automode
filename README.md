# @common-creation/opencode-plugin-automode

An [OpenCode](https://opencode.ai) plugin that acts as a safety classifier for the shell tool: every command is judged by an LLM before it runs — safe commands are allowed, dangerous ones are rejected.

Works with **both OpenCode 1.x and OpenCode 2.x (beta)** from a single package. The same module exposes a V1 `server` entry point and a V2 `setup` entry point, and each OpenCode generation picks the one it understands.

> **日本語版はこちら**: [README.ja.md](README.ja.md)

## How it works

1. The plugin hooks `tool.execute.before` and intercepts every shell call (`bash` in OpenCode 1.x, `shell` in OpenCode 2.x).
2. The command is sent to an LLM with a system prompt describing what counts as safe vs. dangerous.
3. The LLM replies with a JSON verdict: `{"allowed": true|false, "reason": "..."}`.
4. `allowed: true` → the command runs as usual.
5. `allowed: false` → the tool call is rejected with an error the agent can react to (no user prompt needed).

Classification runs in a dedicated throwaway session that is deleted after each call (best-effort on OpenCode 2.x). The classifier session cannot invoke any tools: on V1 its request disables them explicitly; on V2 a session hook pins the classifier system prompt and strips every tool before model dispatch.

## Installation

### OpenCode 1.x

Install with the CLI:

```sh
opencode plugin add @common-creation/opencode-plugin-automode
```

or add it manually:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@common-creation/opencode-plugin-automode"]
}
```

### OpenCode 2.x (beta)

Requires OpenCode 2 plugin API beta. Install with:

```sh
opencode2 plugin add @common-creation/opencode-plugin-automode
```

or add it manually:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@common-creation/opencode-plugin-automode"]
}
```

A local build can also be loaded by path in either version, e.g.
`"plugin"/"plugins": ["./node_modules/@common-creation/opencode-plugin-automode/dist/index.js"]`.

### Version differences

| | OpenCode 1.x | OpenCode 2.x (beta) |
|---|---|---|
| Hooked tool | `bash` | `shell` |
| Model resolution | caller session → config → none | `OPENCODE_AUTOMODE_MODEL` env → catalog default |
| Server-side logging | `app.log` | file logger only |
| Classifier session cleanup | deleted | best-effort (`session.remove`) |

## Configuration

Environment variables may not reach the plugin: OpenCode 2.x runs the server as
a background service that inherits the environment of whatever process happened
to spawn it. Prefer plugin options, which travel with the config entry:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@common-creation/opencode-plugin-automode",
      "options": {
        "environment": {
          "OPENCODE_AUTOMODE_LOG_PATH": "/tmp/automode.log"
        }
      }
    }
  ]
}
```

Each key under `options.environment` must be an `OPENCODE_AUTOMODE_*` variable.
Direct snake_case aliases are also accepted and take precedence over both the
environment map and ambient environment variables:

```json
{ "package": "@common-creation/opencode-plugin-automode", "options": { "log_path": "/tmp/automode.log" } }
```

`log_path` accepts a leading `~`, which resolves to the user's home directory
(with either `/` or `\` separators, since OpenCode can run directly on Windows),
so logs can live next to OpenCode's own:

```json
{ "package": "@common-creation/opencode-plugin-automode", "options": { "log_path": "~/.local/share/opencode/log/automode.log" } }
```

The file logger writes every level (`debug`, `info`, `warn`, `error`) as JSONL;
it has no level filter.

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
bun test            # unit tests (JSON parser, logger, classifier engine)
bun run scripts/manual-test.ts  # boots a server and classifies a battery of safe/dangerous commands
```

The manual test exits non-zero if any command is misclassified. It needs a working OpenCode install with authentication; set `AUTOMODE_MODEL` to choose the classifier model (defaults to `opencode-go/deepseek-v4-flash`).

## License

MIT
