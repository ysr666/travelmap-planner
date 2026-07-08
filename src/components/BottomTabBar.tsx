import { Compass, Home, Inbox, Search, Settings } from 'lucide-react'
import type { RouteId } from '../types'
import { navigateTo } from '../lib/routes'

type BottomTabBarProps = {
  activeRoute: RouteId
  lastTripId?: string | null
}

const tabs = [
  { id: 'home' as RouteId, label: '首页', icon: Home },
  { id: 'trip' as RouteId, label: '行程', icon: Compass },
  { id: 'inbox' as RouteId, label: '收件箱', icon: Inbox },
  { id: 'search' as RouteId, label: '搜索', icon: Search },
  { id: 'settings' as RouteId, label: '设置', icon: Settings },
]

export function BottomTabBar({ activeRoute, lastTripId }: BottomTabBarProps) {
  return (
    <nav className="absolute inset-x-0 bottom-0 z-50 mx-auto flex h-[4.75rem] items-center justify-between border-t-[0.5px] border-outline-variant/70 bg-surface/95 px-2 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-xl">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = getActiveTab(activeRoute) === tab.id
        return (
          <button
            key={tab.id}
            aria-label={tab.label}
            className={`flex h-14 min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-1 py-1 transition active:scale-95 tm-focus ${
              isActive
                ? 'bg-primary-fixed text-on-primary-fixed'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
            onClick={() => navigateToTab(tab.id, lastTripId)}
            type="button"
          >
            <Icon className="size-5 mb-1" />
            <span className="max-w-full truncate text-[11px] font-semibold leading-4">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function getActiveTab(activeRoute: RouteId): RouteId {
  if (activeRoute === 'day' || activeRoute === 'tickets' || activeRoute === 'documents') {
    return 'trip'
  }
  if (activeRoute === 'ai-draft') {
    return 'search'
  }
  if (activeRoute === 'settings/privacy' || activeRoute === 'settings/maps' || activeRoute === 'settings/route') {
    return 'settings'
  }
  return activeRoute
}

function navigateToTab(tabId: RouteId, lastTripId?: string | null) {
  if (tabId === 'trip') {
    const params = new URLSearchParams(window.location.hash.replace(/^#\/?/, '').split('?')[1] ?? '')
    const tripId = params.get('tripId') ?? lastTripId
    if (tripId) {
      navigateTo('trip', { tripId })
      return
    }
    navigateTo('home')
    return
  }
  navigateTo(tabId)
}
