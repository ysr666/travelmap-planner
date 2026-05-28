import { describe, expect, it } from 'vitest'
import { generateMockAiTripDraft } from './aiTripDraftMock'
import { validateAiTripDraft } from './aiTripDraft'
import type { AiTripDraftRequest } from './aiTripDraftRequest'

const validRequest: AiTripDraftRequest = {
  destination: '东京',
  startDate: '2025-04-01',
  endDate: '2025-04-05',
}

describe('generateMockAiTripDraft', () => {
  it('generates a draft that passes validateAiTripDraft', () => {
    const draft = generateMockAiTripDraft(validRequest)
    const result = validateAiTripDraft(draft)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('has correct title and destination', () => {
    const draft = generateMockAiTripDraft(validRequest)
    expect(draft.title).toBe('东京之旅')
    expect(draft.destination).toBe('东京')
  })

  it('has correct date range', () => {
    const draft = generateMockAiTripDraft(validRequest)
    expect(draft.startDate).toBe('2025-04-01')
    expect(draft.endDate).toBe('2025-04-05')
  })

  it('generates correct number of days', () => {
    const draft = generateMockAiTripDraft(validRequest)
    expect(draft.days).toHaveLength(5)
  })

  it('each day has 2-4 items', () => {
    const draft = generateMockAiTripDraft(validRequest)
    for (const day of draft.days) {
      expect(day.items.length).toBeGreaterThanOrEqual(2)
      expect(day.items.length).toBeLessThanOrEqual(4)
    }
  })

  it('is deterministic - same input produces same output', () => {
    const draft1 = generateMockAiTripDraft(validRequest)
    const draft2 = generateMockAiTripDraft(validRequest)
    expect(draft1).toEqual(draft2)
  })

  it('different destinations produce different drafts', () => {
    const draft1 = generateMockAiTripDraft(validRequest)
    const draft2 = generateMockAiTripDraft({ ...validRequest, destination: '巴黎' })
    expect(draft1.title).not.toBe(draft2.title)
  })

  it('single day trip works', () => {
    const draft = generateMockAiTripDraft({
      ...validRequest,
      startDate: '2025-04-01',
      endDate: '2025-04-01',
    })
    expect(draft.days).toHaveLength(1)
    const result = validateAiTripDraft(draft)
    expect(result.valid).toBe(true)
  })

  it('has no tickets, routes, cloud, or provider fields', () => {
    const draft = generateMockAiTripDraft(validRequest)
    const draftRecord = draft as Record<string, unknown>
    expect(draftRecord).not.toHaveProperty('tickets')
    expect(draftRecord).not.toHaveProperty('ticketMetas')
    expect(draftRecord).not.toHaveProperty('ticketBlobs')
    expect(draftRecord).not.toHaveProperty('routeCache')
    expect(draftRecord).not.toHaveProperty('cloud')
    expect(draftRecord).not.toHaveProperty('provider')
    expect(draftRecord).not.toHaveProperty('aiMetadata')

    for (const day of draft.days) {
      for (const item of day.items) {
        const itemRecord = item as Record<string, unknown>
        expect(itemRecord).not.toHaveProperty('tickets')
        expect(itemRecord).not.toHaveProperty('route')
      }
    }
  })
})
