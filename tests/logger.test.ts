import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "bun:test"
import { createLogger } from "../src/logger"

const dirs: string[] = []

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

function tempDir() {
  const dir = join(tmpdir(), `opencode-automode-logger-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  dirs.push(dir)
  return dir
}

describe("createLogger", () => {
  test("is a no-op when the path is empty", () => {
    const logger = createLogger("")
    expect(() => {
      logger.debug("debug message")
      logger.info("info message")
      logger.warn("warn message")
      logger.error("error message")
    }).not.toThrow()
  })

  test("is a no-op when the path is whitespace only", () => {
    const logger = createLogger("   ")
    expect(() => logger.info("info message")).not.toThrow()
  })

  test("appends JSON lines to the file", async () => {
    const dir = tempDir()
    const path = join(dir, "log.jsonl")
    const logger = createLogger(path)

    logger.info("hello", { key: "value" })
    logger.warn("uh oh", { command: "rm -rf /" })
    logger.debug("plain message")

    await new Promise((resolve) => setTimeout(resolve, 50))
    const content = await readFile(path, "utf8")
    const lines = content.trim().split("\n")

    expect(lines).toHaveLength(3)
    const first = JSON.parse(lines[0])
    expect(first.level).toBe("info")
    expect(first.message).toBe("hello")
    expect(first.extra).toEqual({ key: "value" })
    expect(typeof first.time).toBe("string")

    const second = JSON.parse(lines[1])
    expect(second.level).toBe("warn")
    expect(second.extra).toEqual({ command: "rm -rf /" })

    const third = JSON.parse(lines[2])
    expect(third.level).toBe("debug")
    expect(third.message).toBe("plain message")
    expect(third.extra).toBeUndefined()
  })

  test("creates the parent directory automatically", async () => {
    const dir = tempDir()
    const path = join(dir, "nested", "logs", "automode.jsonl")
    const logger = createLogger(path)

    logger.info("with nested dirs")

    await new Promise((resolve) => setTimeout(resolve, 50))
    const content = await readFile(path, "utf8")
    expect(JSON.parse(content.trim()).message).toBe("with nested dirs")
  })
})
