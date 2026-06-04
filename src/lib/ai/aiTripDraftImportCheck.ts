import type { AiTripDraft } from './aiTripDraft'
import { evaluateTripRoutePreparation, getPersistentRouteProvider } from '../routePreparation'
import type { RoutingConfig } from '../routing'
import type { Day, ItineraryItem } from '../../types'

export type AiTripDraftImportCheck = {
  autoSyncEnabled: boolean
  autoSyncMessage: string
  dateRangeLabel: string
  dayCount: number
  dailyTipCount: number
  destination: string
  invalidCoordinateCount: number
  itemCount: number
  missingCoordinateCount: number
  routeEligibleDayCount: number
  routeProviderConfigured: boolean
  routeReadyDayCount: number
  routeSummary: string
  title: string
  validCoordinateCount: number
}

export function buildAiTripDraftImportCheck({
  autoSyncEnabled,
  draft,
  routingConfig,
}: {
  autoSyncEnabled: boolean
  draft: AiTripDraft
  routingConfig: RoutingConfig
}): AiTripDraftImportCheck {
  const records = buildDraftImportCheckRecords(draft)
  const preparation = evaluateTripRoutePreparation({
    cachesByDay: {},
    days: records.days,
    itemsByDay: records.itemsByDay,
    provider: getPersistentRouteProvider(routingConfig),
    tripId: records.tripId,
  })
  const counts = countDraftImportCoordinates(draft)
  const dailyTipCount = draft.days.reduce((sum, day) => sum + (day.tips?.filter((tip) => tip.trim()).length ?? 0), 0)

  return {
    autoSyncEnabled,
    autoSyncMessage: autoSyncEnabled
      ? '导入后会标记为等待同步；若已登录并配置云端保存，现有云端自动同步会后台处理。'
      : '云端自动同步已关闭；导入后只会保存在当前设备。',
    dateRangeLabel: `${draft.startDate} 至 ${draft.endDate}`,
    dayCount: draft.days.length,
    dailyTipCount,
    destination: draft.destination || '目的地未填写',
    invalidCoordinateCount: counts.invalidCoordinateCount,
    itemCount: counts.itemCount,
    missingCoordinateCount: counts.missingCoordinateCount,
    routeEligibleDayCount: preparation.eligibleDayCount,
    routeProviderConfigured: preparation.providerConfigured,
    routeReadyDayCount: preparation.targetDayIds.length,
    routeSummary: describeDraftRouteImportCheck(preparation.providerConfigured, preparation.targetDayIds.length, preparation.eligibleDayCount),
    title: draft.title,
    validCoordinateCount: counts.validCoordinateCount,
  }
}

function buildDraftImportCheckRecords(draft: AiTripDraft) {
  const tripId = 'draft-import-check-trip'
  const days: Day[] = []
  const itemsByDay: Record<string, ItineraryItem[]> = {}

  draft.days.forEach((day, dayIndex) => {
    const dayId = `draft-import-check-day-${dayIndex}`
    days.push({
      date: day.date,
      id: dayId,
      sortOrder: dayIndex,
      title: day.title ?? `第 ${dayIndex + 1} 天`,
      tripId,
    })
    itemsByDay[dayId] = day.items.map((item, itemIndex) => ({
      address: item.address,
      createdAt: 0,
      dayId,
      endTime: item.endTime,
      id: `draft-import-check-item-${dayIndex}-${itemIndex}`,
      lat: item.lat,
      lng: item.lng,
      locationName: item.locationName,
      notes: item.note,
      previousTransportDurationMinutes: item.previousTransportDurationMinutes,
      previousTransportMode: item.previousTransportMode,
      previousTransportNote: item.previousTransportNote,
      sortOrder: itemIndex,
      startTime: item.startTime,
      ticketIds: [],
      title: item.title,
      tripId,
      updatedAt: 0,
    }))
  })

  return { days, itemsByDay, tripId }
}

function countDraftImportCoordinates(draft: AiTripDraft) {
  let invalidCoordinateCount = 0
  let itemCount = 0
  let missingCoordinateCount = 0
  let validCoordinateCount = 0

  for (const day of draft.days) {
    for (const item of day.items) {
      itemCount += 1
      if (typeof item.lat !== 'number' && typeof item.lng !== 'number') {
        missingCoordinateCount += 1
        continue
      }
      if (isValidLatLng(item.lat, item.lng)) {
        validCoordinateCount += 1
      } else {
        invalidCoordinateCount += 1
      }
    }
  }

  return {
    invalidCoordinateCount,
    itemCount,
    missingCoordinateCount,
    validCoordinateCount,
  }
}

function isValidLatLng(lat: unknown, lng: unknown) {
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  )
}

function describeDraftRouteImportCheck(
  providerConfigured: boolean,
  readyDayCount: number,
  eligibleDayCount: number,
) {
  if (readyDayCount > 0) {
    return `导入后会提示可生成 ${readyDayCount} 天路线；确认生成前不会调用路线服务。`
  }
  if (eligibleDayCount > 0 && !providerConfigured) {
    return `${eligibleDayCount} 天具备坐标条件，但当前路线服务未配置。`
  }
  if (eligibleDayCount > 0) {
    return '具备坐标条件的日程会在导入后由路线提示继续检查。'
  }
  return '暂无可生成路线的日程；每日至少需要两个有效坐标点。'
}
