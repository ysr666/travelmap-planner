import { describe, expect, it } from 'vitest'
import {
  validateAiTripDraft,
  normalizeAiTripDraft,
  summarizeAiTripDraft,
  convertAiTripDraftToImportData,
} from './aiTripDraft'

const validDraft = {
  title: '东京五日游',
  destination: '东京',
  startDate: '2025-04-01',
  endDate: '2025-04-05',
  days: [
    {
      date: '2025-04-01',
      title: '第一天',
      items: [
        {
          title: '浅草寺',
          locationName: '浅草寺',
          address: '东京都台东区浅草2-3-1',
          lat: 35.7148,
          lng: 139.7967,
          startTime: '10:00',
          endTime: '12:00',
          note: '参观雷门',
        },
        {
          title: '东京晴空塔',
          startTime: '14:00',
          previousTransportMode: 'transit',
        },
      ],
    },
    {
      date: '2025-04-02',
      title: '第二天',
      items: [
        {
          title: '明治神宫',
          lat: 35.6764,
          lng: 139.6993,
        },
      ],
    },
  ],
}

describe('validateAiTripDraft', () => {
  it('validates a correct draft', () => {
    const result = validateAiTripDraft(validDraft)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.draft).toBeDefined()
  })

  it('rejects non-object input', () => {
    const result = validateAiTripDraft('invalid')
    expect(result.valid).toBe(false)
    expect(result.errors[0].path).toBe('root')
  })

  it('rejects empty title', () => {
    const result = validateAiTripDraft({ ...validDraft, title: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'title')).toBe(true)
  })

  it('rejects non-padded date', () => {
    const result = validateAiTripDraft({ ...validDraft, startDate: '2025-4-1' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'startDate')).toBe(true)
  })

  it('rejects full ISO datetime', () => {
    const result = validateAiTripDraft({ ...validDraft, startDate: '2025-04-01T00:00:00Z' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'startDate')).toBe(true)
  })

  it('rejects impossible date', () => {
    const result = validateAiTripDraft({ ...validDraft, startDate: '2025-02-30' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'startDate')).toBe(true)
  })

  it('rejects end date before start date', () => {
    const result = validateAiTripDraft({ ...validDraft, endDate: '2025-03-01' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'endDate')).toBe(true)
  })

  it('rejects invalid time', () => {
    const draft = { ...validDraft, days: [{ date: '2025-04-01', items: [{ title: 'Test', startTime: '25:00' }] }] }
    const result = validateAiTripDraft(draft)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path.includes('startTime'))).toBe(true)
  })

  it('rejects unknown transport mode', () => {
    const draft = { ...validDraft, days: [{ date: '2025-04-01', items: [{ title: 'Test', previousTransportMode: 'helicopter' }] }] }
    const result = validateAiTripDraft(draft)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path.includes('previousTransportMode'))).toBe(true)
  })

  it('rejects oversized draft', () => {
    const days = Array.from({ length: 121 }, (_, i) => ({
      date: `2025-04-${String(i + 1).padStart(2, '0')}`,
      items: [{ title: 'Test' }],
    }))
    const result = validateAiTripDraft({ ...validDraft, days })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'days')).toBe(true)
  })

  it('rejects invalid coordinates', () => {
    const draft = { ...validDraft, days: [{ date: '2025-04-01', items: [{ title: 'Test', lat: 91, lng: 0 }] }] }
    const result = validateAiTripDraft(draft)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path.includes('lat'))).toBe(true)
  })

  it('rejects days outside trip date range', () => {
    const draft = { ...validDraft, days: [{ date: '2025-03-01', items: [{ title: 'Test' }] }] }
    const result = validateAiTripDraft(draft)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('日期不在旅行日期范围内'))).toBe(true)
  })
})

describe('normalizeAiTripDraft', () => {
  it('returns normalized draft for valid input', () => {
    const draft = normalizeAiTripDraft(validDraft)
    expect(draft).not.toBeNull()
    expect(draft!.title).toBe('东京五日游')
    expect(draft!.days).toHaveLength(2)
  })

  it('returns null for invalid input', () => {
    const draft = normalizeAiTripDraft({ title: '' })
    expect(draft).toBeNull()
  })
})

describe('summarizeAiTripDraft', () => {
  it('returns correct summary', () => {
    const draft = normalizeAiTripDraft(validDraft)!
    const summary = summarizeAiTripDraft(draft)
    expect(summary.title).toBe('东京五日游')
    expect(summary.destination).toBe('东京')
    expect(summary.startDate).toBe('2025-04-01')
    expect(summary.endDate).toBe('2025-04-05')
    expect(summary.daysCount).toBe(2)
    expect(summary.itemsCount).toBe(3)
  })
})

describe('convertAiTripDraftToImportData', () => {
  it('converts to import format', () => {
    const draft = normalizeAiTripDraft(validDraft)!
    const importData = convertAiTripDraftToImportData(draft)
    expect(importData.trip.title).toBe('东京五日游')
    expect(importData.days).toHaveLength(2)
    expect(importData.days[0].items).toHaveLength(2)
    expect(importData.days[0].items[0].lat).toBe(35.7148)
    expect(importData.days[0].items[1].previousTransportMode).toBe('transit')
  })

  it('does not include ticket/route/cloud fields', () => {
    const draft = normalizeAiTripDraft(validDraft)!
    const importData = convertAiTripDraftToImportData(draft)
    expect(importData).not.toHaveProperty('tickets')
    expect(importData).not.toHaveProperty('routeCache')
    expect(importData).not.toHaveProperty('cloud')
  })
})
