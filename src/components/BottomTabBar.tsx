import { Compass, Home, Search, Settings } from 'lucide-react'
import type { RouteId } from '../types'
import { navigateTo } from '../lib/routes'

type BottomTabBarProps = {
  activeRoute: RouteId
}

const tabs = [
  { id: 'home' as RouteId, label: '首页', icon: Home },
  { id: 'trip' as RouteId, label: '行程', icon: Compass },
  { id: 'search' as RouteId, label: '搜索', icon: Search },
  { id: 'settings' as RouteId, label: '设置', icon: Settings },
]

export function BottomTabBar({ activeRoute }: BottomTabBarProps) {
  return (
    <nav className="absolute inset-x-0 bottom-0 z-50 mx-auto flex h-16 items-center justify-around border-t-[0.5px] border-outline-variant/30 bg-surface-dim/80 px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = getActiveTab(activeRoute) === tab.id
        return (
          <button
            key={tab.id}
            aria-label={tab.label}
            className={`flex flex-col items-center justify-center rounded-xl px-3 py-1 transition active:scale-90 ${
              isActive
                ? 'text-primary bg-primary-container/10'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
            onClick={() => navigateToTab(tab.id)}
            type="button"
          >
            <Icon className="size-5 mb-1" />
            <span className="font-label-sm text-label-sm">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function getActiveTab(activeRoute: RouteId): RouteId {
  if (activeRoute === 'day' || activeRoute === 'tickets') {
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

function navigateToTab(tabId: RouteId) {
  if (tabId === 'trip') {
    const params = new URLSearchParams(window.location.hash.replace(/^#\/?/, '').split('?')[1] ?? '')
    const tripId = params.get('tripId')
    if (tripId) {
      navigateTo('trip', { tripId })
      return
    }
    navigateTo('home')
    return
  }
  navigateTo(tabId)
}
