export type Verdict = {
  allowed: boolean
  reason: string
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim()

  try {
    const parsed = JSON.parse(cleaned) as unknown
    if (isRecord(parsed)) return parsed
  } catch {
    // fall through to the block extraction below
  }

  const block = cleaned.match(/\{[\s\S]*\}/)
  if (block) {
    try {
      const parsed = JSON.parse(block[0]) as unknown
      if (isRecord(parsed)) return parsed
    } catch {
      return null
    }
  }

  return null
}

export function parseVerdict(text: string): Verdict | null {
  const obj = extractJsonObject(text)
  if (!obj) return null
  if (typeof obj.allowed !== "boolean") return null
  const reason = typeof obj.reason === "string" ? obj.reason : ""
  return { allowed: obj.allowed, reason }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
