import { describe, expect, test } from "bun:test"
import { envOverlayFromOptions } from "../src/options.js"

describe("envOverlayFromOptions", () => {
  test("maps the environment record into an env overlay", () => {
    const overlay = envOverlayFromOptions({
      environment: {
        OPENCODE_AUTOMODE_LOG_PATH: "/tmp/automode.log",
        OPENCODE_AUTOMODE_FAIL_MODE: "open",
      },
    })
    expect(overlay).toEqual({
      OPENCODE_AUTOMODE_LOG_PATH: "/tmp/automode.log",
      OPENCODE_AUTOMODE_FAIL_MODE: "open",
    })
  })

  test("ignores keys outside the plugin namespace", () => {
    const overlay = envOverlayFromOptions({
      environment: {
        HOME: "/evil",
        PATH: "/evil",
        OPENCODE_OTHER: "x",
      },
    })
    expect(overlay).toEqual({})
  })

  test("stringifies numbers and booleans, drops null and unknown types", () => {
    const overlay = envOverlayFromOptions({
      environment: {
        OPENCODE_AUTOMODE_ENABLED: true,
        OPENCODE_AUTOMODE_TIMEOUT_MS: 1500,
        OPENCODE_AUTOMODE_MODEL: null,
      },
      log_path: 42,
    })
    expect(overlay).toEqual({
      OPENCODE_AUTOMODE_ENABLED: "true",
      OPENCODE_AUTOMODE_TIMEOUT_MS: "1500",
      OPENCODE_AUTOMODE_LOG_PATH: "42",
    })
  })

  test("accepts direct snake_case aliases", () => {
    const overlay = envOverlayFromOptions({
      enabled: false,
      model: "opencode-go/deepseek-v4-flash",
      fail_mode: "open",
      timeout_ms: 500,
      max_retries: 0,
      log_path: "/var/log/automode.jsonl",
    })
    expect(overlay).toEqual({
      OPENCODE_AUTOMODE_ENABLED: "false",
      OPENCODE_AUTOMODE_MODEL: "opencode-go/deepseek-v4-flash",
      OPENCODE_AUTOMODE_FAIL_MODE: "open",
      OPENCODE_AUTOMODE_TIMEOUT_MS: "500",
      OPENCODE_AUTOMODE_MAX_RETRIES: "0",
      OPENCODE_AUTOMODE_LOG_PATH: "/var/log/automode.jsonl",
    })
  })

  test("treats empty strings as unset so defaults apply", () => {
    const overlay = envOverlayFromOptions({ log_path: "   ", environment: { OPENCODE_AUTOMODE_MODEL: "" } })
    expect(overlay).toEqual({})
  })

  test("returns an empty overlay for malformed options", () => {
    expect(envOverlayFromOptions(undefined)).toEqual({})
    expect(envOverlayFromOptions(null)).toEqual({})
    expect(envOverlayFromOptions("string")).toEqual({})
    expect(envOverlayFromOptions([1, 2])).toEqual({})
    expect(envOverlayFromOptions({ environment: "not-an-object" })).toEqual({})
    expect(envOverlayFromOptions({ environment: ["a"] })).toEqual({})
  })
})
