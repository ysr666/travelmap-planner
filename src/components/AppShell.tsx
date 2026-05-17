import type { ReactNode } from 'react'
import {
  Cog,
  Home,
  Map,
  Route,
  Ticket,
} from 'lucide-react'
import type { RouteId } from '../types'
import { navigateTo } from '../lib/routes'

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
}

export function AppShell({ activeRoute, children }: AppShellProps) {
  const isHome = activeRoute === 'home'
  const isTrip = activeRoute === 'trip' || activeRoute === 'day' || activeRoute === 'item'
    || activeRoute === 'trip/new' || activeRoute === 'trip/edit'
    || activeRoute === 'item/new' || activeRoute === 'item/edit'
  const pageTitle = routeTitles[activeRoute]

  return (
    <div className="app-viewport mx-auto flex w-full max-w-[430px] flex-col overflow-hidden bg-[#eef3f8] shadow-[0_18px_60px_rgba(55,70,92,0.12)] dark:bg-slate-950 dark:shadow-[0_18px_60px_rgba(0,0,0,0.32)]">
      {!isTrip ? (
        <header className="z-30 border-b border-white/70 bg-surface/88 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            {isHome ? (
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80">
                  <img alt="" className="size-7 rounded-lg" src="/favicon.svg" />
                </span>
                <h1 className="min-w-0 truncate text-xl font-semibold leading-tight text-slate-950">
                  {pageTitle}
                </h1>
              </div>
            ) : (
              <button
                aria-label="返回首页"
                className="flex size-10 items-center justify-center rounded-xl bg-white text-slate-700 ring-1 ring-slate-200/80 active:scale-[0.98]"
                onClick={() => navigateTo('home')}
                type="button"
              >
                <Home className="size-5" />
              </button>
            )}
            {!isHome ? (
              <h1 className="min-w-0 flex-1 truncate text-xl font-semibold leading-tight text-slate-950">
                {pageTitle}
              </h1>
            ) : null}
            {activeRoute === 'settings' ? (
              <div className="size-10" />
            ) : (
              <button
                aria-label="设置"
                className="flex size-10 items-center justify-center rounded-xl bg-white text-slate-700 ring-1 ring-slate-200/80 active:scale-[0.98]"
                onClick={() => navigateTo('settings')}
                type="button"
              >
                <Cog className="size-5" />
              </button>
            )}
          </div>
        </header>
      ) : null}

      <main
        className={
          isHome || isTrip
            ? 'flex min-h-0 flex-1 px-4 pt-4'
            : 'min-h-0 flex-1 overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 app-scrollbar'
        }
      >
        <div className={isHome || isTrip ? 'page-transition h-full min-h-0 w-full' : 'page-transition'}>
          {children}
        </div>
      </main>
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
    <nav className={`rounded-2xl border border-white/80 bg-white/90 p-1.5 shadow-[0_8px_22px_rgba(47,65,88,0.05)] ${className}`}>
      <div className="grid grid-cols-4 gap-1">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition active:scale-[0.98] ${
                item.active ? 'bg-primary text-white shadow-sm' : 'text-slate-500 active:bg-slate-50'
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
