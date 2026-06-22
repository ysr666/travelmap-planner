import type {
  ReminderSchedule,
  TicketMeta,
  TransportBooking,
  TransportSegment,
  TravelCenterSyncConflict,
  TravelDocumentData,
  TravelDocumentKind,
  TravelDocumentStatus,
  Trip,
} from '../../../types'
import { plainDateDaysBetween, todayInTimeZone } from '../../timeSemantics'
import { resolveTripTimeZone } from '../../timeZone'
import type { TripIntelligenceSuggestion } from '../types'

export type TripIntelligenceDocumentRecord = {
  data: TravelDocumentData
  id: string
}

export type TripIntelligenceDocumentInput = {
  documentTripIds?: Record<string, string[]>
  documents?: TripIntelligenceDocumentRecord[]
  legacyTickets?: TicketMeta[]
  now?: Date | number | string
  reminders?: ReminderSchedule[]
  selectedTrip?: Pick<Trip, 'id' | 'timeZone'> | null
  syncConflicts?: TravelCenterSyncConflict[]
  transportBookings?: TransportBooking[]
  transportSegmentsByBooking?: Record<string, TransportSegment[]>
  vaultUnlocked?: boolean
}

const DOCUMENT_SOURCE = {
  id: 'document_vault',
  kind: 'document' as const,
  label: 'Document Vault',
}

const DOCUMENT_KIND_LABELS: Record<TravelDocumentKind, string> = {
  discount_card: '交通/优惠卡',
  entry_permit: '入境许可',
  insurance: '旅行保险',
  loyalty_card: '会员卡',
  other: '旅行资料',
  passport: '护照',
  residence_permit: '居留许可',
  visa: '签证',
}

const DOCUMENT_STATUS_LABELS: Record<TravelDocumentStatus, string> = {
  active: '有效',
  applied: '已申请',
  approved: '已批准',
  cancelled: '已取消',
  draft: '准备中',
  expired: '已过期',
  rejected: '被拒',
}

