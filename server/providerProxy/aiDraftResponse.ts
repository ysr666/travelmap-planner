import { validateAiTripDraft, type AiTripDraft } from '../../src/lib/ai/aiTripDraft'

export type AiDraftExtractionResult =
  | { ok: true; draft: AiTripDraft }
  | { ok: false; errorCode: 'invalid_response'; message: string }

export function extractAiDraftJson(rawText: string): unknown | null {
  const trimmed = rawText.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{')) {
    return tryParseJson(trimmed)
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fencedMatch?.[1]) {
    return tryParseJson(fencedMatch[1].trim())
  }

  return null
}

export function normalizeAiDraftProviderOutput(rawText: string): AiDraftExtractionResult {
  const parsed = extractAiDraftJson(rawText)
  if (parsed === null) {
    return { ok: false, errorCode: 'invalid_response', message: 'AI 草稿输出无法解析为 JSON。' }
  }

  const validation = validateAiTripDraft(parsed)
  if (!validation.valid || !validation.draft) {
    return { ok: false, errorCode: 'invalid_response', message: 'AI 草稿输出不符合预期格式。' }
  }

  return { ok: true, draft: validation.draft }
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
