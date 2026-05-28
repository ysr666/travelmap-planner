import { getMarkerEmoji } from './markerEmoji'
import type { ItineraryItem } from '../types'

type PlaceHeroVisual = {
  gradientClass: string
  emoji: string
  label: string
}

const categoryGradients: Record<string, PlaceHeroVisual> = {
  '🍽️': { emoji: '🍽️', gradientClass: 'from-amber-400 via-orange-400 to-rose-400', label: '餐饮' },
  '🏨': { emoji: '🏨', gradientClass: 'from-sky-400 via-blue-400 to-indigo-400', label: '住宿' },
  '🚃': { emoji: '🚃', gradientClass: 'from-emerald-400 via-teal-400 to-cyan-400', label: '交通' },
  '⛩️': { emoji: '⛩️', gradientClass: 'from-violet-400 via-purple-400 to-fuchsia-400', label: '景点' },
  '🛍️': { emoji: '🛍️', gradientClass: 'from-rose-400 via-pink-400 to-red-400', label: '购物' },
}

const defaultVisual: PlaceHeroVisual = {
  emoji: '📍',
  gradientClass: 'from-slate-400 via-gray-400 to-zinc-500',
  label: '地点',
}

export function getPlaceHeroVisual(item: ItineraryItem): PlaceHeroVisual {
  const emoji = getMarkerEmoji(item)
  if (emoji && categoryGradients[emoji]) {
    return categoryGradients[emoji]
  }
  return defaultVisual
}
