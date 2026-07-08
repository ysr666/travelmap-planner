import { describe, expect, it } from 'vitest'
import { extractAiDraftJson, normalizeAiDraftProviderOutput } from './aiDraftResponse'

const VALID_DRAFT_JSON = JSON.stringify({
  title: '东京之旅',
  destination: '东京',
  startDate: '2025-04-01',
  endDate: '2025-04-03',
  days: [
    { date: '2025-04-01', items: [{ title: '浅草寺' }] },
    { date: '2025-04-02', items: [{ title: '明治神宫' }] },
    { date: '2025-04-03', items: [{ title: '涩谷' }] },
  ],
})

describe('extractAiDraftJson', () => {
  it('parses pure JSON string', () => {
    const result = extractAiDraftJson(VALID_DRAFT_JSON)
    expect(result).not.toBeNull()
    expect((result as Record<string, unknown>).title).toBe('东京之旅')
  })

  it('parses ```json fenced block', () => {
    const result = extractAiDraftJson('```json\n' + VALID_DRAFT_JSON + '\n```')
    expect(result).not.toBeNull()
    expect((result as Record<string, unknown>).title).toBe('东京之旅')
  })

  it('parses fenced block without json tag', () => {
    const result = extractAiDraftJson('```\n' + VALID_DRAFT_JSON + '\n```')
    expect(result).not.toBeNull()
  })

  it('handles leading/trailing whitespace', () => {
    const result = extractAiDraftJson('  \n  ' + VALID_DRAFT_JSON + '  \n  ')
    expect(result).not.toBeNull()
  })

  it('handles markdown preamble before fenced block', () => {
    const result = extractAiDraftJson('Here is the draft:\n\n```json\n' + VALID_DRAFT_JSON + '\n```')
    expect(result).not.toBeNull()
  })

  it('returns null for non-JSON text', () => {
    expect(extractAiDraftJson('This is not JSON')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractAiDraftJson('')).toBeNull()
  })

  it('returns null for whitespace only', () => {
    expect(extractAiDraftJson('   ')).toBeNull()
  })

  it('returns null for incomplete JSON', () => {
    expect(extractAiDraftJson('{"title": "test"')).toBeNull()
  })

  it('returns null for JSON array instead of object', () => {
    expect(extractAiDraftJson('[1, 2, 3]')).toBeNull()
  })
})

describe('normalizeAiDraftProviderOutput', () => {
  it('returns valid draft for correct JSON', () => {
    const result = normalizeAiDraftProviderOutput(VALID_DRAFT_JSON)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.draft.title).toBe('东京之旅')
      expect(result.draft.days).toHaveLength(3)
    }
  })

  it('returns invalid_response for non-JSON', () => {
    const result = normalizeAiDraftProviderOutput('not json at all')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('invalid_response')
      expect(result.message).toContain('解析')
    }
  })

  it('extracts JSON from provider text wrappers', () => {
    const result = normalizeAiDraftProviderOutput(`
Here is the itinerary JSON:
{
  "title": "东京之旅",
  "destination": "东京",
  "startDate": "2025-04-01",
  "endDate": "2025-04-01",
  "days": [{ "date": "2025-04-01", "items": [{ "title": "浅草寺" }] }]
}
`)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.draft.days).toHaveLength(1)
    }
  })

  it('returns invalid_response for JSON that fails validateAiTripDraft', () => {
    const result = normalizeAiDraftProviderOutput('{"title": ""}')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('invalid_response')
      expect(result.message).toContain('格式')
    }
  })

  it('returns invalid_response for empty JSON object', () => {
    const result = normalizeAiDraftProviderOutput('{}')
    expect(result.ok).toBe(false)
  })

  it('error messages do not contain raw input text', () => {
    const sensitiveInput = 'SENSITIVE_DATA_' + 'x'.repeat(100)
    const result = normalizeAiDraftProviderOutput(sensitiveInput)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).not.toContain('SENSITIVE_DATA')
    }
  })

  it('valid draft from fenced block passes extraction', () => {
    const result = normalizeAiDraftProviderOutput('Here is the draft:\n```json\n' + VALID_DRAFT_JSON + '\n```')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.draft.destination).toBe('东京')
    }
  })
})
