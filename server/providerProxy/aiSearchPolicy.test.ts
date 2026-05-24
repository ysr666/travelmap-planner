import { describe, expect, it } from 'vitest'
import { decideAiSearchNeed } from './aiSearchPolicy'

describe('decideAiSearchNeed', () => {
  it('never enables runtime search', () => {
    expect(decideAiSearchNeed({ text: '帮我查今天是否开门' }).needed).toBe(false)
    expect(decideAiSearchNeed({ text: 'ticket availability today' }).needed).toBe(false)
    expect(decideAiSearchNeed({ text: 'current train disruption' }).needed).toBe(false)
    expect(decideAiSearchNeed({ text: 'recent reviews' }).needed).toBe(false)
  })

  it('marks future opening-hours lookup without calling search', () => {
    expect(decideAiSearchNeed({ text: '请确认博物馆营业时间' })).toEqual({
      futureOperation: 'opening_hours_lookup',
      needed: false,
      reason: 'future_opening_hours_or_closure_lookup',
    })
  })

  it('marks future ticket lookup without calling search', () => {
    expect(decideAiSearchNeed({ text: '需要查门票和预约信息' })).toEqual({
      futureOperation: 'travel_search',
      needed: false,
      reason: 'future_ticket_or_reservation_lookup',
    })
  })

  it('marks future transport disruption lookup without calling search', () => {
    expect(decideAiSearchNeed({ text: '检查近期是否有列车停运' })).toEqual({
      futureOperation: 'travel_search',
      needed: false,
      reason: 'future_transport_disruption_lookup',
    })
  })

  it('does not require fetch or network dependencies', () => {
    const originalFetch = globalThis.fetch
    try {
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value: undefined })
      expect(decideAiSearchNeed({ text: 'recent event near this place' })).toEqual({
        futureOperation: 'place_research',
        needed: false,
        reason: 'future_recent_review_or_event_lookup',
      })
    } finally {
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch })
    }
  })
})
