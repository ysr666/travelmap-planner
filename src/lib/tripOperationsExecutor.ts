import type { TripContentEnrichmentPreview } from './ai/tripContentEnrichment'
import type { TripDailyTravelTipEnhancedPreview, TripDailyTravelTipModel } from './ai/tripDailyTravelTip'
import { clearSyncedTicketBlobCache } from './cloudObjectSync'
import type { ProviderProxyRuntimeConfig } from './providerProxyClient'
import type { TripOperationsRecommendation } from './tripOperationsAgent'
import type {
  TripOperationsAppliedChange,
  TripOperationsExecutionOutcome,
  TripOperationsExecutionResult,
} from './tripOperationsState'
import { buildTripReadinessRepairPreview, type TripReadinessModel } from './tripReadiness'
import { executeTripReadinessRepairPreview } from './tripReadinessRepair'
import { getTicketDisplayTitle } from './tickets'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

export type TripOperationsPendingPreview = {
  contentPreview: TripContentEnrichmentPreview | null
  dailyTipPreview: TripDailyTravelTipEnhancedPreview | null
  fingerprint: string
}

export type ExecuteTripOperationsRecommendationsResult = TripOperationsExecutionResult & {
  pendingPreviews: TripOperationsPendingPreview[]
}

export async function executeTripOperationsRecommendations({
  allItems,
  dailyTipModel,
  days,
  itemsByDay,
  now = Date.now(),
  providerConfig,
  readinessModel,
  recommendations,
  tickets,
  trip,
}: {
  allItems: ItineraryItem[]
  dailyTipModel: TripDailyTravelTipModel | null
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  now?: number
  providerConfig?: ProviderProxyRuntimeConfig
  readinessModel: TripReadinessModel
  recommendations: TripOperationsRecommendation[]
  tickets: TicketMeta[]
  trip: Trip
}): Promise<ExecuteTripOperationsRecommendationsResult> {
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  const outcomes: TripOperationsExecutionOutcome[] = []
  const pendingPreviews: TripOperationsPendingPreview[] = []

  for (const recommendation of recommendations) {
    if (recommendation.executionMode !== 'confirmed_low_risk' && recommendation.executionMode !== 'preview_low_risk') {
      outcomes.push(failedOutcome(recommendation, '此建议需要单独预览或人工处理。'))
      continue
    }

    if (recommendation.actionKind === 'clear_ticket_cache') {
      const settled = await Promise.allSettled(
        recommendation.ticketIds.map((ticketId) => clearSyncedTicketBlobCache(ticketId)),
      )
      const appliedChanges = settled.flatMap((entry, index) => {
        if (entry.status === 'rejected') return []
        const ticketId = recommendation.ticketIds[index]
        const title = ticketById.get(ticketId) ? getTicketDisplayTitle(ticketById.get(ticketId)!) : '票据'
        return [buildAppliedChange({
          action: 'cleared_ticket_cache',
          detail: '已删除此设备离线缓存，云端文件保持不变。',
          now,
          target: 'tickets',
          ticketId,
          title,
        })]
      })
      const errors = settled.flatMap((entry) =>
        entry.status === 'rejected' ? [toErrorMessage(entry.reason, '票据缓存清理失败。')] : [],
      )
      outcomes.push(buildOutcome(recommendation, appliedChanges, errors, [
        appliedChanges.length > 0 ? `已清理 ${appliedChanges.length} 张票据缓存。` : '',
      ]))
      continue
    }

    try {
      const preview = buildTripReadinessRepairPreview(
        readinessModel,
        recommendation.readinessIssueIds,
        'single',
      )
      const result = await executeTripReadinessRepairPreview({
        allItems,
        dailyTipModel,
        days,
        itemsByDay,
        preview,
        providerConfig,
        trip,
      })
      const appliedChanges: TripOperationsAppliedChange[] = []
      const errors = [...result.ticketErrors]

      for (const routeOutcome of result.routeResult?.outcomes ?? []) {
        if (!routeOutcome.saved && routeOutcome.status !== 'cached') {
          if (routeOutcome.status === 'failed') errors.push(routeOutcome.message)
          continue
        }
        appliedChanges.push(buildAppliedChange({
          action: 'generated_route',
          dayId: routeOutcome.day.id,
          detail: routeOutcome.message,
          now,
          target: 'day',
          title: routeOutcome.day.title,
        }))
      }

      for (const ticketId of result.retriedTicketIds) {
        const ticket = ticketById.get(ticketId)
        appliedChanges.push(buildAppliedChange({
          action: 'retried_ticket_upload',
          detail: '已重新加入票据上传队列。',
          now,
          target: 'tickets',
          ticketId,
          title: ticket ? getTicketDisplayTitle(ticket) : '票据',
        }))
      }

      if (result.contentPreview || result.dailyTipPreview) {
        pendingPreviews.push({
          contentPreview: result.contentPreview,
          dailyTipPreview: result.dailyTipPreview,
          fingerprint: recommendation.fingerprint,
        })
      }
      const pendingPreview = Boolean(result.contentPreview || result.dailyTipPreview)
      const status = pendingPreview
        ? 'pending_preview'
        : appliedChanges.length > 0 && errors.length > 0
          ? 'partial'
          : appliedChanges.length > 0
            ? 'applied'
            : 'failed'
      outcomes.push({
        appliedChanges,
        errors: status === 'failed' && errors.length === 0 ? ['没有可执行的修改。'] : errors,
        fingerprint: recommendation.fingerprint,
        messages: result.messages,
        recommendationId: recommendation.id,
        status,
      })
    } catch (error) {
      outcomes.push(failedOutcome(recommendation, toErrorMessage(error, '建议执行失败。')))
    }
  }

  return {
    appliedChanges: outcomes.flatMap((outcome) => outcome.appliedChanges),
    outcomes,
    pendingPreviews,
  }
}

function buildOutcome(
  recommendation: TripOperationsRecommendation,
  appliedChanges: TripOperationsAppliedChange[],
  errors: string[],
  messages: string[],
): TripOperationsExecutionOutcome {
  return {
    appliedChanges,
    errors,
    fingerprint: recommendation.fingerprint,
    messages: messages.filter(Boolean),
    recommendationId: recommendation.id,
    status: appliedChanges.length > 0 && errors.length > 0
      ? 'partial'
      : appliedChanges.length > 0
        ? 'applied'
        : 'failed',
  }
}

function failedOutcome(
  recommendation: TripOperationsRecommendation,
  error: string,
): TripOperationsExecutionOutcome {
  return {
    appliedChanges: [],
    errors: [error],
    fingerprint: recommendation.fingerprint,
    messages: [],
    recommendationId: recommendation.id,
    status: 'failed',
  }
}

function buildAppliedChange({
  action,
  dayId,
  detail,
  now,
  target,
  ticketId,
  title,
}: Omit<TripOperationsAppliedChange, 'occurredAt'> & { now: number }): TripOperationsAppliedChange {
  return { action, dayId, detail, occurredAt: now, target, ticketId, title }
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
