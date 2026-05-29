import type { ReactNode } from 'react'
import {
  ChevronLeft,
  Home,
  Map,
  Route,
  Settings,
  Ticket,
} from 'lucide-react'
import type { RouteId } from '../types'
import { navigateTo } from '../lib/routes'
import { BottomTabBar } from './BottomTabBar'

const BOTTOM_TAB_BAR_ROUTES: RouteId[] = ['home', 'trip', 'settings', 'tickets']

type AppShellProps = {
  activeRoute: RouteId
  children: ReactNode
}

const routeTitles: Record<RouteId, string> = {
  home: '旅图',
  trip: '旅行工作台',
  day: '每日行程',
  item: '行程点详情',
  tickets: '票据库',
  settings: '设置',
  'trip/new': '新建旅行',
  'trip/edit': '编辑旅行',
  'item/new': '新增行程点',
  'item/edit': '编辑行程点',
  'ai-draft': 'AI 行程草稿',
}

export function AppShell({ activeRoute, children }: AppShellProps) {
  const isHome = activeRoute === 'home'
  const isTrip = activeRoute === 'trip' || activeRoute === 'day' || activeRoute === 'item'
    || activeRoute === 'trip/new' || activeRoute === 'trip/edit'
    || activeRoute === 'item/new' || activeRoute === 'item/edit'
  const showTabBar = BOTTOM_TAB_BAR_ROUTES.includes(activeRoute)
  const pageTitle = routeTitles[activeRoute]

  return (
    <div className="app-viewport bg-background mx-auto flex w-full max-w-[600px] flex-col overflow-hidden">
      {/* Fixed TopAppBar */}
      {!isTrip ? (
        <header className="fixed top-0 z-50 flex h-16 w-full max-w-[600px] items-center justify-between border-b-[0.5px] border-outline-variant/30 bg-surface/70 px-4 backdrop-blur-xl pt-[max(0rem,env(safe-area-inset-top))]">
          {isHome ? (
            <>
              <div className="flex items-center gap-3">
                <button
                  className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high/50 transition-colors active:scale-95"
                  onClick={() => navigateTo('home')}
                  type="button"
                >
                  <Map className="size-5" />
                </button>
                <h1 className="font-headline-md text-headline-md font-bold text-on-surface">旅图</h1>
              </div>
              <button
                aria-label="设置"
                className="size-10 rounded-full overflow-hidden bg-surface-container border border-outline-variant/30 flex items-center justify-center text-on-surface-variant transition hover:text-primary active:scale-95"
                onClick={() => navigateTo('settings')}
                type="button"
              >
                <Settings className="size-5" />
              </button>
            </>
          ) : (
            <>
              <button
                aria-label="返回"
                className="flex size-10 items-center justify-center rounded-full text-primary transition hover:bg-surface-container-high/50 active:scale-95"
                onClick={() => navigateTo('home')}
                type="button"
              >
                <ChevronLeft className="size-5" />
              </button>
              <h1 className="font-headline-md text-headline-md text-on-surface">
                {pageTitle}
              </h1>
              <div className="size-10" />
            </>
          )}
        </header>
      ) : null}

      <main
        className={
          isHome || isTrip
            ? `flex min-h-0 flex-1 flex-col px-4 pb-32 gap-section-gap`
            : `min-h-0 flex-1 overflow-y-auto px-4 pt-24 pb-32 app-scrollbar`
        }
      >
        <div className={isHome || isTrip ? 'page-transition h-full min-h-0 w-full' : 'page-transition'}>
          {children}
        </div>
      </main>

      {showTabBar ? <BottomTabBar activeRoute={activeRoute} /> : null}
    </div>
  )
}

type TripNavProps = {
  tripId: string
  activeRoute: RouteId
  dayId?: string | null
  firstDayId?: string | null
  activeView?: 'schedule' | 'map'
  className?: string
}

export function TripNav({ tripId, activeRoute, activeView, dayId, firstDayId, className = '' }: TripNavProps) {
  const targetDayId = dayId ?? firstDayId ?? null
  const items = [
    {
      id: 'trip',
      label: '总览',
      icon: Home,
      active: activeRoute === 'trip',
      onClick: () => navigateTo('trip', { tripId }),
    },
    {
      id: 'schedule',
      label: '日程',
      icon: Route,
      active: activeRoute === 'day' && activeView !== 'map',
      onClick: () => {
        if (targetDayId) {
          navigateTo('day', { tripId, dayId: targetDayId, view: 'schedule' })
        } else {
          navigateTo('trip', { tripId })
        }
      },
    },
    {
      id: 'map',
      label: '地图',
      icon: Map,
      active: activeRoute === 'day' && activeView === 'map',
      onClick: () => {
        if (targetDayId) {
          navigateTo('day', { tripId, dayId: targetDayId, view: 'map' })
        } else {
          navigateTo('trip', { tripId })
        }
      },
    },
    {
      id: 'tickets',
      label: '票据',
      icon: Ticket,
      active: activeRoute === 'tickets',
      onClick: () => navigateTo('tickets', { tripId }),
    },
  ]

  return (
    <nav className={`rounded-xl bg-surface-container border border-outline-variant/30 p-1.5 ${className}`}>
      <div className="grid grid-cols-4 gap-1">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition active:scale-[0.98] ${
                item.active
                  ? 'bg-primary-container text-on-primary-container shadow-sm'
                  : 'text-on-surface-variant active:bg-surface-container-high/50'
              }`}
              key={item.id}
              onClick={item.onClick}
              type="button"
            >
              <Icon className="size-4 shrink-0" />
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
