import type { ProviderProxyAiTripDraftRepairRequest } from '../../src/lib/providerProxyContract'
import { AI_DRAFT_MAX_OUTPUT_TOKENS_HINT } from './aiDraftLimits'
import type { AiDraftProviderInput } from './aiDraftPrompt'

export function buildAiTripDraftRepairPrompt(request: ProviderProxyAiTripDraftRepairRequest): string {
  const { draft, qualityFindings, repairInstruction } = request

  const findingsSummary = qualityFindings
    .map((f) => `- [${f.severity}] ${f.title}: ${f.message}${f.dayDate ? ` (${f.dayDate})` : ''}`)
    .join('\n')

  let prompt = `You are a travel itinerary repair assistant. You receive a valid travel draft and quality findings. Your task is to output a complete repaired draft JSON that fixes the quality issues.

CURRENT DRAFT:
${JSON.stringify(draft, null, 2)}

QUALITY FINDINGS:
${findingsSummary || '(none)'}

INSTRUCTIONS:
- Output ONLY valid JSON. No markdown, no explanation, no code fences.
- Output a COMPLETE repaired draft, not a patch.
- Preserve: title, destination, startDate, endDate, number of days, day dates.
- Fix: reduce density per day, adjust timing to avoid overlaps, add specific location names, add meal break items where missing, replace generic titles with more specific ones.
- Do NOT generate: tickets, routes, cloud fields, provider metadata, API keys, transit line numbers.
- Do NOT reorder items by route optimization.
- Do NOT add days beyond the original date range.
- Do NOT change the destination or date range.
- Each day should have reasonable pacing with adequate breaks between activities.
- Times must be HH:mm format. Dates must be YYYY-MM-DD format.
- If a meal break is missing during lunch (11:30-13:30) or dinner (17:30-19:30) hours, add a brief rest/meal item.
- Keep item titles in the same language as the original draft.
- The output must pass the same schema validation as the input.`

  if (repairInstruction?.trim()) {
    prompt += `\n\nADDITIONAL USER GUIDANCE:\n${repairInstruction.trim()}`
  }

  return prompt
}

export function buildAiTripDraftRepairProviderInput(
  request: ProviderProxyAiTripDraftRepairRequest,
  requestId?: string,
): AiDraftProviderInput {
  return {
    prompt: buildAiTripDraftRepairPrompt(request),
    requestId,
    maxOutputTokens: AI_DRAFT_MAX_OUTPUT_TOKENS_HINT,
  }
}
