import { validateAiTripDraft, type AiTripDraft } from '../../src/lib/ai/aiTripDraft'
import { extractJsonFromAiText } from './aiJson'

export type AiDraftExtractionResult =
  | { ok: true; draft: AiTripDraft }
  | { ok: false; errorCode: 'invalid_response'; message: string }

export function extractAiDraftJson(rawText: string): unknown | null {
  const parsed = extractJsonFromAiText(rawText)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
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