const VISA_OR_INSURANCE_KINDS = new Set<TravelDocumentKind>(['entry_permit', 'insurance', 'residence_permit', 'visa'])
const ACTIVE_DOCUMENT_STATUSES = new Set<TravelDocumentStatus>(['active', 'approved'])
const ATTENTION_DOCUMENT_STATUSES = new Set<TravelDocumentStatus>(['cancelled', 'expired', 'rejected'])
export function mapDocumentInputToSuggestions(input?: TripIntelligenceDocumentInput | null): TripIntelligenceSuggestion[] {
  if (!input) return []
  const now = normalizeInstant(input.now)
  const today = todayInTimeZone(resolveTripTimeZone(input.selectedTrip), now)
  const reminders = (input.reminders ?? []).filter((reminder) => reminder.status === 'pending')
  const suggestions: TripIntelligenceSuggestion[] = []

  const pendingConflicts = (input.syncConflicts ?? []).filter((conflict) => conflict.status === 'pending')
  if (pendingConflicts.length > 0) {
    suggestions.push(documentSuggestion({
      actionKind: 'document_open_sync_conflicts',
      actionLabel: '查看冲突',
      idPart: 'sync-conflicts',
      message: `有 ${pendingConflicts.length} 条资料同步冲突需要选择保留版本。`,
      priority: 6,
      requiresConfirmation: true,
      severity: 'high',
      status: 'needs_confirmation',
      title: '资料同步冲突待处理',
    }))
  }

  for (const document of input.documents ?? []) {
    const kindLabel = DOCUMENT_KIND_LABELS[document.data.kind]
    const daysUntilExpiry = getDaysUntilDate(document.data.validUntil, today)
    if (document.data.status === 'expired' || (typeof daysUntilExpiry === 'number' && daysUntilExpiry < 0)) {
      suggestions.push(documentSuggestion({
        actionKind: 'document_review_expiry',
        actionLabel: '检查资料',
        idPart: `expired:${document.id}`,
        message: `一项${kindLabel}已经过期，需要更新或替换。`,
        priority: 10,
        requiresConfirmation: true,
        severity: 'high',
        sourceId: document.id,
        sourceLabel: kindLabel,
        status: 'needs_confirmation',
        title: `${kindLabel}已过期`,
      }))
    } else if (typeof daysUntilExpiry === 'number' && daysUntilExpiry <= 30 && ACTIVE_DOCUMENT_STATUSES.has(document.data.status)) {
      suggestions.push(documentSuggestion({
        actionKind: 'document_review_expiry',
        actionLabel: '检查资料',
        idPart: `expiring:${document.id}`,
        message: `一项${kindLabel}将在 30 天内到期，建议提前确认。`,
        priority: 18,
        requiresConfirmation: true,
        severity: 'medium',
        sourceId: document.id,
        sourceLabel: kindLabel,
        status: 'needs_confirmation',
        title: `${kindLabel}即将到期`,
      }))
    }

    if (VISA_OR_INSURANCE_KINDS.has(document.data.kind) && !ACTIVE_DOCUMENT_STATUSES.has(document.data.status)) {
      suggestions.push(documentSuggestion({
        actionKind: 'document_review_status',
        actionLabel: '检查状态',
        idPart: `status:${document.id}`,
        message: `一项${kindLabel}当前为${DOCUMENT_STATUS_LABELS[document.data.status]}，建议确认是否影响本次旅行。`,
        priority: ATTENTION_DOCUMENT_STATUSES.has(document.data.status) ? 14 : 34,
        requiresConfirmation: true,
        severity: ATTENTION_DOCUMENT_STATUSES.has(document.data.status) ? 'high' : 'medium',
        sourceId: document.id,
        sourceLabel: kindLabel,
        status: 'needs_confirmation',
        title: `${kindLabel}状态需要确认`,
      }))
    }

    if (
      document.data.validUntil
      && ACTIVE_DOCUMENT_STATUSES.has(document.data.status)
      && !hasDocumentExpiryReminder(reminders, document.id)
    ) {
      suggestions.push(documentSuggestion({
        actionKind: 'document_review_expiry',
        actionLabel: '查看资料',
        idPart: `reminder:${document.id}`,
        message: `一项${kindLabel}有有效期，但没有看到待发送的过期提醒。`,
        priority: 56,
        severity: 'low',
        sourceId: document.id,
        sourceLabel: kindLabel,
        title: '证件过期提醒待设置',
      }))
    }
  }

  if (input.vaultUnlocked && input.selectedTrip?.id && shouldSuggestTripDocumentReview(input)) {
    suggestions.push(documentSuggestion({
      actionKind: 'document_review_trip_documents',
      actionLabel: '检查资料',
      idPart: `trip-documents:${input.selectedTrip.id}`,
      message: '还没有看到本次旅行已关联的有效证件或保险资料，建议检查是否需要补齐。',
      priority: 40,
      severity: 'low',
      title: '本次旅行资料未完整关联',
    }))
  }

  for (const ticket of input.legacyTickets ?? []) {
    if (!isDocumentLikeTicket(ticket)) continue
    suggestions.push(documentSuggestion({
      actionKind: 'document_open_existing_migration',
      actionLabel: '预览转入',
      idPart: `ticket-migration:${ticket.id}`,
      message: '有一张明文票据像证件、签证或保险资料，可按现有确认流程转入加密资料库。',
      priority: 46,
      severity: 'low',
      ticketIds: [ticket.id],
      title: '票据可转入加密资料库',
    }))
  }

  for (const booking of input.transportBookings ?? []) {
    const hasReminder = hasTransportReminder(reminders, booking.id)
    const needsStatusReview = booking.status === 'draft' || booking.status === 'changed' || booking.status === 'cancelled'
    if (!needsStatusReview && hasReminder) continue
    const segments = input.transportSegmentsByBooking?.[booking.id] ?? []
    suggestions.push(documentSuggestion({
      actionKind: 'document_review_transport',
      actionLabel: '查看交通',
      idPart: `transport:${booking.id}`,
      message: buildTransportMessage(booking, segments.length, hasReminder),
      priority: needsStatusReview ? 30 : 58,
      requiresConfirmation: needsStatusReview,
      severity: needsStatusReview ? 'medium' : 'low',
      sourceId: booking.id,
      sourceLabel: '大交通资料',
      status: needsStatusReview ? 'needs_confirmation' : 'pending',
      title: needsStatusReview ? '大交通资料需要确认' : '大交通提醒需检查',
    }))
  }

  return suggestions
}

