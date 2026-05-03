import type { ItineraryItem, TransportMode } from '../types'

export const transportModeLabels: Record<TransportMode, string> = {
  walk: '步行',
  transit: '公共交通',
  car: '打车/驾车',
  train: '火车',
  flight: '飞机',
  other: '其他',
}

export const transportModeOptions = Object.entries(transportModeLabels).map(([value, label]) => ({
  value: value as TransportMode,
  label,
}))

export function sortItineraryItems(items: ItineraryItem[]) {
  return [...items].sort((first, second) => {
    const firstTime = first.startTime?.trim()
    const secondTime = second.startTime?.trim()

    if (firstTime && secondTime && firstTime !== secondTime) {
      return firstTime.localeCompare(secondTime)
    }

    if (firstTime && !secondTime) {
      return -1
    }

    if (!firstTime && secondTime) {
      return 1
    }

    return first.sortOrder - second.sortOrder
  })
}

export function describeItemTime(item: ItineraryItem) {
  if (item.startTime && item.endTime) {
    return `${item.startTime} - ${item.endTime}`
  }

  return item.startTime || item.endTime || '时间未定'
}

export function describePreviousTransport(item: ItineraryItem) {
  const details: string[] = []

  if (item.previousTransportMode) {
    details.push(transportModeLabels[item.previousTransportMode])
  }

  if (item.previousTransportDurationMinutes !== undefined) {
    details.push(`${item.previousTransportDurationMinutes} 分钟`)
  }

  const note = item.previousTransportNote?.trim()
  if (note) {
    details.push(note)
  }

  if (details.length === 0) {
    return null
  }

  const [firstDetail, ...restDetails] = details
  return restDetails.length > 0 ? `${firstDetail} ${restDetails.join(' · ')}` : firstDetail
}
