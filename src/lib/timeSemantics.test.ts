import { describe, expect, it } from 'vitest'
import {
  addPlainDateDays,
  formatInstantInTimeZone,
  plainDateDaysBetween,
  resolveWallClockToInstant,
  todayInTimeZone,
  toIanaTimeZone,
  toPlainDate,
  toWallClockTime,
} from './timeSemantics'

describe('time semantics', () => {
  it('validates plain dates, wall-clock times, and IANA time zones', () => {
    expect(toPlainDate('2026-02-28')).toBe('2026-02-28')
    expect(toPlainDate('2026-02-30')).toBeNull()
    expect(toWallClockTime('23:59')).toBe('23:59')
    expect(toWallClockTime('24:00')).toBeNull()
    expect(toIanaTimeZone('America/New_York')).toBe('America/New_York')
    expect(toIanaTimeZone('America/Nowhere')).toBeNull()
  })

  it('shifts a nonexistent New York wall-clock time forward', () => {
    const result = resolveWallClockToInstant({
      date: '2026-03-08',
      time: '02:30',
      timeZone: 'America/New_York',
    })

    expect(result).toMatchObject({
      adjustment: 'nonexistent_shifted_forward',
      resolvedDate: '2026-03-08',
      resolvedTime: '03:30',
    })
    expect(result?.instant).toBe(Date.parse('2026-03-08T07:30:00.000Z'))
  })

  it('chooses the earlier instant for a repeated New York wall-clock time', () => {
    const result = resolveWallClockToInstant({
      date: '2026-11-01',
      time: '01:30',
      timeZone: 'America/New_York',
    })

    expect(result?.adjustment).toBe('ambiguous_earlier')
    expect(result?.instant).toBe(Date.parse('2026-11-01T05:30:00.000Z'))
  })

  it('computes today and display labels in the requested time zone', () => {
    const instant = Date.parse('2026-06-10T16:30:00.000Z')

    expect(todayInTimeZone('Asia/Shanghai', instant)).toBe('2026-06-11')
    expect(todayInTimeZone('America/Los_Angeles', instant)).toBe('2026-06-10')
    expect(formatInstantInTimeZone(instant, 'Asia/Shanghai', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })).toContain('2026')
  })

  it('performs calendar arithmetic without routing plain dates through UTC', () => {
    expect(addPlainDateDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addPlainDateDays('2028-02-29', 1)).toBe('2028-03-01')
    expect(plainDateDaysBetween('2026-12-31', '2027-01-02')).toBe(2)
  })
})
