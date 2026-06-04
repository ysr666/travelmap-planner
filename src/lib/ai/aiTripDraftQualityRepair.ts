import type { AiTripDraft } from './aiTripDraft'
import { validateAiTripDraft } from './aiTripDraft'
import type { AiTripDraftQualityFinding, AiTripDraftQualityResult } from './aiTripDraftQuality'
import { flattenAiTripDraftQualityFindings } from './aiTripDraftQuality'
import { fingerprintAiTripDraft } from './aiTripDraftRefine'
import type { SanitizedQualityFinding } from './providerProxyContract'

export type AiTripDraftQualityRepairApplyResult =
  | { draft: AiTripDraft; ok: true }
  | { errors: string[]; ok: false }

export function buildSelectedAiTripDraftRepairFindings(
  qualityResult: AiTripDraftQualityResult,
  selectedFindingIds: Set<string>,
): SanitizedQualityFinding[] {
  return flattenAiTripDraftQualityFindings(qualityResult)
    .filter((finding) => selectedFindingIds.has(finding.id) && finding.repairable)
    .map(toSanitizedQualityFinding)
}

export function toSanitizedQualityFinding(finding: AiTripDraftQualityFinding): SanitizedQualityFinding {
  return {
    dayDate: finding.dayDate,
    message: finding.message,
    ruleId: finding.ruleId,
    severity: finding.severity,
    title: finding.title,
  }
}

export function applyAiTripDraftQualityRepairResultIfFresh({
  baselineFingerprint,
  currentDraft,
  repairedDraft,
}: {
  baselineFingerprint: string
  currentDraft: AiTripDraft
  repairedDraft: AiTripDraft
}): AiTripDraftQualityRepairApplyResult {
  if (fingerprintAiTripDraft(currentDraft) !== baselineFingerprint) {
    return { errors: ['草案已变化，请重新检查后再修复。'], ok: false }
  }

  const candidate: AiTripDraft = {
    ...repairedDraft,
    destination: currentDraft.destination,
    endDate: currentDraft.endDate,
    startDate: currentDraft.startDate,
    title: currentDraft.title,
  }
  const validation = validateAiTripDraft(candidate)
  if (!validation.valid || !validation.draft) {
    return {
      errors: validation.errors.length > 0
        ? validation.errors.map((error) => `${error.path}: ${error.message}`)
        : ['修复结果未通过校验，请重试。'],
      ok: false,
    }
  }

  return { draft: validation.draft, ok: true }
}
