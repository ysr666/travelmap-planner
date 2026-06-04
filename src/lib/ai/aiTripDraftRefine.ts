import type { AiTripDraft, AiTripDraftDay } from './aiTripDraft'
import { validateAiTripDraft } from './aiTripDraft'
import type { ProviderProxyAiTripDraftRefineScope } from './providerProxyContract'

export type AiTripDraftRefineApplyResult =
  | { draft: AiTripDraft; ok: true }
  | { errors: string[]; ok: false }

export function fingerprintAiTripDraft(draft: AiTripDraft): string {
  return JSON.stringify(draft)
}

export function isAiTripDraftDateInRefineScope(date: string, scope: ProviderProxyAiTripDraftRefineScope): boolean {
  if (scope.kind === 'day') {
    return date === scope.date
  }
  return date >= scope.startDate && date <= scope.endDate
}

export function getAiTripDraftRefineScopeDates(
  draft: AiTripDraft,
  scope: ProviderProxyAiTripDraftRefineScope,
): string[] {
  return draft.days
    .filter((day) => isAiTripDraftDateInRefineScope(day.date, scope))
    .map((day) => day.date)
}

export function applyAiTripDraftRefineResult(
  currentDraft: AiTripDraft,
  providerDraft: AiTripDraft,
  scope: ProviderProxyAiTripDraftRefineScope,
): AiTripDraftRefineApplyResult {
  const providerCandidate: AiTripDraft = {
    ...providerDraft,
    destination: currentDraft.destination,
    endDate: currentDraft.endDate,
    startDate: currentDraft.startDate,
    title: currentDraft.title,
  }
  const providerValidation = validateAiTripDraft(providerCandidate)
  if (!providerValidation.valid || !providerValidation.draft) {
    return { errors: ['优化结果未通过校验，请重试。'], ok: false }
  }

  const targetDates = getAiTripDraftRefineScopeDates(currentDraft, scope)
  if (targetDates.length === 0) {
    return { errors: ['没有可替换的目标日期。'], ok: false }
  }

  const providerDaysByDate = new Map<string, AiTripDraftDay>()
  for (const day of providerValidation.draft.days) {
    providerDaysByDate.set(day.date, day)
  }

  const missingDate = targetDates.find((date) => !providerDaysByDate.has(date))
  if (missingDate) {
    return { errors: [`优化结果缺少目标日期 ${missingDate}。`], ok: false }
  }

  const nextDraft: AiTripDraft = {
    ...currentDraft,
    days: currentDraft.days.map((day) => {
      if (!targetDates.includes(day.date)) {
        return day
      }
      return providerDaysByDate.get(day.date) ?? day
    }),
  }

  const nextValidation = validateAiTripDraft(nextDraft)
  if (!nextValidation.valid || !nextValidation.draft) {
    return {
      errors: nextValidation.errors.map((error) => `${error.path}: ${error.message}`),
      ok: false,
    }
  }

  return { draft: nextValidation.draft, ok: true }
}

export function applyAiTripDraftRefineResultIfFresh({
  baselineFingerprint,
  currentDraft,
  providerDraft,
  scope,
}: {
  baselineFingerprint: string
  currentDraft: AiTripDraft
  providerDraft: AiTripDraft
  scope: ProviderProxyAiTripDraftRefineScope
}): AiTripDraftRefineApplyResult {
  if (fingerprintAiTripDraft(currentDraft) !== baselineFingerprint) {
    return { errors: ['草案已变化，请重新生成。'], ok: false }
  }
  return applyAiTripDraftRefineResult(currentDraft, providerDraft, scope)
}
