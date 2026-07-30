import { CalendarDays, Inbox, MapPinned, UserRound } from 'lucide-react'
import type { RouteId } from '../types'
import { navigateTo } from '../lib/routes'
import { getPrimaryDestination, type PrimaryDestination } from './shell/routePresentation'

type BottomTabBarProps = {
  activeRoute: RouteId
  lastTripId?: string | null
}

const tabs = [
  { id: 'home' as PrimaryDestination, label: '今日', icon: MapPinned },
  { id: 'trip' as PrimaryDestination, label: '行程', icon: CalendarDays },
  { id: 'inbox' as PrimaryDestination, label: '收件箱', icon: Inbox },
  { id: 'settings' as PrimaryDestination, label: '我的', icon: UserRound },
]

export function BottomTabBar({ activeRoute, lastTripId }: BottomTabBarProps) {
  const activeDestination = getPrimaryDestination(activeRoute)

  return (
    <nav aria-label="主导航" className="primary-navigation" data-testid="primary-navigation">
      <div className="primary-navigation-brand" aria-hidden="true">
        <MapPinned className="size-5" />
        <span>旅图</span>
      </div>
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = activeDestination === tab.id
        return (
          <button
            key={tab.id}
            aria-current={isActive ? 'page' : undefined}
            aria-label={tab.label}
            className={`primary-navigation-item tm-focus ${
              isActive
                ? 'primary-navigation-item-active'
                : ''
            }`}
            onClick={() => navigateToTab(tab.id, lastTripId)}
            type="button"
          >
            <span className="primary-navigation-icon">
              <Icon className="size-5" />
            </span>
            <span className="primary-navigation-label">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function navigateToTab(tabId: PrimaryDestination, lastTripId?: string | null) {
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
