import { describe, expect, it } from 'vitest'
import {
  PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
  validateProviderProxyExistingTripImportRequest,
  type ProviderProxyExistingTripImportRequest,
} from './providerProxyContract'

function validRequest(): ProviderProxyExistingTripImportRequest {
  return {
    days: [{ date: '2026-04-01', id: 'day-1', sortOrder: 1, title: 'Day 1' }],
    items: [{
      date: '2026-04-01',
      dayId: 'day-1',
      id: 'item-1',
      startTime: '10:00',
      ticketCount: 1,
      title: '西湖',
    }],
    locale: 'zh-CN',
    operation: PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
    sources: [{
      id: 'source:pasted-text',
      kind: 'pasted_text',
      label: '粘贴文本',
      text: '2026-04-01 10:00 西湖 门票',
    }],
    trip: {
      destination: '杭州',
      endDate: '2026-04-02',
      id: 'trip-1',
      startDate: '2026-04-01',
      title: '杭州旅行',
    },
  }
}

describe('validateProviderProxyExistingTripImportRequest', () => {
  it('accepts sanitized existing-trip import requests', () => {
    const request = validRequest()
    request.existingTicketSummaries = [{
      itemId: 'item-1',
      scope: 'item',
      summaryId: 'existing-ticket:1',
      ticketCategory: 'admission_ticket',
      title: '西湖门票',
    }]
    const result = validateProviderProxyExistingTripImportRequest(request)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request.operation).toBe(PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION)
      expect(result.request.sources[0].text).toContain('西湖')
      expect(result.request.existingTicketSummaries?.[0]).toMatchObject({
        summaryId: 'existing-ticket:1',
        ticketCategory: 'admission_ticket',
      })
    }
  })

  it('rejects blobs, ticket ids, route cache and cloud fields', () => {
    for (const field of ['blob', 'ticketIds', 'ticketBlobs', 'routeCache', 'cloud', 'Authorization', 'Bearer']) {
      const request = validRequest() as unknown as Record<string, unknown>
      request[field] = 'secret'

      const result = validateProviderProxyExistingTripImportRequest(request)

      expect(result.ok, field).toBe(false)
    }
  })

  it('rejects forbidden fields inside existing ticket summaries', () => {
    for (const field of ['fileName', 'ticketId', 'ticketMetas', 'ticketBlobs']) {
      const request = validRequest() as unknown as Record<string, unknown>
      request.existingTicketSummaries = [{
        [field]: 'secret',
        summaryId: 'existing-ticket:1',
        title: '西湖门票',
      }]

      const result = validateProviderProxyExistingTripImportRequest(request)

      expect(result.ok, field).toBe(false)
    }
  })

  it('rejects too much extracted text', () => {
    const request = validRequest()
    request.sources = Array.from({ length: 16 }, (_, index) => ({
      id: `source:${index}`,
      kind: 'text_file',
      label: `file ${index}`,
      text: 'x'.repeat(4000),
    }))

    const result = validateProviderProxyExistingTripImportRequest(request)

    expect(result.ok).toBe(false)
  })
})
