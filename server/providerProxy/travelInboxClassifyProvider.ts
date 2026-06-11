import {
  validateTravelInboxClassification,
  type ProviderProxyErrorCode,
  type ProviderProxyTravelInboxClassifyRequest,
} from '../../src/lib/ai/providerProxyContract'
import type { TravelInboxClassification } from '../../src/types'
import { extractJsonFromAiText } from './aiJson'

type ErrorCode = Extract<ProviderProxyErrorCode, 'provider_unavailable' | 'provider_error' | 'network_error' | 'unsupported' | 'invalid_response'>
export type TravelInboxClassifyProviderResult =
  | { ok: true; classification: TravelInboxClassification; source: 'mock' | 'future_ai'; warnings?: string[] }
  | { ok: false; errorCode: ErrorCode }

export type TravelInboxClassifyProvider = {
  classify(request: ProviderProxyTravelInboxClassifyRequest): Promise<TravelInboxClassifyProviderResult>
}

type Env = {
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
}

export function createMockTravelInboxClassifyProvider(): TravelInboxClassifyProvider {
  return {
    async classify(request) {
      const text = normalize(request.source.text)
      const matches = request.trips.filter((trip) => {
        const title = normalize(trip.title)
        const destination = normalize(trip.destination)
        return (title.length >= 2 && text.includes(title)) || (destination.length >= 2 && text.includes(destination)) || overlapsDate(text, trip.startDate, trip.endDate)
      })
      const target = matches.length === 1 ? matches[0] : undefined
      return {
        classification: {
          category: inferCategory(text),
          confidence: target ? 'high' : matches.length > 1 ? 'medium' : 'low',
          reason: target ? '来源中的旅行名称、目的地或日期与该旅行明确匹配。' : matches.length > 1 ? '来源可能匹配多个旅行，需要确认。' : '没有找到明确匹配的旅行。',
          targetTripId: target?.id,
        },
        ok: true,
        source: 'mock',
      }
    },
  }
}

export function createUnavailableTravelInboxClassifyProvider(): TravelInboxClassifyProvider {
  return { async classify() { return { errorCode: 'provider_unavailable', ok: false } } }
}

export function createOpenAiCompatibleTravelInboxClassifyProvider(env: Env, fetcher: typeof fetch = fetch): TravelInboxClassifyProvider {
  return {
    async classify(request) {
      const apiKey = env.TRIPMAP_AI_API_KEY?.trim()
      const baseUrl = env.TRIPMAP_AI_BASE_URL?.trim()
      const model = env.TRIPMAP_AI_MODEL?.trim()
      if (!apiKey || !baseUrl || !model) return { errorCode: 'provider_unavailable', ok: false }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      try {
        const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          body: JSON.stringify({
            max_tokens: 500,
            messages: [{
              content: buildPrompt(request),
              role: 'system',
            }],
            model,
            response_format: { type: 'json_object' },
            stream: false,
            temperature: 0,
          }),
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          method: 'POST',
          signal: controller.signal,
        })
        if (!response.ok) return { errorCode: response.status === 429 ? 'provider_error' : 'provider_error', ok: false }
        const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
        const parsed = extractJsonFromAiText(body.choices?.[0]?.message?.content ?? '')
        const classification = validateTravelInboxClassification(parsed, new Set(request.trips.map((trip) => trip.id)))
        return classification
          ? { classification, ok: true, source: 'future_ai' }
          : { errorCode: 'invalid_response', ok: false }
      } catch (caught) {
        return { errorCode: caught instanceof DOMException && caught.name === 'AbortError' ? 'network_error' : 'network_error', ok: false }
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

function buildPrompt(request: ProviderProxyTravelInboxClassifyRequest) {
  return [
    '你是 TripMap 旅行收件箱分类器，只输出 JSON。',
    '从给定旅行列表选择唯一目标；证据不足时 targetTripId 省略。不要编造旅行。',
    'confidence 只能是 high/medium/low；category 只能是 itinerary/ticket/note/mixed/unclassified。',
    '只有旅行名称、目的地或日期范围明确唯一匹配时才能给 high。',
    '输出 {"targetTripId":"...","category":"ticket","confidence":"high","reason":"..."}。',
    JSON.stringify({ source: request.source, trips: request.trips }),
  ].join('\n')
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}

function overlapsDate(text: string, startDate: string, endDate: string) {
  const dates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []
  return dates.some((date) => date >= startDate && date <= endDate)
}

function inferCategory(text: string): TravelInboxClassification['category'] {
  const ticket = /ticket|booking|reservation|订单|票|预订|凭证|二维码/i.test(text)
  const itinerary = /itinerary|schedule|行程|出发|到达|入住|退房/i.test(text)
  if (ticket && itinerary) return 'mixed'
  if (ticket) return 'ticket'
  if (itinerary) return 'itinerary'
  if (/note|备注|提醒|注意/i.test(text)) return 'note'
  return 'unclassified'
}
