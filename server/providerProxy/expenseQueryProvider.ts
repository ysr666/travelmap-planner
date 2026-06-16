import { validateProviderProxyAiExpenseQueryResponsePlan, type ProviderProxyAiExpenseQueryRequest } from '../../src/lib/ai/providerProxyContract'
import type { LedgerQueryPlan } from '../../src/lib/ledgerArchive'
import { extractJsonFromAiText } from './aiJson'

type Env = {
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
}

export type ExpenseQueryProviderResult =
  | { ok: true; plan: LedgerQueryPlan; presentation: 'summary' | 'list' | 'grouped'; source: 'mock' | 'ai' }
  | { ok: false; errorCode: 'provider_unavailable' | 'provider_error' | 'network_error' | 'invalid_response' }

export async function answerExpenseQueryWithProvider(
  env: Env,
  request: ProviderProxyAiExpenseQueryRequest,
  fetcher: typeof fetch,
  mock: boolean,
): Promise<ExpenseQueryProviderResult> {
  if (mock) return { ok: true, plan: { aggregation: 'list', limit: 20 }, presentation: 'list', source: 'mock' }
  const apiKey = env.TRIPMAP_AI_API_KEY?.trim()
  const baseUrl = env.TRIPMAP_AI_BASE_URL?.trim()
  const model = env.TRIPMAP_AI_MODEL?.trim()
  if (!apiKey || !baseUrl || !model) return { errorCode: 'provider_unavailable', ok: false }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      body: JSON.stringify({
        max_tokens: 900,
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
    return validateResponse(parsed) ?? { errorCode: 'invalid_response', ok: false }
  } catch {
    return { errorCode: 'network_error', ok: false }
  } finally {
    clearTimeout(timeout)
  }
}

function buildPrompt(request: ProviderProxyAiExpenseQueryRequest) {
  return [
    '你是 TripMap 旅行账单查询计划解析器，只输出 JSON。',
    '不得计算金额，不得返回金额结论，不得声称看过原始票据。只把问题转换成白名单查询计划。',
    'plan 仅可使用 aggregation(list/count/sum/max/group)、categories、cities、merchants、statuses、reviewStatuses、reviewBuckets、paymentStatuses、orderStatuses、refundState、itemLinked、sourceRoles、dateRange、groupBy、sort、limit。',
    'presentation 只能是 summary、list 或 grouped。输出 {"plan":{...},"presentation":"..."}。',
    JSON.stringify(request),
  ].join('\n')
}

function validateResponse(value: unknown): ExpenseQueryProviderResult | undefined {
  if (!value || typeof value !== 'object') return undefined
  const validated = validateProviderProxyAiExpenseQueryResponsePlan(value)
  if (!validated) return undefined
  return { ...validated, ok: true, source: 'ai' }
}
