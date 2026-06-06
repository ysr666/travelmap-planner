import { describe, expect, it } from 'vitest'
import {
  PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
  type ProviderProxyExistingTripImportRequest,
} from '../../src/lib/ai/providerProxyContract'
import {
  buildExistingTripImportProviderInput,
  createMockExistingTripImportProvider,
  normalizeExistingTripImportProviderOutput,
} from './existingTripImportProvider'

function request(): ProviderProxyExistingTripImportRequest {
  return {
    days: [{ date: '2026-04-01', id: 'day-1', sortOrder: 1, title: 'Day 1' }],
    items: [{ date: '2026-04-01', dayId: 'day-1', id: 'item-1', title: '西湖' }],
    operation: PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
    sources: [{
      fileName: 'ticket.pdf',
      id: 'source:file:1',
      kind: 'pdf',
      label: 'ticket.pdf',
      mimeType: 'application/pdf',
      size: 123,
      text: '2026-04-01 10:00 西湖 门票 订单',
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

describe('existing trip import provider', () => {
  it('builds a prompt that constrains the provider to extracted text', () => {
    const input = buildExistingTripImportProviderInput(request(), 'req-1')

    expect(input.prompt).toContain('只能基于下方 extracted sources')
    expect(input.prompt).toContain('不要编造')
    expect(input.prompt).not.toContain('Authorization')
    expect(input.reasoningMode).toBe('off')
  })

  it('mock provider returns deterministic item and ticket candidates', async () => {
    const provider = createMockExistingTripImportProvider()
    const result = await provider.importTrip(request(), buildExistingTripImportProviderInput(request()))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.result.items?.[0]).toMatchObject({ date: '2026-04-01', title: expect.any(String) })
      expect(result.result.tickets?.[0]).toMatchObject({ sourceFileId: 'source:file:1' })
    }
  })

  it('rejects invalid AI output that has no candidates', () => {
    const normalized = normalizeExistingTripImportProviderOutput('{"warnings":["empty"]}', request())

    expect(normalized.ok).toBe(false)
  })
})
