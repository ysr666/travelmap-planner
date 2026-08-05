import { describe, expect, it } from 'vitest'
import { getHomeDeparturePresentation } from './homeDeparture'

const day = {
  date: '2026-07-30',
  timeZone: 'Europe/London',
}

const trip = {
  timeZone: 'Europe/London',
}

describe('getHomeDeparturePresentation', () => {
  it('shows a stable minute-and-second countdown within the next hour', () => {
    expect(getHomeDeparturePresentation({
      day,
      item: { startTime: '11:00' },
      now: new Date('2026-07-30T09:47:20.000Z'),
      status: 'ongoing',
      trip,
    })).toEqual({
      accessibleLabel: '距离出发还有 12 分钟 40 秒',
      footer: '出发',
      label: '出发倒计时',
      value: '12:40',
    })
  })

  it('uses an hour-and-minute countdown for a later departure', () => {
    expect(getHomeDeparturePresentation({
      day,
      item: { startTime: '11:00' },
      now: new Date('2026-07-29T21:20:00.000Z'),
      status: 'ongoing',
      trip,
    })?.value).toBe('12:40')
  })

  it('falls back to the scheduled time outside the live countdown window', () => {
    expect(getHomeDeparturePresentation({
      day,
      item: { startTime: '11:00' },
      now: new Date('2026-07-28T09:00:00.000Z'),
      status: 'upcoming',
      trip,
    })).toMatchObject({
      label: '出发时间',
      value: '11:00',
    })
  })

  it('does not show a live countdown for a completed trip', () => {
    expect(getHomeDeparturePresentation({
      day,
      item: { startTime: '11:00' },
      now: new Date('2026-07-30T09:47:20.000Z'),
      status: 'completed',
      trip,
    })).toMatchObject({
      footer: '已结束',
      label: '出发时间',
      value: '11:00',
    })
  })
})
