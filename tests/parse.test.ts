import { describe, expect, test } from "bun:test"
import { extractJsonObject, parseVerdict } from "../src/parse"

describe("extractJsonObject", () => {
  test("parses plain json", () => {
    expect(extractJsonObject('{"allowed": true, "reason": "ok"}')).toEqual({ allowed: true, reason: "ok" })
  })

  test("parses json inside a code fence", () => {
    const text = '```json\n{"allowed": false, "reason": "bad"}\n```'
    expect(extractJsonObject(text)).toEqual({ allowed: false, reason: "bad" })
  })

  test("parses json surrounded by prose", () => {
    const text = 'Sure, here you go:\n{"allowed": true, "reason": "read only"}'
    expect(extractJsonObject(text)).toEqual({ allowed: true, reason: "read only" })
  })

  test("returns null for non-object json", () => {
    expect(extractJsonObject("[1, 2, 3]")).toBeNull()
  })

  test("returns null for invalid text", () => {
    expect(extractJsonObject("not json at all")).toBeNull()
  })

  test("returns null for empty text", () => {
    expect(extractJsonObject("")).toBeNull()
  })
})

describe("parseVerdict", () => {
  test("returns a verdict", () => {
    expect(parseVerdict('{"allowed": true, "reason": "safe"}')).toEqual({ allowed: true, reason: "safe" })
  })

  test("returns a false verdict", () => {
    expect(parseVerdict('{"allowed": false, "reason": "rm -rf /"}')).toEqual({
      allowed: false,
      reason: "rm -rf /",
    })
  })

  test("defaults reason to empty string when missing", () => {
    expect(parseVerdict('{"allowed": true}')).toEqual({ allowed: true, reason: "" })
  })

  test("returns null when allowed is not a boolean", () => {
    expect(parseVerdict('{"allowed": "yes", "reason": "x"}')).toBeNull()
  })

  test("returns null on invalid json", () => {
    expect(parseVerdict('{"allowed": tru}')).toBeNull()
  })
})
