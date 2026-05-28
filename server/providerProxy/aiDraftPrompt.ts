import type { ProviderProxyAiTripDraftRequest } from '../../src/lib/ai/providerProxyContract'
import {
  AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS,
  AI_DRAFT_MAX_OUTPUT_TOKENS_HINT,
} from './aiDraftLimits'
import { listPlainDateRangeInclusive } from '../../src/lib/plainDate'
import type { AiBackendReasoningMode } from './aiReasoningPolicy'

export type AiDraftProviderInput = {
  requestId?: string
  prompt: string
  maxOutputTokens?: number
  reasoningMode?: AiBackendReasoningMode
}

export function buildAiTripDraftPrompt(request: ProviderProxyAiTripDraftRequest): string {
  const dates = listPlainDateRangeInclusive(request.startDate, request.endDate)
  const dayCount = dates.length

  const sections: string[] = []

  sections.push(
    'You are a travel itinerary planner. Output ONLY valid JSON. No markdown, no explanation, no code fences.',
  )

  sections.push(
    `Plan a ${dayCount}-day trip to ${request.destination} from ${request.startDate} to ${request.endDate}.`,
  )

  const preferences: string[] = []
  if (request.pace) {
    const paceLabel = request.pace === 'relaxed' ? '轻松' : request.pace === 'compact' ? '紧凑' : '适中'
    preferences.push(`pace: ${paceLabel}`)
  }
  if (request.preferTransport) {
    const transportLabel = request.preferTransport === 'public_transport' ? '公共交通'
      : request.preferTransport === 'walking' ? '步行'
      : request.preferTransport === 'taxi' ? '打车' : '综合'
    preferences.push(`transport: ${transportLabel}`)
  }
  if (request.mealTimeProtection) {
    preferences.push('protect meal times')
  }
  if (preferences.length > 0) {
    sections.push(`Preferences: ${preferences.join(', ')}.`)
  }

  if (request.mustVisitText) {
    sections.push(`Must visit: ${truncateFreeText(request.mustVisitText)}`)
  }
  if (request.avoidText) {
    sections.push(`Avoid: ${truncateFreeText(request.avoidText)}`)
  }
  if (request.freeTextRequirement) {
    sections.push(`Additional requirements: ${truncateFreeText(request.freeTextRequirement)}`)
  }

  sections.push(
    'Output format: JSON object with "title", "destination", "startDate", "endDate", "days" array. '
    + 'Each day has "date" (YYYY-MM-DD), optional "title", "items" array. '
    + 'Each item has "title", optional "locationName", "address", "lat", "lng", "startTime" (HH:mm), "endTime" (HH:mm), "previousTransportMode", "note".',
  )

  sections.push(
    'Constraints: '
    + 'Dates must be YYYY-MM-DD. Times must be HH:mm. '
    + 'Do NOT include tickets, routes, cloud fields, sync metadata, provider metadata, API keys, or transit line numbers. '
    + 'Do NOT reorder or optimize the itinerary. '
    + 'Do NOT generate coordinates unless you have high confidence. '
    + 'previousTransportMode must be one of: walk, transit, bus, car, train, flight, other.',
  )

  return sections.join('\n\n')
}

export function buildAiTripDraftProviderInput(
  request: ProviderProxyAiTripDraftRequest,
  requestId?: string,
): AiDraftProviderInput {
  return {
    maxOutputTokens: AI_DRAFT_MAX_OUTPUT_TOKENS_HINT,
    prompt: buildAiTripDraftPrompt(request),
    requestId,
  }
}

export function summarizeAiDraftPromptInput(request: ProviderProxyAiTripDraftRequest): string {
  const dates = listPlainDateRangeInclusive(request.startDate, request.endDate)
  const parts = [
    `destination=${request.destination}`,
    `${request.startDate}~${request.endDate}`,
    `${dates.length} days`,
  ]
  if (request.pace) parts.push(`pace=${request.pace}`)
  if (request.preferTransport) parts.push(`transport=${request.preferTransport}`)
  return parts.join(', ')
}

function truncateFreeText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS) return trimmed
  return trimmed.slice(0, AI_DRAFT_MAX_FREE_TEXT_EMBED_CHARS) + '…'
}
