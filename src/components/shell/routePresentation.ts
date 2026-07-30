import type { RouteId } from '../../types'

export type PrimaryDestination = 'home' | 'inbox' | 'settings' | 'trip'

const TRIP_DESTINATION_ROUTES = new Set<RouteId>([
  'ai-draft',
  'day',
  'documents',
  'item',
  'item/edit',
  'item/new',
  'ledger',
  'ledger/expense',
  'shared-trip',
  'tickets',
  'trip',
  'trip/edit',
])

const PUSH_ROUTES = new Set<RouteId>([
  'ai-draft',
  'day',
  'item',
  'item/edit',
  'item/new',
  'ledger/expense',
  'search',
  'settings/account',
  'settings/preferences',
  'settings/app',
  'settings/advanced',
  'settings/maps',
  'settings/privacy',
  'settings/route',
  'shared-trip',
  'trip/edit',
  'trip/new',
])

const IMMERSIVE_ROUTES = new Set<RouteId>([
  'item',
  'item/edit',
  'item/new',
  'trip/edit',
  'trip/new',
])

const AI_HIDDEN_ROUTES = new Set<RouteId>([
  'item/edit',
  'item/new',
  'ledger/expense',
  'shared-trip',
  'trip/edit',
  'trip/new',
])

export function getPrimaryDestination(
  activeRoute: RouteId,
  hash?: string,
): PrimaryDestination {
  if (activeRoute === 'home') return 'home'
  if (activeRoute === 'inbox') return 'inbox'
  if (activeRoute === 'settings' || activeRoute.startsWith('settings/')) return 'settings'
  if (TRIP_DESTINATION_ROUTES.has(activeRoute)) return 'trip'
  if (activeRoute === 'search') {
    const source = new URLSearchParams(resolveHash(hash).split('?')[1] ?? '').get('from')
    if (source === 'inbox' || source === 'settings' || source === 'trip') return source
  }
  return 'home'
}

export function getRouteTitle(activeRoute: RouteId, hash?: string) {
  if (activeRoute === 'home') return '今日'
  if (activeRoute === 'inbox') return '收件箱'
  if (activeRoute === 'trip') return '行程'
  if (activeRoute === 'day') {
    return new URLSearchParams(resolveHash(hash).split('?')[1] ?? '').get('view') === 'map' ? '地图' : '日程'
  }
  if (activeRoute === 'item') return '地点详情'
  if (activeRoute === 'tickets' || activeRoute === 'documents') return '资料'
  if (activeRoute === 'ledger') return '费用'
  if (activeRoute === 'ledger/expense') return '费用详情'
  if (activeRoute === 'shared-trip') return '同行'
  if (activeRoute === 'search') return '搜索'
  if (activeRoute === 'settings') return '我的'
  if (activeRoute === 'settings/account') return '账户与同步'
  if (activeRoute === 'settings/preferences') return '旅行偏好'
  if (activeRoute === 'settings/app') return '应用与通知'
  if (activeRoute === 'settings/advanced') return '数据与高级'
  if (activeRoute === 'settings/privacy') return '账户与数据'
  if (activeRoute === 'settings/maps') return '地图与地点'
  if (activeRoute === 'settings/route') return '路线服务'
  if (activeRoute === 'trip/new') return '新建旅行'
  if (activeRoute === 'trip/edit') return '编辑旅行'
  if (activeRoute === 'item/new') return '添加行程点'
  if (activeRoute === 'item/edit') return '编辑行程点'
  return 'AI 行程草稿'
}

export function isPushRoute(activeRoute: RouteId) {
  return PUSH_ROUTES.has(activeRoute)
}

export function isImmersiveRoute(activeRoute: RouteId) {
  return IMMERSIVE_ROUTES.has(activeRoute)
}

export function shouldShowPrimaryNavigation(activeRoute: RouteId) {
  return !PUSH_ROUTES.has(activeRoute)
}

export function shouldShowAiCommand(activeRoute: RouteId) {
  return !AI_HIDDEN_ROUTES.has(activeRoute)
}

export function shouldShowSearchCommand(activeRoute: RouteId) {
  return activeRoute === 'home'
    || activeRoute === 'inbox'
    || activeRoute === 'trip'
    || activeRoute === 'tickets'
    || activeRoute === 'documents'
    || activeRoute === 'ledger'
}

function resolveHash(hash?: string) {
  if (hash !== undefined) return hash
  return typeof window === 'undefined' ? '' : window.location.hash
}
