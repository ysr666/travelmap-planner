import { AI_TRIP_DRAFT_VARIANTS, type AiTripDraftVariantKind } from '../../lib/ai/aiTripDraftVariants'
import type { ProviderProxyPlaceLookupResult } from '../../lib/ai/providerProxyContract'

export function formatPlaceLookupCandidateCoordinate(candidate: ProviderProxyPlaceLookupResult): string {
  if (!candidate.location) return '候选缺少坐标'
  return `${candidate.location.lat.toFixed(5)}, ${candidate.location.lng.toFixed(5)}`
}

export function getAiDraftVariantLabel(kind: AiTripDraftVariantKind): string {
  return AI_TRIP_DRAFT_VARIANTS.find((variant) => variant.kind === kind)?.label ?? '该方案'
}
