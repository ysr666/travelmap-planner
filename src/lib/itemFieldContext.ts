import type { Day, ItineraryItem, TicketMeta } from '../types'
import {
  buildAppleMapsDirectionsUrl,
  buildAppleMapsUrl,
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsUrl,
  hasValidCoordinates,
} from './mapLinks'
import { describeItemTime, describePreviousTransport, sortItineraryItemsByPlanOrder } from './itinerary'
import { getTicketCategoryLabel, getTicketDisplayTitle } from './tickets'

export type ItemNeighborContext = {
  item: ItineraryItem
  label: string
  timeLabel: string
}

export type ItemRouteActionContext = {
  appleUrl: string | null
  detail: string
  googleUrl: string | null
  isAvailable: boolean
  title: string
}

export type ItemTicketActionContext = {
  firstTicket: TicketMeta | null
  label: string
  summary: string
}

export type ItemFieldContext = {
  coordinateLabel: string
  hasCoordinates: boolean
  itemCount: number
  itemIndex: number
  nextItem: ItineraryItem | null
  nextStop: ItemNeighborContext | null
  placeAction: ItemRouteActionContext
  placeLabel: string
  positionLabel: string
  previousItem: ItineraryItem | null
  previousStop: ItemNeighborContext | null
  routeAction: ItemRouteActionContext
  ticketAction: ItemTicketActionContext
  timeLabel: string
  transportDescription: string | null
}

export function buildItemFieldContext({
  day,
  dayItems,
  item,
  tickets,
}: {
  day: Day
  dayItems: ItineraryItem[]
  item: ItineraryItem
  tickets: TicketMeta[]
}): ItemFieldContext {
  const orderedItems = sortItineraryItemsByPlanOrder(dayItems)
  const itemIndex = orderedItems.findIndex((candidate) => candidate.id === item.id)
  const previousItem = itemIndex > 0 ? orderedItems[itemIndex - 1] : null
  const nextItem = itemIndex >= 0 && itemIndex < orderedItems.length - 1 ? orderedItems[itemIndex + 1] : null
  const hasCoordinates = hasValidCoordinates(item)
  const routeAction = buildRouteAction(previousItem, item, hasCoordinates)
  const placeAction = buildPlaceAction(item, hasCoordinates)

  return {
    coordinateLabel: hasCoordinates
      ? `${item.lat?.toFixed(5)}, ${item.lng?.toFixed(5)}`
      : '待补坐标',
    hasCoordinates,
    itemCount: orderedItems.length,
    itemIndex,
    nextItem,
    nextStop: nextItem ? buildNeighborContext(nextItem) : null,
    placeAction,
    placeLabel: getPlaceLabel(item),
    positionLabel: buildPositionLabel(day, itemIndex, orderedItems.length),
    previousItem,
    previousStop: previousItem ? buildNeighborContext(previousItem) : null,
    routeAction,
    ticketAction: buildTicketAction(tickets),
    timeLabel: describeItemTime(item),
    transportDescription: describePreviousTransport(item),
  }
}

function buildPositionLabel(day: Day, itemIndex: number, itemCount: number) {
  if (itemIndex >= 0 && itemCount > 0) {
    return `${day.title || '本日'} · 第 ${itemIndex + 1}/${itemCount} 项`
  }

  return day.title || '本日行程点'
}

function buildNeighborContext(item: ItineraryItem): ItemNeighborContext {
  return {
    item,
    label: item.title,
    timeLabel: describeItemTime(item),
  }
}

function buildRouteAction(previousItem: ItineraryItem | null, item: ItineraryItem, hasCoordinates: boolean): ItemRouteActionContext {
  if (!previousItem) {
    return {
      appleUrl: null,
      detail: '这是当天第一站。',
      googleUrl: null,
      isAvailable: false,
      title: '到这里',
    }
  }

  if (!hasCoordinates) {
    return {
      appleUrl: null,
      detail: '补充当前地点坐标后再打开外部路线。',
      googleUrl: null,
      isAvailable: false,
      title: '到这里',
    }
  }

  const appleUrl = buildAppleMapsDirectionsUrl(previousItem, item, item.previousTransportMode)
  const googleUrl = buildGoogleMapsDirectionsUrl(previousItem, item, item.previousTransportMode)
  const isAvailable = Boolean(appleUrl || googleUrl)

  return {
    appleUrl,
    detail: isAvailable
      ? `${previousItem.title} 到 ${item.title}`
      : '上一站缺少可用于外部路线的地点信息。',
    googleUrl,
    isAvailable,
    title: '到这里',
  }
}

function buildPlaceAction(item: ItineraryItem, hasCoordinates: boolean): ItemRouteActionContext {
  if (!hasCoordinates) {
    return {
      appleUrl: null,
      detail: '补充坐标后可打开外部地图。',
      googleUrl: null,
      isAvailable: false,
      title: '打开地点',
    }
  }

  return {
    appleUrl: buildAppleMapsUrl(item),
    detail: getPlaceLabel(item),
    googleUrl: buildGoogleMapsUrl(item),
    isAvailable: true,
    title: '打开地点',
  }
}

function buildTicketAction(tickets: TicketMeta[]): ItemTicketActionContext {
  const firstTicket = tickets[0] ?? null

  if (!firstTicket) {
    return {
      firstTicket: null,
      label: '暂无票据',
      summary: '暂无绑定票据。',
    }
  }

  const title = getTicketDisplayTitle(firstTicket)
  const categoryLabel = getTicketCategoryLabel(firstTicket)
  return {
    firstTicket,
    label: tickets.length === 1 ? '1 张票据' : `${tickets.length} 张票据`,
    summary: tickets.length === 1
      ? `${categoryLabel} · ${title}`
      : `${categoryLabel} · ${title} 等 ${tickets.length} 张`,
  }
}

function getPlaceLabel(item: ItineraryItem) {
  return item.locationName?.trim() || item.address?.trim() || item.title
}
