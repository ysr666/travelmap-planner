import { describe, expect, it } from 'vitest'
import {
  buildAiTripDraftPrompt,
  buildAiTripDraftProviderInput,
  summarizeAiDraftPromptInput,
} from './aiDraftPrompt'
import { AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS, AI_DRAFT_MAX_OUTPUT_TOKENS_HINT } from './aiDraftLimits'
import type { ProviderProxyAiTripDraftRequest } from '../../src/lib/ai/providerProxyContract'

function validRequest(overrides?: Partial<ProviderProxyAiTripDraftRequest>): ProviderProxyAiTripDraftRequest {
  return {
    destination: '东京',
    endDate: '2025-04-05',
    operation: 'ai_trip_draft',
    requestId: 'req-1',
    startDate: '2025-04-01',
    ...overrides,
  }
}

describe('buildAiTripDraftPrompt', () => {
  it('contains destination and date range', () => {
    const prompt = buildAiTripDraftPrompt(validRequest())
    expect(prompt).toContain('东京')
    expect(prompt).toContain('2025-04-01')
    expect(prompt).toContain('2025-04-05')
    expect(prompt).toContain('5-day')
  })

  it('contains YYYY-MM-DD and HH:mm format instructions', () => {
    const prompt = buildAiTripDraftPrompt(validRequest())
    expect(prompt).toContain('YYYY-MM-DD')
    expect(prompt).toContain('HH:mm')
  })

  it('contains forbidden field exclusions', () => {
    const prompt = buildAiTripDraftPrompt(validRequest())
    expect(prompt).toContain('tickets')
    expect(prompt).toContain('routes')
    expect(prompt).toContain('cloud')
    expect(prompt).toContain('provider metadata')
    expect(prompt).toContain('transit line numbers')
  })

  it('contains JSON-only instruction', () => {
    const prompt = buildAiTripDraftPrompt(validRequest())
    expect(prompt).toContain('ONLY valid JSON')
    expect(prompt).toContain('No markdown')
  })

  it('requests structured builder fields for days, items, transport, and tips', () => {
    const prompt = buildAiTripDraftPrompt(validRequest())
    expect(prompt).toContain('optional "tips" string array')
    expect(prompt).toContain('previousTransportDurationMinutes')
    expect(prompt).toContain('previousTransportNote')
    expect(prompt).toContain('Every day should have a theme title')
    expect(prompt).toContain('specific place names')
    expect(prompt).toContain('transportation suggestions between adjacent items')
  })

  it('uses compact mode for long trips to avoid truncated provider output', () => {
    const prompt = buildAiTripDraftPrompt(validRequest({
      endDate: '2025-04-12',
    }))

    expect(prompt).toContain('Long trip compact mode')
    expect(prompt).toContain('Use at most 2 items per day')
    expect(prompt).toContain('Omit "tips" unless essential')
    expect(prompt).not.toContain('1-3 practical daily tips')
  })

  it('truncates free text fields to embed limit', () => {
    const longText = 'x'.repeat(AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS + 100)
    const prompt = buildAiTripDraftPrompt(validRequest({
      mustVisitText: longText,
      avoidText: longText,
      freeTextRequirement: longText,
    }))
    const embeddedCount = (prompt.match(/x+/g) || [])
      .map(m => m[0] === 'x' ? m.length : 0)
      .filter(n => n > 10)
    for (const len of embeddedCount) {
      expect(len).toBeLessThanOrEqual(AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS)
    }
    expect(prompt).toContain('…')
  })

  it('does not include raw user free text beyond embed limit', () => {
    const longText = 'SENSITIVE_TEXT_'.repeat(100)
    const prompt = buildAiTripDraftPrompt(validRequest({ freeTextRequirement: longText }))
    expect(prompt).not.toContain(longText)
  })

  it('includes preferences when provided', () => {
    const prompt = buildAiTripDraftPrompt(validRequest({
      interestTags: ['美食', '博物馆'],
      interestText: '咖啡馆和建筑',
      pace: 'compact',
      partySize: 3,
      preferTransport: 'walking',
      mealTimeProtection: true,
    }))
    expect(prompt).toContain('紧凑')
    expect(prompt).toContain('步行')
    expect(prompt).toContain('protect meal times')
    expect(prompt).toContain('party size: 3')
    expect(prompt).toContain('interest tags: 美食, 博物馆')
    expect(prompt).toContain('Interest preferences: 咖啡馆和建筑')
  })

  it('omits optional fields when not provided', () => {
    const prompt = buildAiTripDraftPrompt(validRequest())
    expect(prompt).not.toContain('Must visit')
    expect(prompt).not.toContain('Avoid')
    expect(prompt).not.toContain('Additional requirements')
  })
})

describe('buildAiTripDraftProviderInput', () => {
  it('returns prompt and maxOutputTokens', () => {
    const input = buildAiTripDraftProviderInput(validRequest(), 'req-1')
    expect(input.prompt.length).toBeGreaterThan(0)
    expect(input.maxOutputTokens).toBe(AI_DRAFT_MAX_OUTPUT_TOKENS_HINT)
    expect(input.requestId).toBe('req-1')
  })
})

describe('summarizeAiDraftPromptInput', () => {
  it('contains destination and date range', () => {
    const summary = summarizeAiDraftPromptInput(validRequest())
    expect(summary).toContain('destination=东京')
    expect(summary).toContain('2025-04-01~2025-04-05')
    expect(summary).toContain('5 days')
  })

  it('does not contain free text content', () => {
    const summary = summarizeAiDraftPromptInput(validRequest({
      mustVisitText: 'SECRET_MUST_VISIT',
      avoidText: 'SECRET_AVOID',
      interestText: 'SECRET_INTEREST',
      freeTextRequirement: 'SECRET_FREE_TEXT',
    }))
    expect(summary).not.toContain('SECRET_MUST_VISIT')
    expect(summary).not.toContain('SECRET_AVOID')
    expect(summary).not.toContain('SECRET_INTEREST')
    expect(summary).not.toContain('SECRET_FREE_TEXT')
  })

  it('includes pace and transport when provided', () => {
    const summary = summarizeAiDraftPromptInput(validRequest({
      interestTags: ['美食', '博物馆'],
      interestText: '咖啡馆',
      pace: 'relaxed',
      partySize: 2,
      preferTransport: 'taxi',
    }))
    expect(summary).toContain('pace=relaxed')
    expect(summary).toContain('transport=taxi')
    expect(summary).toContain('partySize=2')
    expect(summary).toContain('interestTags=2')
    expect(summary).toContain('interestText=present')
  })
})
