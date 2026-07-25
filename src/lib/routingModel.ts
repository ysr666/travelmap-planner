import type { ItineraryItem, TransportMode } from '../types'
import { sortItineraryItemsByPlanOrder } from './itinerary'
import { hasValidCoordinates } from './mapLinks'

export type RoutingProvider = 'none' | 'openrouteservice' | 'google'
export type RoutingProfile = 'foot-walking' | 'driving-car' | 'cycling-regular'
export type RoutingMode = TransportMode | 'cycling' | 'subway' | 'unknown'
export type LngLat = [number, number]

export const BUS_APPROXIMATION_WARNING = '公交段使用道路路线近似，不包含公交站点、班次、换乘和实时交通。实际出行请以 Apple Maps / Google Maps 等导航为准。'

export function mapTransportModeToRoutingProfile(mode?: RoutingMode): {
  profile: RoutingProfile | null
  warning?: string
} {
  if (mode === 'walk') {
    return { profile: 'foot-walking' }
  }

  if (mode === 'car') {
    return { profile: 'driving-car' }
  }

  if (mode === 'bus') {
    return {
      profile: 'driving-car',
      warning: BUS_APPROXIMATION_WARNING,
    }
  }

  if (mode === 'cycling') {
    return { profile: 'cycling-regular' }
  }

  if (mode === 'train' || mode === 'transit' || mode === 'subway' || mode === 'flight') {
    return {
      profile: null,
      warning: `${transportModeName(mode)} 段暂不使用道路路线，已显示直线连接。`,
    }
  }

  return {
    profile: 'driving-car',
    warning: '交通方式未明确，已按驾车路线尝试生成，仅供参考。',
  }
}

export function getItemLngLat(item?: ItineraryItem): LngLat | null {
  if (!item || !hasValidCoordinates(item)) {
    return null
  }

  return [item.lng as number, item.lat as number]
}

export function getOrderedMappableItems(items: ItineraryItem[]) {
  return sortItineraryItemsByPlanOrder(items).filter((item) => getItemLngLat(item) !== null)
}

function transportModeName(mode: RoutingMode) {
  const names: Record<RoutingMode, string> = {
    walk: '步行',
    transit: '公共交通',
    bus: '公交',
    car: '驾车',
    train: '火车',
    flight: '飞行',
    other: '其他交通',
    cycling: '骑行',
    subway: '地铁',
    unknown: '交通方式未定',
  }
  return names[mode]
}
