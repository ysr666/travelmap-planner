import { describe, expect, it } from 'vitest'
import {
  buildAiTripDraftRequest,
  validateAiTripDraftRequest,
  summarizeAiTripDraftRequest,
  type AiTripDraftRequest,
} from './aiTripDraftRequest'

const validRequest: AiTripDraftRequest = {
  destination: '东京',
  startDate: '2025-04-01',
  endDate: '2025-04-05',
}

describe('buildAiTripDraftRequest', () => {
  it('builds request from raw input', () => {
    const result = buildAiTripDraftRequest({
      destination: '  东京  ',
      startDate: '2025-04-01',
      endDate: '2025-04-05',
    })
    expect(result.destination).toBe('东京')
    expect(result.startDate).toBe('2025-04-01')
    expect(result.endDate).toBe('2025-04-05')
  })

  it('applies profile defaults for pace and transport', () => {
    const result = buildAiTripDraftRequest(
      { destination: '东京', startDate: '2025-04-01', endDate: '2025-04-05' },
      { pace: 'relaxed', preferTransport: 'walking' },
    )
    expect(result.pace).toBe('relaxed')
    expect(result.preferTransport).toBe('walking')
  })

  it('input values override profile defaults', () => {
    const result = buildAiTripDraftRequest(
      { destination: '东京', startDate: '2025-04-01', endDate: '2025-04-05', pace: 'compact' },
      { pace: 'relaxed', preferTransport: 'walking' },
    )
    expect(result.pace).toBe('compact')
  })

  it('returns empty strings for missing fields', () => {
    const result = buildAiTripDraftRequest({})
    expect(result.destination).toBe('')
    expect(result.startDate).toBe('')
    expect(result.endDate).toBe('')
  })
})

describe('validateAiTripDraftRequest', () => {
  it('accepts valid request', () => {
    const result = validateAiTripDraftRequest(validRequest)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.request).toBeDefined()
  })

  it('rejects empty destination', () => {
    const result = validateAiTripDraftRequest({ ...validRequest, destination: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'destination')).toBe(true)
  })

  it('rejects non-padded date', () => {
    const result = validateAiTripDraftRequest({ ...validRequest, startDate: '2025-4-1' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'startDate')).toBe(true)
  })

  it('rejects full ISO datetime', () => {
    const result = validateAiTripDraftRequest({ ...validRequest, startDate: '2025-04-01T00:00:00Z' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'startDate')).toBe(true)
  })

  it('rejects impossible date', () => {
    const result = validateAiTripDraftRequest({ ...validRequest, startDate: '2025-02-30' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'startDate')).toBe(true)
  })

  it('rejects end before start', () => {
    const result = validateAiTripDraftRequest({ ...validRequest, startDate: '2025-04-10', endDate: '2025-04-01' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'endDate')).toBe(true)
    expect(result.errors.some((e) => e.message.includes('早于'))).toBe(true)
  })

  it('rejects days > 120', () => {
    const result = validateAiTripDraftRequest({ ...validRequest, startDate: '2025-01-01', endDate: '2025-12-31' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'endDate')).toBe(true)
  })

  it('rejects invalid pace', () => {
    const result = validateAiTripDraftRequest({ ...validRequest, pace: 'ultra' as 'relaxed' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'pace')).toBe(true)
  })

  it('rejects invalid transport', () => {
    const result = validateAiTripDraftRequest({ ...validRequest, preferTransport: 'helicopter' as 'mixed' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'preferTransport')).toBe(true)
  })

  it('rejects free text too long', () => {
    const result = validateAiTripDraftRequest({
      ...validRequest,
      freeTextRequirement: 'x'.repeat(2001),
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'freeTextRequirement')).toBe(true)
  })

  it('accepts valid optional fields', () => {
    const result = validateAiTripDraftRequest({
      ...validRequest,
      pace: 'relaxed',
      preferTransport: 'walking',
      mustVisitText: '浅草寺',
      avoidText: '不要购物商场',
      freeTextRequirement: '带老人出行',
    })
    expect(result.valid).toBe(true)
  })
})

describe('summarizeAiTripDraftRequest', () => {
  it('returns summary string', () => {
    const summary = summarizeAiTripDraftRequest(validRequest)
    expect(summary).toContain('东京')
    expect(summary).toContain('2025-04-01')
    expect(summary).toContain('5天')
  })
})
