import type {
  ProviderProxyAiExpenseExtractRequest,
  ProviderProxyAiExpenseExtractSuggestion,
} from '../../src/lib/ai/providerProxyContract'
import { extractJsonFromAiText } from './aiJson'

type Env = {
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
}

export type ExpenseExtractProviderResult =
  | { ok: true; suggestions: ProviderProxyAiExpenseExtractSuggestion[]; source: 'mock' | 'ai' }
  | { ok: false; errorCode: 'provider_unavailable' | 'provider_error' | 'network_error' | 'invalid_response' }

export async function extractExpensesWithProvider(
  env: Env,
  request: ProviderProxyAiExpenseExtractRequest,
  fetcher: typeof fetch,
  mock: boolean,
): Promise<ExpenseExtractProviderResult> {
  if (mock) {
    return { ok: true, source: 'mock', suggestions: request.candidates.map((candidate) => ({ candidateId: candidate.candidateId })) }
  }
  const apiKey = env.TRIPMAP_AI_API_KEY?.trim()
  const baseUrl = env.TRIPMAP_AI_BASE_URL?.trim()
  const model = env.TRIPMAP_AI_MODEL?.trim()
  if (!apiKey || !baseUrl || !model) return { errorCode: 'provider_unavailable', ok: false }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      body: JSON.stringify({
        max_tokens: 1200,
        messages: [{ content: buildPrompt(request), role: 'system' }],
        model,
        response_format: { type: 'json_object' },
        stream: false,
        temperature: 0,
      }),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
    if (!response.ok) return { errorCode: 'provider_error', ok: false }
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const parsed = extractJsonFromAiText(body.choices?.[0]?.message?.content ?? '')
    const suggestions = validateSuggestions(parsed, request)
    return suggestions ? { ok: true, source: 'ai', suggestions } : { errorCode: 'invalid_response', ok: false }
  } catch {
    return { errorCode: 'network_error', ok: false }
  } finally {
    clearTimeout(timeout)
  }
}

function buildPrompt(request: ProviderProxyAiExpenseExtractRequest) {
  return [
    '你是 TripMap 费用字段提取器，只输出 JSON，不添加解释。',
    '不要编造金额、币种或付款人；证据不足时省略字段。amount 使用十进制字符串，不带符号。',
    'category 只能是 lodging/transport/admission/food/shopping/insurance/connectivity/other。',
    'payerAlias 只能来自 participants.alias。每个 candidateId 最多返回一条。',
    '输出 {"suggestions":[{"candidateId":"...","amount":"12.50","currency":"USD","category":"food","payerAlias":"p1"}]}。',
    JSON.stringify(request),
  ].join('\n')
}

function validateSuggestions(value: unknown, request: ProviderProxyAiExpenseExtractRequest) {
  if (!value || typeof value !== 'object') return undefined
  const raw = (value as { suggestions?: unknown }).suggestions
  if (!Array.isArray(raw)) return undefined
  const candidateIds = new Set(request.candidates.map((candidate) => candidate.candidateId))
  const aliases = new Set(request.participants.map((participant) => participant.alias))
  const categories = new Set(['lodging', 'transport', 'admission', 'food', 'shopping', 'insurance', 'connectivity', 'other'])
  const suggestions: ProviderProxyAiExpenseExtractSuggestion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return undefined
    const record = item as Record<string, unknown>
    if (typeof record.candidateId !== 'string' || !candidateIds.has(record.candidateId)) return undefined
    const amount = typeof record.amount === 'string' && /^\d+(?:\.\d+)?$/.test(record.amount) ? record.amount : undefined
    const currency = typeof record.currency === 'string' && /^[A-Z]{3}$/.test(record.currency) ? record.currency : undefined
    const category = typeof record.category === 'string' && categories.has(record.category) ? record.category as ProviderProxyAiExpenseExtractSuggestion['category'] : undefined
    const payerAlias = typeof record.payerAlias === 'string' && aliases.has(record.payerAlias) ? record.payerAlias : undefined
    suggestions.push({ amount, candidateId: record.candidateId, category, currency, payerAlias })
  }
  return suggestions
}
