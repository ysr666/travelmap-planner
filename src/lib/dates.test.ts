import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDateRange,
  formatShortDate,
  formatShortDateWithWeekday,
  getDayGenerationState,
  listExpectedTripDates,
} from './dates'
import type { Day, Trip } from '../types'

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    title: 'Test Trip',
    destination: 'Tokyo',
    startDate: '2025-04-01',
    endDate: '2025-04-03',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makeDay(overrides: Partial<Day> = {}): Day {
  return {
    id: 'day-1',
    tripId: 'trip-1',
    date: '2025-04-01',
    title: 'Day 1',
    sortOrder: 1,
    ...overrides,
  }
}

describe('formatDate', () => {
  it('formats a valid date in Chinese', () => {
    expect(formatDate('2025-04-01')).toBe('2025年4月1日')
  })

  it('returns fallback for invalid date', () => {
    expect(formatDate('invalid')).toBe('日期无效')
    expect(formatDate('2025-02-30')).toBe('日期无效')
  })
})

describe('formatShortDate', () => {
  it('formats month and day', () => {
    expect(formatShortDate('2025-04-01')).toBe('4月1日')
  })

  it('returns fallback for invalid date', () => {
    expect(formatShortDate('invalid')).toBe('未定')
  })
})

describe('formatShortDateWithWeekday', () => {
  it('formats a short date and weekday without browser timezone parsing', () => {
    expect(formatShortDateWithWeekday('2026-04-01')).toBe('4月1日 周三')
  })

  it('returns fallback for invalid date', () => {
    expect(formatShortDateWithWeekday('2026-04-01T00:00:00Z')).toBe('日期未定')
  })
})

describe('formatDateRange', () => {
  it('formats a valid range', () => {
    const result = formatDateRange('2025-04-01', '2025-04-03')
    expect(result).toContain('-')
  })

  it('returns fallback when start is invalid', () => {
    expect(formatDateRange('invalid', '2025-04-03')).toBe('日期未定')
  })

  it('returns fallback when end is invalid', () => {
    expect(formatDateRange('2025-04-01', 'invalid')).toBe('日期未定')
  })
})

describe('listExpectedTripDates', () => {
  it('returns all dates in range inclusive', () => {
    const dates = listExpectedTripDates(makeTrip({ startDate: '2025-04-01', endDate: '2025-04-03' }))
    expect(dates).toEqual(['2025-04-01', '2025-04-02', '2025-04-03'])
  })

  it('returns dates across DST-adjacent ranges without shifting', () => {
    const dates = listExpectedTripDates(makeTrip({ startDate: '2026-03-07', endDate: '2026-03-10' }))
    expect(dates).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'])
  })

  it('returns single date when start equals end', () => {
    const dates = listExpectedTripDates(makeTrip({ startDate: '2025-04-01', endDate: '2025-04-01' }))
    expect(dates).toEqual(['2025-04-01'])
  })

  it('returns empty when end is before start', () => {
    const dates = listExpectedTripDates(makeTrip({ startDate: '2025-04-05', endDate: '2025-04-01' }))
    expect(dates).toEqual([])
  })

  it('returns empty for invalid dates', () => {
    const dates = listExpectedTripDates(makeTrip({ startDate: 'invalid', endDate: '2025-04-03' }))
    expect(dates).toEqual([])
  })

  it('returns empty for overflow dates', () => {
    const dates = listExpectedTripDates(makeTrip({ startDate: '2025-02-30', endDate: '2025-03-02' }))
    expect(dates).toEqual([])
  })
})

describe('getDayGenerationState', () => {
  it('returns disabled when date range is invalid', () => {
    const state = getDayGenerationState(makeTrip({ startDate: 'invalid', endDate: 'invalid' }), [])
    expect(state.disabled).toBe(true)
    expect(state.label).toBe('日期范围无效')
  })

  it('returns generate label when no days exist', () => {
    const state = getDayGenerationState(makeTrip(), [])
    expect(state.disabled).toBe(false)
    expect(state.label).toBe('生成日期范围')
  })

  it('returns supplement label when some days are missing', () => {
    const trip = makeTrip({ startDate: '2025-04-01', endDate: '2025-04-03' })
    const days = [makeDay({ date: '2025-04-01' })]
    const state = getDayGenerationState(trip, days)
    expect(state.disabled).toBe(false)
    expect(state.label).toBe('补全缺失日期')
    expect(state.missingDates).toEqual(['2025-04-02', '2025-04-03'])
  })

  it('returns disabled when all days are generated', () => {
    const trip = makeTrip({ startDate: '2025-04-01', endDate: '2025-04-02' })
    const days = [makeDay({ date: '2025-04-01' }), makeDay({ date: '2025-04-02', id: 'day-2', sortOrder: 2 })]
    const state = getDayGenerationState(trip, days)
    expect(state.disabled).toBe(true)
    expect(state.label).toBe('每日行程已生成')
  })
})
