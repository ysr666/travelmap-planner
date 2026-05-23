import { describe, expect, it } from 'vitest'
import {
  AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS,
  AI_DRAFT_MAX_OUTPUT_TOKENS_HINT,
  AI_DRAFT_MAX_PROMPT_CHARS,
} from './aiDraftLimits'
import { MAX_AI_FREE_TEXT_LENGTH } from '../../src/lib/providerProxyContract'

describe('ai draft limits', () => {
  it('constants are positive integers', () => {
    expect(AI_DRAFT_MAX_PROMPT_CHARS).toBeGreaterThan(0)
    expect(Number.isInteger(AI_DRAFT_MAX_PROMPT_CHARS)).toBe(true)
    expect(AI_DRAFT_MAX_OUTPUT_TOKENS_HINT).toBeGreaterThan(0)
    expect(Number.isInteger(AI_DRAFT_MAX_OUTPUT_TOKENS_HINT)).toBe(true)
    expect(AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS).toBeGreaterThan(0)
    expect(Number.isInteger(AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS)).toBe(true)
  })

  it('embed limit is stricter than contract free text limit', () => {
    expect(AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS).toBeLessThanOrEqual(MAX_AI_FREE_TEXT_LENGTH)
  })
})