function documentSuggestion(input: {
  actionKind: string
  actionLabel: string
  idPart: string
  message: string
  priority: number
  requiresConfirmation?: boolean
  severity: TripIntelligenceSuggestion['severity']
  sourceId?: string
  sourceLabel?: string
  status?: TripIntelligenceSuggestion['status']
  ticketIds?: string[]
  title: string
}): TripIntelligenceSuggestion {
  return {
    action: {
      kind: input.actionKind,
      label: input.actionLabel,
      mode: input.requiresConfirmation ? 'confirm_required' : 'external_existing_flow',
      sourceActionKind: input.actionKind,
      targetRoute: 'documents',
    },
    affectedDayIds: [],
    affectedItemIds: [],
    id: `document:${input.idPart}`,
    key: `document:${input.idPart}`,
    message: input.message,
    priority: input.priority,
    requiresConfirmation: Boolean(input.requiresConfirmation),
    requiresPreview: false,
    scope: 'document',
    severity: input.severity,
    source: { ...DOCUMENT_SOURCE, id: input.sourceId ?? DOCUMENT_SOURCE.id, label: input.sourceLabel ?? DOCUMENT_SOURCE.label },
    status: input.status ?? 'pending',
    ticketIds: input.ticketIds ?? [],
    title: input.title,
  }
}

function hasDocumentExpiryReminder(reminders: ReminderSchedule[], documentId: string) {
  return reminders.some((reminder) =>
    reminder.kind === 'document_expiry'
    && reminder.objectType === 'document'
    && reminder.objectId === documentId,
  )
}

function hasTransportReminder(reminders: ReminderSchedule[], bookingId: string) {
  return reminders.some((reminder) =>
    reminder.objectType === 'transport'
    && reminder.objectId === bookingId,
  )
}

function shouldSuggestTripDocumentReview(input: TripIntelligenceDocumentInput) {
  const tripId = input.selectedTrip?.id
  if (!tripId) return false
  const linkedActiveDocuments = (input.documents ?? []).filter((document) =>
    ACTIVE_DOCUMENT_STATUSES.has(document.data.status)
    && (input.documentTripIds?.[document.id] ?? []).includes(tripId),
  )
  return linkedActiveDocuments.length === 0
}

function buildTransportMessage(booking: TransportBooking, segmentCount: number, hasReminder: boolean) {
  if (booking.status === 'cancelled') return '有一项大交通资料已取消，建议确认行程和提醒是否仍需保留。'
  if (booking.status === 'changed') return '有一项大交通资料发生变更，建议确认交通段和提醒。'
  if (booking.status === 'draft') return '有一项大交通资料仍是草稿，建议补全后再出行。'
  if (!hasReminder && segmentCount > 0) return '有一项大交通资料包含交通段，但没有看到待发送提醒。'
  return '有一项大交通资料建议检查。'
}

function isDocumentLikeTicket(ticket: TicketMeta) {
  const value = [ticket.title, ticket.fileName, ticket.note, ticket.ticketCategory].filter(Boolean).join(' ')
  return /护照|passport|签证|visa|保险|insurance|保单|证件|document|身份证|id card|entry permit|residence permit/i.test(value)
}

function getDaysUntilDate(value: string | undefined, today: string) {
  if (!value) return undefined
  return plainDateDaysBetween(today, value) ?? undefined
}

function normalizeInstant(value: Date | number | string | undefined) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime()
  }
  return Date.now()
}
