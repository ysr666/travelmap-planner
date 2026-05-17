import { describe, expect, it } from 'vitest'
import {
  formatPlainDateChinese,
  formatPlainShortDateChinese,
  formatPlainShortDateWithWeekdayChinese,
  getPlainDateChineseWeekday,
  isValidPlainDate,
  listPlainDateRangeInclusive,
  parsePlainDate,
} from './plainDate'

describe('plain date validation', () => {
  it('accepts canonical calendar dates including leap days', () => {
    expect(isValidPlainDate('2024-02-29')).toBe(true)
    expect(isValidPlainDate('2026-04-01')).toBe(true)
    expect(parsePlainDate('2026-04-01')).toEqual({ year: 2026, month: 4, day: 1 })
  })

  it('rejects overflow non-padded full ISO and non-date values', () => {
    expect(isValidPlainDate('2023-02-29')).toBe(false)
    expect(isValidPlainDate('2026-02-30')).toBe(false)
    expect(isValidPlainDate('2026-4-1')).toBe(false)
    expect(isValidPlainDate('2026-04-01T00:00:00Z')).toBe(false)
    expect(isValidPlainDate('not-date')).toBe(false)
  })
})

describe('plain date formatting', () => {
  it('formats Chinese dates and weekdays deterministically', () => {
    expect(formatPlainDateChinese('2026-04-01')).toBe('2026年4月1日')
    expect(formatPlainShortDateChinese('2026-04-01')).toBe('4月1日')
    expect(getPlainDateChineseWeekday('2026-04-01')).toBe('周三')
    expect(formatPlainShortDateWithWeekdayChinese('2026-04-01')).toBe('4月1日 周三')
  })

  it('returns null for invalid date display inputs', () => {
    expect(formatPlainDateChinese('2026-02-30')).toBeNull()
    expect(formatPlainShortDateWithWeekdayChinese('2026-04-01T00:00:00Z')).toBeNull()
  })
})

describe('plain date ranges', () => {
  it('generates inclusive ranges across month and year boundaries', () => {
    expect(listPlainDateRangeInclusive('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ])
  })

  it('generates DST-adjacent ranges without timezone shifts', () => {
    expect(listPlainDateRangeInclusive('2026-03-07', '2026-03-10')).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ])
    expect(listPlainDateRangeInclusive('2026-11-01', '2026-11-03')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ])
  })

  it('returns empty for invalid or reversed ranges', () => {
    expect(listPlainDateRangeInclusive('2026-02-30', '2026-03-02')).toEqual([])
    expect(listPlainDateRangeInclusive('2026-04-03', '2026-04-01')).toEqual([])
  })
})
