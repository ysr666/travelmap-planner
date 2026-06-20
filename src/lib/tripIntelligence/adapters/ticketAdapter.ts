import { getTicketDisplayTitle, getTicketScope } from '../../tickets'
import type { RouteId, TicketBlobSyncState, TicketMeta } from '../../../types'
import type { TripIntelligenceSuggestion } from '../types'

export type TripIntelligenceTicketInput = {
  ticketBlobSyncStates?: Array<TicketBlobSyncState | undefined>
  tickets?: TicketMeta[]
}

const TICKET_SOURCE = {
  id: 'ticket_library',
  kind: 'ticket' as const,
  label: 'Ticket Library',
}

export function mapTicketsToSuggestions(input?: TripIntelligenceTicketInput | null): TripIntelligenceSuggestion[] {
  const tickets = input?.tickets ?? []
  const syncStateByTicketId = new Map(
    (input?.ticketBlobSyncStates ?? [])
      .filter((state): state is TicketBlobSyncState => Boolean(state))
      .map((state) => [state.ticketId, state]),
  )
  return tickets.flatMap((ticket) => {
    const suggestions: TripIntelligenceSuggestion[] = []
    const title = getTicketDisplayTitle(ticket)
    const affectedItemIds = ticket.itemId ? [ticket.itemId] : []
    const syncState = syncStateByTicketId.get(ticket.id)

    if (getTicketScope(ticket) === 'unassigned') {
      suggestions.push(ticketSuggestion(ticket, {
        actionKind: 'ticket_open_binding_existing_flow',
        actionLabel: '整理绑定',
        idPart: 'bind',
        message: `「${title}」还没有绑定到旅行或具体行程点。`,
        priority: 28,
        severity: 'medium',
        title: '票据待绑定',
      }))
    }

    if ((ticket.ticketCategory ?? 'other') === 'other') {
      suggestions.push(ticketSuggestion(ticket, {
        actionKind: 'ticket_open_classification_existing_flow',
        actionLabel: '整理分类',
        idPart: 'classify',
        message: `「${title}」仍是“其他”分类，后续可以整理为门票、交通、酒店或餐厅订单。`,
        priority: 42,
        severity: 'low',
        title: '票据待分类',
      }))
    }

    if (isDocumentLikeTicket(ticket)) {
      suggestions.push(ticketSuggestion(ticket, {
        actionKind: 'ticket_open_document_existing_flow',
        actionLabel: '打开资料',
        idPart: 'document',
        message: `「${title}」看起来像证件、签证或保险资料，后续可转入资料库流程。`,
        priority: 54,
        severity: 'low',
        targetRoute: 'documents',
        title: '可整理为旅行资料',
      }))
    }

    if (isOrderLikeTicket(ticket)) {
      suggestions.push(ticketSuggestion(ticket, {
        actionKind: 'ticket_open_order_existing_flow',
        actionLabel: '打开订单',
        idPart: 'order',
        message: `「${title}」可能是交通或住宿订单，后续可在订单/资料流程中继续整理。`,
        priority: 58,
        severity: 'low',
        targetRoute: 'documents',
        title: '可整理为订单资料',
      }))
    }

    if (syncState?.uploadStatus === 'error') {
      suggestions.push(ticketSuggestion(ticket, {
        actionKind: 'ticket_retry_upload_existing_flow',
        actionLabel: '重试上传',
        idPart: 'sync-upload',
        message: syncState.lastError ? '票据上传失败，可重试加入账号同步队列。' : '票据上传失败，可重试加入账号同步队列。',
        priority: 8,
        severity: 'high',
        title: '票据上传失败',
      }))
    } else if (syncState?.uploadStatus === 'missing' || syncState?.cacheStatus === 'missing') {
      suggestions.push(ticketSuggestion(ticket, {
        actionKind: 'ticket_restore_cache_existing_flow',
        actionLabel: '重新同步',
        idPart: 'sync-missing',
        message: '此设备的票据文件不可用，可从账号重新同步或重新上传。',
        priority: 12,
        severity: 'medium',
        title: '票据文件缺失',
      }))
    }

    return suggestions.map((suggestion) => ({
      ...suggestion,
      affectedItemIds,
    }))
  })
}

function ticketSuggestion(
  ticket: TicketMeta,
  input: {
    actionKind: string
    actionLabel: string
    idPart: string
    message: string
    priority: number
    severity: TripIntelligenceSuggestion['severity']
    targetRoute?: RouteId
    title: string
  },
): TripIntelligenceSuggestion {
  return {
    action: {
      kind: input.actionKind,
      label: input.actionLabel,
      mode: 'external_existing_flow',
      sourceActionKind: input.actionKind,
      targetRoute: input.targetRoute ?? 'tickets',
    },
    affectedDayIds: [],
    affectedItemIds: [],
    id: `ticket:${input.idPart}:${ticket.id}`,
    key: `ticket:${input.idPart}:${ticket.id}`,
    message: input.message,
    priority: input.priority,
    requiresConfirmation: false,
    requiresPreview: false,
    scope: 'ticket',
    severity: input.severity,
    source: { ...TICKET_SOURCE, id: ticket.id },
    status: 'pending',
    ticketIds: [ticket.id],
    title: input.title,
  }
}

function isDocumentLikeTicket(ticket: TicketMeta) {
  const value = ticketText(ticket)
  return /护照|passport|签证|visa|保险|insurance|保单|证件|document|身份证|id card/i.test(value)
}

function isOrderLikeTicket(ticket: TicketMeta) {
  if (['flight_ticket', 'hotel_booking', 'train_ticket', 'transport_booking'].includes(ticket.ticketCategory ?? '')) {
    return true
  }
  const value = ticketText(ticket)
  return /订单|预订|booking|confirmation|航班|flight|酒店|hotel|火车|train|高铁|transport/i.test(value)
}

function ticketText(ticket: TicketMeta) {
  return [ticket.title, ticket.fileName, ticket.note].filter(Boolean).join(' ')
}
