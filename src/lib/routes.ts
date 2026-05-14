import type { RouteId } from '../types'

const routeIds: RouteId[] = [
  'home',
  'trip',
  'item',
  'tickets',
  'settings',
]

const legacyRedirects: Record<string, RouteId> = {
  overview: 'trip',
  timeline: 'trip',
  map: 'trip',
}

export function routeFromHash(): RouteId {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  if (routeIds.includes(raw as RouteId)) {
    return raw as RouteId
  }
  if (legacyRedirects[raw]) {
    return legacyRedirects[raw]
  }
  return 'home'
}

export function getRouteParams(hash = window.location.hash) {
  const query = hash.replace(/^#\/?/, '').split('?')[1] ?? ''
  return new URLSearchParams(query)
}

export function navigateTo(route: RouteId, params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  window.location.hash = `/${route}${query}`
}
