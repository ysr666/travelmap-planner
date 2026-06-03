import { describe, expect, it } from 'vitest'
import { validateAiTripDraft } from '../../src/lib/ai/aiTripDraft'
import {
  createDisabledAiDraftProvider,
  createMockAiDraftProvider,
  createUnavailableAiDraftProvider,
} from './aiDraftProvider'
import type { ProviderProxyAiTripDraftRequest } from '../../src/lib/ai/providerProxyContract'

function validRequest(overrides?: Partial<ProviderProxyAiTripDraftRequest>): ProviderProxyAiTripDraftRequest {
  return {
    destination: '东京',
    endDate: '2025-04-05',
    operation: 'ai_trip_draft',
    requestId: 'req-1',
    startDate: '2025-04-01',
    ...overrides,
  }
}

describe('createDisabledAiDraftProvider', () => {
  it('returns unsupported error', async () => {
    const provider = createDisabledAiDraftProvider()
    expect(provider.name).toBe('disabled')
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('unsupported')
    }
  })
})

describe('createUnavailableAiDraftProvider', () => {
  it('returns provider_unavailable error', async () => {
    const provider = createUnavailableAiDraftProvider()
    expect(provider.name).toBe('unavailable')
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('provider_unavailable')
    }
  })
})

describe('createMockAiDraftProvider', () => {
  it('returns a valid draft with source mock', async () => {
    const provider = createMockAiDraftProvider(validRequest())
    expect(provider.name).toBe('mock')
    const result = await provider.generateDraft({ prompt: 'ignored' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('draft')
      expect(result.source).toBe('mock')
      expect(result.draft.title).toContain('东京')
      expect(result.warnings).toContain('当前为本地示例草稿，非真实 AI 生成。')
    }
  })

  it('mock draft passes validateAiTripDraft', async () => {
    const provider = createMockAiDraftProvider(validRequest())
    const result = await provider.generateDraft({ prompt: 'ignored' })
    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'draft') {
      const validation = validateAiTripDraft(result.draft)
      expect(validation.valid).toBe(true)
      expect(validation.errors).toHaveLength(0)
    }
  })

  it('mock draft includes builder tips and transport suggestions', async () => {
    const provider = createMockAiDraftProvider(validRequest({
      interestTags: ['美食'],
      interestText: '咖啡馆',
      partySize: 2,
      preferTransport: 'taxi',
    }))
    const result = await provider.generateDraft({ prompt: 'ignored' })
    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'draft') {
      expect(result.draft.days[0].tips?.join('\n')).toContain('2 人')
      expect(result.draft.days[0].items[1].previousTransportMode).toBe('car')
      expect(result.draft.days[0].items[1].previousTransportNote).toContain('打车')
    }
  })

  it('mock draft is deterministic', async () => {
    const request = validRequest({ destination: '巴黎' })
    const a = await createMockAiDraftProvider(request).generateDraft({ prompt: '' })
    const b = await createMockAiDraftProvider(request).generateDraft({ prompt: '' })
    expect(a).toEqual(b)
  })

  it('mock draft does not contain forbidden fields', async () => {
    const provider = createMockAiDraftProvider(validRequest())
    const result = await provider.generateDraft({ prompt: 'ignored' })
    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'draft') {
      const json = JSON.stringify(result.draft)
      expect(json).not.toContain('ticket')
      expect(json).not.toContain('cloud')
      expect(json).not.toContain('apiKey')
      expect(json).not.toContain('routeCache')
    }
  })
})
