import type { RouteId } from '../types'

const routeIds: RouteId[] = [
  'home',
  'trip',
  'overview',
  'timeline',
  'map',
  'item',
  'tickets',
  'settings',
]

export function routeFromHash(): RouteId {
  const value = window.location.hash.replace(/^#\/?/, '').split('?')[0] as RouteId
  return routeIds.includes(value) ? value : 'home'
}

export function getRouteParams(hash = window.location.hash) {
  const query = hash.replace(/^#\/?/, '').split('?')[1] ?? ''
  return new URLSearchParams(query)
}

export function navigateTo(route: RouteId, params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  window.location.hash = `/${route}${query}`
}
