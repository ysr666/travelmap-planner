export { createOpenAiCompatibleAiDraftProvider } from './aiDraftRealProvider'

import type { AiTripDraft } from '../../src/lib/aiTripDraft'
import { generateMockAiTripDraft } from '../../src/lib/aiTripDraftMock'
import type { ProviderProxyAiTripDraftRequest } from '../../src/lib/providerProxyContract'
import type { AiDraftProviderInput } from './aiDraftPrompt'

export type AiDraftProviderErrorCode =
  | 'provider_unavailable'
  | 'quota_exceeded'
  | 'provider_error'
  | 'network_error'
  | 'unsupported'

export type AiDraftUsage = {
  promptTokens?: number
  completionTokens?: number
}

export type AiDraftProviderResult =
  | { ok: true; kind: 'raw'; rawText: string; usage?: AiDraftUsage }
  | { ok: true; kind: 'draft'; draft: AiTripDraft; source: 'mock'; warnings?: string[] }
  | { ok: false; errorCode: AiDraftProviderErrorCode; message?: string }

export type AiDraftProvider = {
  readonly name: string
  generateDraft(input: AiDraftProviderInput): Promise<AiDraftProviderResult>
}

export function createDisabledAiDraftProvider(): AiDraftProvider {
  return {
    name: 'disabled',
    async generateDraft() {
      return { ok: false, errorCode: 'unsupported', message: 'AI draft generation is not currently available.' }
    },
  }
}

export function createUnavailableAiDraftProvider(): AiDraftProvider {
  return {
    name: 'unavailable',
    async generateDraft() {
      return { ok: false, errorCode: 'provider_unavailable', message: 'AI draft provider is not configured.' }
    },
  }
}

export function createMockAiDraftProvider(request: ProviderProxyAiTripDraftRequest): AiDraftProvider {
  return {
    name: 'mock',
    async generateDraft() {
      const draft = generateMockAiTripDraft({
        destination: request.destination,
        endDate: request.endDate,
        freeTextRequirement: request.freeTextRequirement,
        mealTimeProtection: request.mealTimeProtection,
        mustVisitText: request.mustVisitText,
        avoidText: request.avoidText,
        pace: request.pace,
        preferTransport: request.preferTransport,
        startDate: request.startDate,
      })
      return {
        draft,
        kind: 'draft',
        ok: true,
        source: 'mock',
        warnings: ['当前为本地示例草稿，非真实 AI 生成。'],
      }
    },
  }
}
