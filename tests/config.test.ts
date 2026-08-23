import { homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { expandHomePath, loadConfig } from "../src/config.js"

describe("expandHomePath", () => {
  test("expands a leading tilde to the home directory", () => {
    expect(expandHomePath("~/.local/share/opencode/log/automode.log")).toBe(
      join(homedir(), ".local/share/opencode/log/automode.log"),
    )
  })

  test("expands a bare tilde", () => {
    expect(expandHomePath("~")).toBe(homedir())
  })

  test("expands Windows-style backslash paths", () => {
    expect(expandHomePath("~\\.local\\share\\opencode\\log\\automode.log")).toBe(
      homedir() + "\\.local\\share\\opencode\\log\\automode.log",
    )
  })

  test("leaves absolute and relative paths untouched", () => {
    expect(expandHomePath("/tmp/automode.log")).toBe("/tmp/automode.log")
    expect(expandHomePath("logs/automode.log")).toBe("logs/automode.log")
  })

  test("does not expand mid-path or username tildes", () => {
    expect(expandHomePath("/tmp/~/automode.log")).toBe("/tmp/~/automode.log")
    expect(expandHomePath("/tmp\\~\\automode.log")).toBe("/tmp\\~\\automode.log")
    expect(expandHomePath("~root/x")).toBe("~root/x")
  })
})

describe("loadConfig logPath", () => {
  test("resolves tilde paths from the environment variable", () => {
    const config = loadConfig({ OPENCODE_AUTOMODE_LOG_PATH: "~/.local/share/opencode/log/automode.log" })
    expect(config.logPath).toBe(join(homedir(), ".local/share/opencode/log/automode.log"))
  })

  test("keeps an empty path empty", () => {
    expect(loadConfig({}).logPath).toBe("")
    expect(loadConfig({ OPENCODE_AUTOMODE_LOG_PATH: "   " }).logPath).toBe("")
  })
})
