import { describe, expect, it } from 'vitest'
import {
  PROVIDER_PROXY_TRAVEL_INBOX_CLASSIFY_OPERATION,
  validateProviderProxyTravelInboxClassifyRequest,
  validateTravelInboxClassification,
} from './providerProxyContract'
import { createMockTravelInboxClassifyProvider } from '../../../server/providerProxy/travelInboxClassifyProvider'

const request = {
  operation: PROVIDER_PROXY_TRAVEL_INBOX_CLASSIFY_OPERATION,
  source: { id: 'source-1', kind: 'email' as const, label: '订单邮件', text: '东京旅行 2026-07-10 酒店订单' },
  trips: [{ destination: '东京', endDate: '2026-07-12', id: 'trip-tokyo', startDate: '2026-07-10', title: '东京旅行' }],
}

describe('travel inbox classify contract', () => {
  it('accepts sanitized source text and at most thirty trip summaries', () => {
    expect(validateProviderProxyTravelInboxClassifyRequest(request)).toMatchObject({ ok: true })
  })

  it('rejects raw files and unknown target trip ids', () => {
    expect(validateProviderProxyTravelInboxClassifyRequest({ ...request, ticketFiles: ['secret.pdf'] })).toMatchObject({ ok: false })
    expect(validateTravelInboxClassification({ category: 'ticket', confidence: 'high', reason: 'match', targetTripId: 'unknown' }, new Set(['trip-tokyo']))).toBeNull()
  })

  it('mock provider only chooses a unique deterministic match', async () => {
    const result = await createMockTravelInboxClassifyProvider().classify(request)
    expect(result).toMatchObject({
      classification: { category: 'ticket', confidence: 'high', targetTripId: 'trip-tokyo' },
      ok: true,
    })
  })
})
