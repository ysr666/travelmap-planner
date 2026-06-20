import { mapDocumentInputToSuggestions, type TripIntelligenceDocumentInput } from './adapters/documentAdapter'
import { mapInboxInputToSuggestions, type TripIntelligenceInboxInput } from './adapters/inboxAdapter'
import { mapLedgerDraftCandidatesToSuggestions, mapLedgerReviewEntriesToSuggestions } from './adapters/ledgerAdapter'
import { mapLiveModelToSuggestions } from './adapters/liveAdapter'
import { mapTripOperationsModelToSuggestions } from './adapters/operationsAdapter'
import { mapReadinessIssuesToSuggestions } from './adapters/readinessAdapter'
import { mapSharedTripMutationsToSuggestions } from './adapters/sharedTripAdapter'
import { mapTicketsToSuggestions, type TripIntelligenceTicketInput } from './adapters/ticketAdapter'
import type { LedgerExpenseDraftCandidate } from '../ledgerExtraction'
import type { LedgerReviewEntry } from '../ledgerReview'
import type { TripLiveModel } from '../tripLiveMode'
import type { TripOperationsModel } from '../tripOperationsAgent'
import type { TripReadinessModel } from '../tripReadiness'
import type { ItineraryItem, SharedTripMutation, TripIntelligenceSuggestionStateRecord, TripReplanRecord } from '../../types'
import type { TripIntelligenceModel, TripIntelligenceSourceKind, TripIntelligenceSuggestion } from './types'

export type BuildTripIntelligenceModelInput = {
  documentInput?: TripIntelligenceDocumentInput | null
  inbox?: TripIntelligenceInboxInput | null
  items?: ItineraryItem[]
  ledgerDraftCandidates?: LedgerExpenseDraftCandidate[]
  ledgerReviewEntries?: LedgerReviewEntry[]
  liveModel?: TripLiveModel | null
  liveReplanRecord?: TripReplanRecord | null
  operationsModel?: TripOperationsModel | null
  readinessModel?: TripReadinessModel | null
  sharedMutations?: SharedTripMutation[]
  suggestionStates?: TripIntelligenceSuggestionStateRecord[]
  ticketInput?: TripIntelligenceTicketInput | null
}

const SOURCE_ORDER: Record<TripIntelligenceSourceKind, number> = {
  operations: 0,
  readiness: 1,
  inbox: 2,
  live: 3,
  ticket: 4,
  ledger: 5,
  shared_trip: 6,
  document: 7,
}

const SEVERITY_ORDER: Record<TripIntelligenceSuggestion['severity'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export function buildTripIntelligenceModel({
  documentInput,
  inbox,
  items = [],
  ledgerDraftCandidates = [],
  ledgerReviewEntries = [],
  liveModel,
  liveReplanRecord,
  operationsModel,
  readinessModel,
  sharedMutations = [],
  suggestionStates = [],
  ticketInput,
}: BuildTripIntelligenceModelInput): TripIntelligenceModel {
  const allSuggestions = sortSuggestions(applySuggestionStateOverlay(dedupeSuggestions([
    ...mapTripOperationsModelToSuggestions(operationsModel),
    ...mapReadinessIssuesToSuggestions(readinessModel?.issues ?? []),
    ...mapInboxInputToSuggestions(inbox),
    ...mapLiveModelToSuggestions(liveModel, { replanRecord: liveReplanRecord }),
    ...mapTicketsToSuggestions(ticketInput),
    ...mapLedgerDraftCandidatesToSuggestions(ledgerDraftCandidates),
    ...mapLedgerReviewEntriesToSuggestions(ledgerReviewEntries),
    ...mapSharedTripMutationsToSuggestions(sharedMutations),
    ...mapDocumentInputToSuggestions(documentInput),
  ]), suggestionStates))
  const activeSuggestions = allSuggestions.filter((suggestion) =>
    suggestion.status === 'pending' || suggestion.status === 'needs_confirmation',
  )
  const itemDayById = new Map(items.map((item) => [item.id, item.dayId]))

  return {
    allSuggestions,
    forDay: (dayId) => activeSuggestions.filter((suggestion) => isDayContextSuggestion(suggestion, dayId, itemDayById)),
    forDocument: () => activeSuggestions.filter((suggestion) => suggestion.scope === 'document'),
    forFinance: () => activeSuggestions.filter((suggestion) => suggestion.scope === 'finance'),
    forInbox: () => activeSuggestions.filter((suggestion) => suggestion.scope === 'inbox'),
    forItem: (itemId) => activeSuggestions.filter((suggestion) => suggestion.affectedItemIds.includes(itemId)),
    forSharedTrip: () => activeSuggestions.filter((suggestion) => suggestion.scope === 'shared_trip' || suggestion.source.kind === 'shared_trip'),
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

function applySuggestionStateOverlay(
  suggestions: TripIntelligenceSuggestion[],
  states: TripIntelligenceSuggestionStateRecord[],
) {
  if (states.length === 0) return suggestions
  const now = Date.now()
  const stateByKey = new Map<string, TripIntelligenceSuggestionStateRecord>()
  for (const state of states) {
    if (state.status === 'later' && (!state.until || state.until <= now)) continue
    const current = stateByKey.get(state.suggestionKey)
    if (!current || state.updatedAt > current.updatedAt) stateByKey.set(state.suggestionKey, state)
  }
  return suggestions.map((suggestion) => {
    const state = stateByKey.get(suggestion.key)
    if (!state || (state.status === 'later' && state.legacyFingerprint)) return suggestion
    return { ...suggestion, status: state.status }
  })
}

const DAY_CONTEXT_SCOPES = new Set<TripIntelligenceSuggestion['scope']>(['day', 'item', 'live', 'ticket'])

function isDayContextSuggestion(
  suggestion: TripIntelligenceSuggestion,
  dayId: string,
  itemDayById: Map<string, string>,
) {
  if (!DAY_CONTEXT_SCOPES.has(suggestion.scope)) return false
  if (suggestion.affectedDayIds.includes(dayId)) return true
  return suggestion.affectedItemIds.some((itemId) => itemDayById.get(itemId) === dayId)
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
