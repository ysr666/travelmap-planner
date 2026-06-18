import { mapInboxInputToSuggestions, type TripIntelligenceInboxInput } from './adapters/inboxAdapter'
import { mapLedgerReviewEntriesToSuggestions } from './adapters/ledgerAdapter'
import { mapLiveModelToSuggestions } from './adapters/liveAdapter'
import { mapTripOperationsModelToSuggestions } from './adapters/operationsAdapter'
import { mapReadinessIssuesToSuggestions } from './adapters/readinessAdapter'
import { mapSharedTripMutationsToSuggestions } from './adapters/sharedTripAdapter'
import type { LedgerReviewEntry } from '../ledgerReview'
import type { TripLiveModel } from '../tripLiveMode'
import type { TripOperationsModel } from '../tripOperationsAgent'
import type { TripReadinessModel } from '../tripReadiness'
import type { SharedTripMutation } from '../../types'
import type { TripIntelligenceModel, TripIntelligenceSourceKind, TripIntelligenceSuggestion } from './types'

export type BuildTripIntelligenceModelInput = {
  inbox?: TripIntelligenceInboxInput | null
  ledgerReviewEntries?: LedgerReviewEntry[]
  liveModel?: TripLiveModel | null
  operationsModel?: TripOperationsModel | null
  readinessModel?: TripReadinessModel | null
  sharedMutations?: SharedTripMutation[]
}

const SOURCE_ORDER: Record<TripIntelligenceSourceKind, number> = {
  operations: 0,
  readiness: 1,
  inbox: 2,
  live: 3,
  ledger: 4,
  shared_trip: 5,
}

const SEVERITY_ORDER: Record<TripIntelligenceSuggestion['severity'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export function buildTripIntelligenceModel({
  inbox,
  ledgerReviewEntries = [],
  liveModel,
  operationsModel,
  readinessModel,
  sharedMutations = [],
}: BuildTripIntelligenceModelInput): TripIntelligenceModel {
  const allSuggestions = sortSuggestions(dedupeSuggestions([
    ...mapTripOperationsModelToSuggestions(operationsModel),
    ...mapReadinessIssuesToSuggestions(readinessModel?.issues ?? []),
    ...mapInboxInputToSuggestions(inbox),
    ...mapLiveModelToSuggestions(liveModel),
    ...mapLedgerReviewEntriesToSuggestions(ledgerReviewEntries),
    ...mapSharedTripMutationsToSuggestions(sharedMutations),
  ]))
  const activeSuggestions = allSuggestions.filter((suggestion) =>
    suggestion.status === 'pending' || suggestion.status === 'needs_confirmation',
  )

  return {
    allSuggestions,
    forDay: (dayId) => activeSuggestions.filter((suggestion) => suggestion.affectedDayIds.includes(dayId)),
    forFinance: () => activeSuggestions.filter((suggestion) => suggestion.scope === 'finance'),
    forInbox: () => activeSuggestions.filter((suggestion) => suggestion.scope === 'inbox'),
    forItem: (itemId) => activeSuggestions.filter((suggestion) => suggestion.affectedItemIds.includes(itemId)),
    forTicket: (ticketId) => activeSuggestions.filter((suggestion) => suggestion.ticketIds.includes(ticketId)),
    forTripHome: () => activeSuggestions,
    suggestions: activeSuggestions,
    summary: {
      highRiskCount: activeSuggestions.filter((suggestion) => suggestion.severity === 'high').length,
      needsConfirmationCount: activeSuggestions.filter((suggestion) => suggestion.status === 'needs_confirmation').length,
      totalCount: activeSuggestions.length,
    },
  }
}

export function sortSuggestions(suggestions: TripIntelligenceSuggestion[]) {
  return [...suggestions].sort((first, second) =>
    SEVERITY_ORDER[first.severity] - SEVERITY_ORDER[second.severity]
    || first.priority - second.priority
    || SOURCE_ORDER[first.source.kind] - SOURCE_ORDER[second.source.kind]
    || first.title.localeCompare(second.title, 'zh-Hans-CN')
    || first.id.localeCompare(second.id),
  )
}

export function dedupeSuggestions(suggestions: TripIntelligenceSuggestion[]) {
  const byKey = new Map<string, TripIntelligenceSuggestion>()
  for (const suggestion of suggestions) {
    const existing = byKey.get(suggestion.key)
    if (!existing || SOURCE_ORDER[suggestion.source.kind] < SOURCE_ORDER[existing.source.kind]) {
      byKey.set(suggestion.key, suggestion)
    }
  }
  return [...byKey.values()]
}

