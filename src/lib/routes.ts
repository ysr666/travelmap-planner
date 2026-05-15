import type { RouteId } from '../types'

const routeIds: RouteId[] = [
  'home',
  'trip',
  'day',
  'item',
  'tickets',
  'settings',
  'trip/new',
  'trip/edit',
  'item/new',
  'item/edit',
]

const legacyRedirects: Record<string, RouteId> = {
  overview: 'trip',
  timeline: 'day',
  map: 'day',
}

const legacyViewMap: Record<string, string> = {
  overview: 'overview',
  timeline: 'schedule',
  map: 'map',
}

export function routeFromHash(hash = window.location.hash): RouteId {
  const raw = hash.replace(/^#\/?/, '').split('?')[0]
  if (routeIds.includes(raw as RouteId)) {
    return raw as RouteId
  }
  if (legacyRedirects[raw]) {
    return legacyRedirects[raw]
  }
  return 'home'
}

export function getCanonicalHashRedirect(hash = window.location.hash) {
  const [rawPath, rawQuery = ''] = hash.replace(/^#\/?/, '').split('?')
  const params = new URLSearchParams(rawQuery)

  if (rawPath === 'overview') {
    return buildHash('trip', params)
  }

  if (rawPath === 'timeline' || rawPath === 'map') {
    if (!params.has('view') && legacyViewMap[rawPath]) {
      params.set('view', legacyViewMap[rawPath])
    }
    if (params.get('tripId') && params.get('dayId')) {
      return buildHash('day', params)
    }
    return buildHash('trip', params)
  }

  if (rawPath === 'trip') {
    const view = params.get('view')
    if (view === 'overview') {
      params.delete('view')
      return buildHash('trip', params)
    }
    if ((view === 'schedule' || view === 'map') && params.get('tripId') && params.get('dayId')) {
      return buildHash('day', params)
    }
  }

  return null
}

export function getRouteParams(hash = window.location.hash) {
  const query = hash.replace(/^#\/?/, '').split('?')[1] ?? ''
  return new URLSearchParams(query)
}

export function navigateTo(route: RouteId, params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  window.location.hash = `/${route}${query}`
}

function buildHash(route: RouteId, params: URLSearchParams) {
  const query = params.toString()
  return `#/${route}${query ? `?${query}` : ''}`
}
