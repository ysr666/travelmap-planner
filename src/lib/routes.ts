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

const legacyViewMap: Record<string, string> = {
  overview: 'overview',
  timeline: 'schedule',
  map: 'map',
}

export function routeFromHash(): RouteId {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  if (routeIds.includes(raw as RouteId)) {
    return raw as RouteId
  }
  if (legacyRedirects[raw]) {
    // Rewrite legacy URL to canonical form with view param
    const query = window.location.hash.replace(/^#\/?/, '').split('?')[1] ?? ''
    const params = new URLSearchParams(query)
    if (!params.has('view') && legacyViewMap[raw]) {
      params.set('view', legacyViewMap[raw])
    }
    const newHash = `#/trip${params.toString() ? `?${params.toString()}` : ''}`
    window.location.replace(newHash)
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
