import { isAdaptiveTripReplanRecord } from '../db'
import { buildTripContext } from './ai/aiTripContext'
import { buildTripDailyTravelTip } from './ai/tripDailyTravelTip'
import { formatShortDate } from './dates'
import { analyzeTripContext } from './tripCheck'
import { buildTripIntelligenceModel } from './tripIntelligence'
import { buildTripLiveModel } from './tripLiveMode'
import { buildTripOperationsModel } from './tripOperationsAgent'
import type { TripOperationsLocalState } from './tripOperationsState'
import type { TripRoutePreparation } from './routePreparation'
import { buildTripReadinessModel } from './tripReadiness'
import { getStoredTravelProfile } from './travelProfile'
import { buildDayBrief } from './travelBrief'
import { getZonedPlainDate, resolveDayTimeZone } from './timeZone'
import type {
  Day,
  ItineraryItem,
  TicketMeta,
  Trip,
  TripDisruptionEvent,
  TripIntelligenceSuggestionStateRecord,
  TripReplanRecord,
} from '../types'

type BuildDayWorkspaceViewModelInput = {
  allItems: ItineraryItem[]
  days: Day[]
  items: ItineraryItem[]
  itemsByDay: Record<string, ItineraryItem[]>
  liveNow: Date
  routePreparation: TripRoutePreparation | null
  selectedDay: Day
  suggestionStates: TripIntelligenceSuggestionStateRecord[]
  tickets: TicketMeta[]
  trip: Trip
  tripDisruptionEvents: TripDisruptionEvent[]
  tripOperationsLocalState: TripOperationsLocalState
  tripReplanRecords: TripReplanRecord[]
}

export function buildDayWorkspaceViewModel({
  allItems,
  days,
  items,
  itemsByDay,
  liveNow,
  routePreparation,
  selectedDay,
  suggestionStates,
  tickets,
  trip,
  tripDisruptionEvents,
  tripOperationsLocalState,
  tripReplanRecords,
}: BuildDayWorkspaceViewModelInput) {
  const dayContextItems = allItems.length > 0 ? allItems : items
  const selectedRouteDay = routePreparation?.days.find((routeDay) => routeDay.day.id === selectedDay.id) ?? null
  const tripContextForDay = buildTripContext({
    days,
    items: dayContextItems,
    nowPlainDate: getZonedPlainDate(new Date(), resolveDayTimeZone(trip, selectedDay)),
    profile: getStoredTravelProfile(),
    selectedDayId: selectedDay.id,
    tickets,
    trip,
  })
  const tripCheckForDay = analyzeTripContext(tripContextForDay)
  const dayBrief = buildDayBrief(tripContextForDay, tripCheckForDay, selectedDay.id)
  const dailyTipModel = buildTripDailyTravelTip({
    days,
    itemsByDay,
    now: liveNow,
    routePreparation,
    trip,
    tripCheck: tripCheckForDay,
  })
  const readinessModel = buildTripReadinessModel({
    allItems: dayContextItems,
    dailyTipModel,
    days,
    itemsByDay,
    routePreparation,
    tickets,
    trip,
    tripCheck: tripCheckForDay,
  })
  const tripOperationsModel = buildTripOperationsModel({
    allItems: dayContextItems,
    dailyTipModel,
    days,
    dispositions: tripOperationsLocalState.dispositions,
    itemsByDay,
    now: liveNow,
    readinessModel,
    routePreparation,
    tickets,
    trip,
    tripDisruptionEvents,
    tripReplanRecords,
  })
  const dayLiveModel = buildTripLiveModel({
    day: selectedDay,
    items,
    now: liveNow,
    operations: { recommendations: tripOperationsModel.activeRecommendations },
    routeDay: selectedRouteDay,
    tickets,
    trip,
  })
  const dayContextItemById = new Map(dayContextItems.map((item) => [item.id, item]))
  const dayLiveReplanRecord = selectLatestActiveDayReplanRecord(tripReplanRecords, selectedDay.id)
  const dayIntelligenceModel = buildTripIntelligenceModel({
    items: dayContextItems,
    liveModel: dayLiveModel,
    liveReplanRecord: dayLiveReplanRecord,
    operationsModel: tripOperationsModel,
    readinessModel,
    suggestionStates,
  })
  const dayIntelligenceSuggestions = dayIntelligenceModel.forDay(selectedDay.id).slice(0, 5)
  const hiddenDayIntelligenceSuggestions = dayIntelligenceModel.allSuggestions.filter((suggestion) => {
    if (suggestion.status !== 'ignored' && suggestion.status !== 'later') return false
    if (suggestion.affectedDayIds.includes(selectedDay.id)) return true
    return suggestion.affectedItemIds.some((itemId) => dayContextItemById.get(itemId)?.dayId === selectedDay.id)
  })

  return {
    dayBrief,
    dayContextItemById,
    dayContextItems,
    dayDateLabel: formatShortDate(selectedDay.date),
    dayIndex: days.findIndex((day) => day.id === selectedDay.id) + 1,
    dayIntelligenceSuggestions,
    hiddenDayIntelligenceSuggestions,
    selectedRouteDay,
    tripOperationsModel,
  }
}

export type DayWorkspaceViewModel = ReturnType<typeof buildDayWorkspaceViewModel>

const ACTIVE_DAY_REPLAN_RECORD_STATUSES = new Set<TripReplanRecord['status']>(['preview', 'applied', 'conflict'])

function selectLatestActiveDayReplanRecord(records: TripReplanRecord[], dayId: string) {
  return records
    .filter((record) =>
      isAdaptiveTripReplanRecord(record)
      && ACTIVE_DAY_REPLAN_RECORD_STATUSES.has(record.status)
      && dayReplanRecordTouchesDay(record, dayId),
    )
    .sort((left, right) => (right.updatedAt - left.updatedAt) || (right.createdAt - left.createdAt))[0] ?? null
}

function dayReplanRecordTouchesDay(record: TripReplanRecord, dayId: string) {
  return record.beforeSnapshot.days.some((snapshotDay) => snapshotDay.id === dayId)
    || record.beforeSnapshot.items.some((item) => item.dayId === dayId)
    || Boolean(record.afterSnapshot?.days.some((snapshotDay) => snapshotDay.id === dayId))
    || Boolean(record.afterSnapshot?.items.some((item) => item.dayId === dayId))
    || Boolean(record.selectedDiff?.routeImpacts.some((impact) => impact.dayId === dayId))
    || Boolean(record.selectedDiff?.itemChanges.some((change) => change.before.dayId === dayId || change.after.dayId === dayId))
}
