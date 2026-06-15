import type { ProviderProxyAiExpenseQueryRequest } from '../../src/lib/ai/providerProxyContract'
import { extractJsonFromAiText } from './aiJson'

type Env = {
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
}

export type ExpenseQueryProviderResult =
  | { ok: true; answer: string; citationExpenseIds: string[]; source: 'mock' | 'ai' }
  | { ok: false; errorCode: 'provider_unavailable' | 'provider_error' | 'network_error' | 'invalid_response' }

export async function answerExpenseQueryWithProvider(
  env: Env,
  request: ProviderProxyAiExpenseQueryRequest,
  fetcher: typeof fetch,
  mock: boolean,
): Promise<ExpenseQueryProviderResult> {
  if (mock) return { answer: request.deterministicAnswer, citationExpenseIds: request.rows.slice(0, 3).map((row) => row.id), ok: true, source: 'mock' }
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
    return validateResponse(parsed, request) ?? { errorCode: 'invalid_response', ok: false }
  } catch {
    return { errorCode: 'network_error', ok: false }
  } finally {
    clearTimeout(timeout)
  }
}

function buildPrompt(request: ProviderProxyAiExpenseQueryRequest) {
  return [
    '你是 TripMap 旅行账单问答组织器，只输出 JSON。',
    '本地程序已经完成筛选和金额计算。不得重新计算、修改、推断或补充金额；必须保留 deterministicAnswer 中的数字结论。',
    '只根据 rows 组织简洁中文答案，不得声称看过原始票据。citationExpenseIds 只能使用 rows.id。',
    '输出 {"answer":"...","citationExpenseIds":["..."]}。',
    JSON.stringify(request),
  ].join('\n')
}

function validateResponse(value: unknown, request: ProviderProxyAiExpenseQueryRequest): ExpenseQueryProviderResult | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const allowed = new Set(request.rows.map((row) => row.id))
  if (typeof record.answer !== 'string' || !record.answer.trim() || record.answer.length > 4_000 || !Array.isArray(record.citationExpenseIds)) return undefined
  if (!record.answer.includes(request.deterministicAnswer)) return undefined
  if (!record.citationExpenseIds.every((id) => typeof id === 'string' && allowed.has(id))) return undefined
  return { answer: record.answer.trim(), citationExpenseIds: [...new Set(record.citationExpenseIds as string[])], ok: true, source: 'ai' }
}
