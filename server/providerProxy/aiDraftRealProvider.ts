import { buildAiTripDraftProviderInput } from './aiDraftPrompt'
import { AI_DRAFT_MAX_OUTPUT_TOKENS_HINT } from './aiDraftLimits'
import type { AiDraftProvider, AiDraftProviderResult } from './aiDraftProvider'
import type { ProviderProxyAiTripDraftRequest } from '../../src/lib/providerProxyContract'

const REQUEST_TIMEOUT_MS = 30_000

type OpenAiCompatibleEnv = {
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
}

export function createOpenAiCompatibleAiDraftProvider(
  env: OpenAiCompatibleEnv,
  request: ProviderProxyAiTripDraftRequest,
  fetchImpl: typeof fetch = fetch,
): AiDraftProvider {
  const apiKey = env.TRIPMAP_AI_API_KEY?.trim()
  const baseUrl = env.TRIPMAP_AI_BASE_URL?.trim()
  const model = env.TRIPMAP_AI_MODEL?.trim()

  return {
    name: 'openai_compatible',
    async generateDraft(): Promise<AiDraftProviderResult> {
      if (!apiKey || !baseUrl || !model) {
        return { ok: false, errorCode: 'provider_unavailable', message: 'AI provider environment is not fully configured.' }
      }

      const providerInput = buildAiTripDraftProviderInput(request, request.requestId)
      const endpoint = joinUrl(baseUrl, '/chat/completions')

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const response = await fetchImpl(endpoint, {
          body: JSON.stringify({
            max_tokens: AI_DRAFT_MAX_OUTPUT_TOKENS_HINT,
            messages: [
              { role: 'system', content: providerInput.prompt },
              { role: 'user', content: `Plan a trip to ${request.destination} from ${request.startDate} to ${request.endDate}.` },
            ],
            model,
            temperature: 0.2,
          }),
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal: controller.signal,
        })

        if (!response.ok) {
          return { ok: false, errorCode: 'provider_error', message: 'AI provider returned an error.' }
        }

        const data = await readJson(response)
        const rawText = extractContent(data)
        if (!rawText) {
          return { ok: false, errorCode: 'provider_error', message: 'AI provider returned empty content.' }
        }

        return { kind: 'raw', ok: true, rawText }
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'AbortError') {
          return { ok: false, errorCode: 'network_error', message: 'AI provider request timed out.' }
        }
        return { ok: false, errorCode: 'network_error', message: 'AI provider request failed.' }
      } finally {
        clearTimeout(timeoutId)
      }
    },
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function extractContent(data: Record<string, unknown>): string | null {
  const choices = data.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const choice = choices[0] as Record<string, unknown>
  const message = choice?.message as Record<string, unknown> | undefined
  const content = message?.content
  return typeof content === 'string' && content.trim() ? content : null
}
