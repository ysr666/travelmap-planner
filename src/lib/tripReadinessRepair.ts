import {
  TRIP_CONTENT_ENRICHMENT_MAX_ITEMS,
  generateTripContentEnrichmentPreview,
  type TripContentEnrichmentPreview,
} from './ai/tripContentEnrichment'
import {
  generateEnhancedTripDailyTravelTip,
  type TripDailyTravelTipEnhancedPreview,
  type TripDailyTravelTipModel,
} from './ai/tripDailyTravelTip'
import { retryTicketBlobUpload } from './cloudObjectSync'
import { getProviderProxyConfig, type ProviderProxyRuntimeConfig } from './providerProxyClient'
import { generateRoutePreviewsForTrip, type RouteGenerationBatchResult } from './routeGeneration'
import { getRoutingConfig } from './routing'
import type { TripReadinessRepairPreview } from './tripReadiness'
import type { Day, ItineraryItem, Trip } from '../types'

export type TripReadinessRepairExecutionResult = {
  contentPreview: TripContentEnrichmentPreview | null
  dailyTipPreview: TripDailyTravelTipEnhancedPreview | null
  messages: string[]
  routeResult?: RouteGenerationBatchResult
  retriedTicketIds: string[]
  ticketErrors: string[]
  ticketRetryCount: number
}

export type ExecuteTripReadinessRepairPreviewInput = {
  allItems: ItineraryItem[]
  dailyTipModel: TripDailyTravelTipModel | null
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  preview: TripReadinessRepairPreview
  providerConfig?: ProviderProxyRuntimeConfig
  trip: Trip
}

export async function executeTripReadinessRepairPreview({
  allItems,
  dailyTipModel,
  days,
  itemsByDay,
  preview,
  providerConfig = getProviderProxyConfig(),
  trip,
}: ExecuteTripReadinessRepairPreviewInput): Promise<TripReadinessRepairExecutionResult> {
  const itemById = new Map(allItems.map((item) => [item.id, item]))
  const result: TripReadinessRepairExecutionResult = {
    contentPreview: null,
    dailyTipPreview: null,
    messages: [],
    retriedTicketIds: [],
    ticketErrors: [],
    ticketRetryCount: 0,
  }

  if (preview.routeDayIds.length > 0) {
    result.routeResult = await generateRoutePreviewsForTrip({
      config: getRoutingConfig(),
      days,
      itemsByDay,
      targetDayIds: preview.routeDayIds,
      tripId: trip.id,
    })
    result.messages.push(`已处理 ${result.routeResult.generatedCount} 天路线缓存。`)
  }

  if (preview.ticketIds.length > 0) {
    const settled = await Promise.allSettled(preview.ticketIds.map((ticketId) => retryTicketBlobUpload(ticketId)))
    result.retriedTicketIds = settled.flatMap((entry, index) =>
      entry.status === 'fulfilled' ? [preview.ticketIds[index]] : [],
    )
    result.ticketRetryCount = result.retriedTicketIds.length
    result.ticketErrors = settled
      .filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
      .map((entry) => entry.reason instanceof Error ? entry.reason.message : '票据重试失败。')
    result.messages.push(`已将 ${result.ticketRetryCount} 张票据置为待上传。`)
  }

  if (preview.contentItemIds.length > 0) {
    const targets = preview.contentItemIds
      .map((itemId) => itemById.get(itemId))
      .filter((item): item is ItineraryItem => Boolean(item))
      .slice(0, TRIP_CONTENT_ENRICHMENT_MAX_ITEMS)
    if (!providerConfig.proxyUrl) {
      result.messages.push('内容补充预览需要 provider proxy，当前已跳过。')
    } else if (targets.length > 0) {
      result.contentPreview = await generateTripContentEnrichmentPreview({
        days,
        items: allItems,
        proxyUrl: providerConfig.proxyUrl,
        targets,
        trip,
      })
      result.messages.push(`已生成 ${result.contentPreview.items.length} 个内容补充待应用预览。`)
    }
  }

  if (preview.dailyTipRequested) {
    if (!providerConfig.proxyUrl) {
      result.messages.push('每日提示预览需要 provider proxy，当前已跳过。')
    } else if (!dailyTipModel) {
      result.messages.push('当前没有可生成每日提示的目标日期。')
    } else {
      result.dailyTipPreview = await generateEnhancedTripDailyTravelTip({
        model: dailyTipModel,
        proxyUrl: providerConfig.proxyUrl,
        trip,
      })
      result.messages.push('已生成每日旅行提示待保存预览。')
    }
  }

  return result
}
