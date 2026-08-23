import { describe, expect, test } from "bun:test"
import {
  ClassificationError,
  buildPrompt,
  createClassifierEngine,
  type ClassifierTransport,
} from "../src/engine.js"
import type { ModelSpec } from "../src/engine.js"

type TransportStub = ClassifierTransport & {
  directory: () => Promise<string | null>
  resolveModel: (callerSessionID?: string) => Promise<ModelSpec | null>
  createSession: (model: ModelSpec | null) => Promise<string>
  prompt: (sessionID: string, model: ModelSpec | null, promptText: string) => Promise<string>
  disposeSession: (sessionID: string) => Promise<void>
}

function stubTransport(overrides: Partial<TransportStub> = {}): TransportStub & { created: string[]; disposed: string[] } {
  const created: string[] = []
  const disposed: string[] = []
  return {
    created,
    disposed,
    directory: async () => "/work",
    resolveModel: async () => ({ providerID: "p", modelID: "m" }),
    createSession: async (model) => {
      void model
      const id = `ses_${created.length}`
      created.push(id)
      return id
    },
    prompt: async (_sessionID, _model, _promptText) => '{"allowed": true, "reason": "ok"}',
    disposeSession: async (sessionID) => {
      disposed.push(sessionID)
    },
    ...overrides,
  }
}

describe("buildPrompt", () => {
  test("includes working directory when available", () => {
    const text = buildPrompt("/work", "ls")
    expect(text).toContain("Working directory: /work")
    expect(text).toContain("Command:\nls")
    expect(text).not.toContain("not valid JSON")
  })

  test("omits working directory when unavailable and includes retry hint", () => {
    const text = buildPrompt(null, "ls", "garbage output")
    expect(text).not.toContain("Working directory:")
    expect(text).toContain("Your previous response was not valid JSON")
    expect(text).toContain("garbage output")
  })
})

describe("createClassifierEngine", () => {
  test("returns the verdict on a parseable first response", async () => {
    const transport = stubTransport()
    const engine = createClassifierEngine({ transport, timeoutMs: 1000, maxRetries: 2 })
    const verdict = await engine.classify("ls -la", "ses_caller")
    expect(verdict.allowed).toBe(true)
    expect(verdict.reason).toBe("ok")
    expect(transport.created).toHaveLength(1)
    expect(transport.disposed).toEqual(transport.created)
  })

  test("retries with the previous response as hint when unparseable", async () => {
    const prompts: string[] = []
    let call = 0
    const transport = stubTransport({
      prompt: async (_s, _m, promptText) => {
        prompts.push(promptText)
        call++
        return call === 1 ? "I think it is fine" : '{"allowed": false, "reason": "no"}'
      },
    })
    const engine = createClassifierEngine({ transport, timeoutMs: 1000, maxRetries: 2 })
    const verdict = await engine.classify("ls")
    expect(verdict.allowed).toBe(false)
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain("I think it is fine")
    expect(transport.created).toHaveLength(2)
  })

  test("throws ClassificationError after exhausting attempts on persistent failures", async () => {
    const transport = stubTransport({
      prompt: async () => {
        throw new Error("boom")
      },
    })
    const engine = createClassifierEngine({ transport, timeoutMs: 1000, maxRetries: 2 })
    let error: unknown
    try {
      await engine.classify("ls")
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ClassificationError)
    expect((error as Error).message).toContain("3 attempt(s)")
    expect((error as Error).message).toContain("boom")
    expect(engine.isInfraError(error)).toBe(true)
    expect(transport.created).toHaveLength(3)
  })

  test("does not retry when session creation fails", async () => {
    let creations = 0
    const transport = stubTransport({
      createSession: async () => {
        creations++
        throw new Error("no server")
      },
    })
    const engine = createClassifierEngine({ transport, timeoutMs: 1000, maxRetries: 2 })
    let error: unknown
    try {
      await engine.classify("ls")
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("no server")
    expect(engine.isInfraError(error)).toBe(false)
    expect(creations).toBe(1)
  })

  test("keeps classifying when disposal throws", async () => {
    const transport = stubTransport({
      disposeSession: async () => {
        throw new Error("dispose failed")
      },
    })
    const engine = createClassifierEngine({ transport, timeoutMs: 1000, maxRetries: 1 })
    const verdict = await engine.classify("git status")
    expect(verdict.allowed).toBe(true)
  })

  test("isInfraError is false for plain errors", async () => {
    const transport = stubTransport()
    const engine = createClassifierEngine({ transport, timeoutMs: 1000, maxRetries: 0 })
    expect(engine.isInfraError(new Error("x"))).toBe(false)
    expect(engine.isInfraError(null)).toBe(false)
  })
})
