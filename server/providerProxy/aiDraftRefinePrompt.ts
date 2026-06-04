import type {
  ProviderProxyAiTripDraftRefinePreferences,
  ProviderProxyAiTripDraftRefineRequest,
  ProviderProxyAiTripDraftRefineScope,
} from '../../src/lib/ai/providerProxyContract'
import {
  AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS,
  AI_DRAFT_MAX_OUTPUT_TOKENS_HINT,
} from './aiDraftLimits'
import type { AiDraftProviderInput } from './aiDraftPrompt'

export function buildAiTripDraftRefinePrompt(request: ProviderProxyAiTripDraftRefineRequest): string {
  const { draft, guidance, preferences, scope } = request

  let prompt = `You are a travel itinerary optimization assistant. You receive a complete valid travel draft and a strictly limited refinement scope. Your task is to output a complete valid draft JSON while changing ONLY the requested scope.

CURRENT DRAFT:
${JSON.stringify(draft, null, 2)}

REFINEMENT SCOPE:
${formatScope(scope)}

UPDATED PREFERENCES:
${formatPreferences(preferences)}

INSTRUCTIONS:
- Output ONLY valid JSON. No markdown, no explanation, no code fences.
- Output a COMPLETE draft, not a patch.
- Preserve root fields exactly: title, destination, startDate, endDate.
- Preserve the total number of days and every day date.
- Only change day content within the requested scope. Days outside the scope must be copied unchanged.
- Keep target dates in the same date positions; do not add, remove, rename, or shift dates.
- Improve the target scope according to the updated preferences and user guidance.
- Each target day should keep a practical theme, realistic times, specific place names when possible, transportation suggestions between adjacent items, and 1-3 daily tips.
- Do NOT generate: tickets, routes, route cache, cloud fields, provider metadata, API keys, or transit line numbers.
- Do NOT call or imply any external place, route, search, ticket, or cloud service.
- Do NOT generate coordinates unless already present or you have high confidence.
- previousTransportMode must be one of: walk, transit, bus, car, train, flight, other.
- Times must be HH:mm format. Dates must be YYYY-MM-DD format.
- The output must pass the same schema validation as the input.`

  if (guidance?.trim()) {
    prompt += `\n\nADDITIONAL USER GUIDANCE:\n${truncateFreeText(guidance)}`
  }

  return prompt
}

export function buildAiTripDraftRefineProviderInput(
  request: ProviderProxyAiTripDraftRefineRequest,
  requestId?: string,
): AiDraftProviderInput {
  return {
    maxOutputTokens: AI_DRAFT_MAX_OUTPUT_TOKENS_HINT,
    prompt: buildAiTripDraftRefinePrompt(request),
    requestId,
  }
}

function formatScope(scope: ProviderProxyAiTripDraftRefineScope): string {
  if (scope.kind === 'day') {
    return `kind=day, date=${scope.date}`
  }
  return `kind=date_range, startDate=${scope.startDate}, endDate=${scope.endDate}`
}

function formatPreferences(preferences?: ProviderProxyAiTripDraftRefinePreferences): string {
  if (!preferences) {
    return '(none)'
  }

  const parts: string[] = []
  if (preferences.partySize) parts.push(`party size: ${preferences.partySize}`)
  if (preferences.pace) parts.push(`pace: ${preferences.pace}`)
  if (preferences.preferTransport) parts.push(`transport: ${preferences.preferTransport}`)
  if (preferences.mealTimeProtection !== undefined) parts.push(`protect meal times: ${preferences.mealTimeProtection ? 'yes' : 'no'}`)
  if (preferences.interestTags?.length) parts.push(`interest tags: ${preferences.interestTags.join(', ')}`)
  if (preferences.interestText) parts.push(`interest preferences: ${truncateFreeText(preferences.interestText)}`)
  if (preferences.mustVisitText) parts.push(`must visit: ${truncateFreeText(preferences.mustVisitText)}`)
  if (preferences.avoidText) parts.push(`avoid: ${truncateFreeText(preferences.avoidText)}`)
  if (preferences.freeTextRequirement) parts.push(`additional requirements: ${truncateFreeText(preferences.freeTextRequirement)}`)

  return parts.length > 0 ? parts.join('\n') : '(none)'
}

function truncateFreeText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS) return trimmed
  return trimmed.slice(0, AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS) + '...'
}
