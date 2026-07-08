import type { ReactNode } from 'react'
import {
  Home,
  Map,
  Route,
  FolderLock,
  User,
} from 'lucide-react'
import type { RouteId } from '../types'
import { navigateTo } from '../lib/routes'
import { BottomTabBar } from './BottomTabBar'
import { GlobalAiCommandBar } from './ai/GlobalAiCommandBar'
import { PwaLifecycleBanner } from './PwaLifecycleBanner'


type AppShellProps = {
  activeRoute: RouteId
  children: ReactNode
  lastTripId?: string | null
  title: string
}


export function AppShell({ activeRoute, children, lastTripId, title }: AppShellProps) {
  const ownsCanvas = activeRoute === 'home'
    || activeRoute === 'inbox'
    || activeRoute === 'settings'
    || activeRoute === 'settings/privacy'
    || activeRoute === 'settings/maps'
    || activeRoute === 'settings/route'
    || activeRoute === 'search'
  const fullScreen = activeRoute === 'day' || activeRoute === 'item'
    || activeRoute === 'trip/new' || activeRoute === 'trip/edit'
    || activeRoute === 'item/new' || activeRoute === 'item/edit'
  const showTopAppBar = !fullScreen
  const showTabBar = activeRoute === 'home'
    || activeRoute === 'inbox'
    || activeRoute === 'trip'
    || activeRoute === 'day'
    || activeRoute === 'tickets'
    || activeRoute === 'documents'
    || activeRoute === 'ledger'
    || activeRoute === 'search'
    || activeRoute === 'settings'
    || activeRoute === 'settings/privacy'
    || activeRoute === 'settings/maps'
    || activeRoute === 'settings/route'
  const showGlobalAiCommand = shouldShowGlobalAiCommand(activeRoute)

  return (
    <div className="app-viewport relative mx-auto flex w-full max-w-[600px] flex-col overflow-hidden bg-background text-on-surface">
      {showTopAppBar ? (
        <header className="absolute inset-x-0 top-0 z-50 flex h-16 items-center gap-3 border-b-[0.5px] border-outline-variant/70 bg-surface/95 px-4 backdrop-blur-xl">
          <button
            aria-label="返回首页"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high active:scale-95 tm-focus"
            onClick={() => navigateTo('home')}
            type="button"
          >
            <Map className="size-5" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-center text-lg font-semibold text-on-surface">
            {title || '旅图'}
          </h1>
          <button
            aria-label="设置"
            className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-outline-variant/70 bg-surface-container text-on-surface-variant transition hover:text-primary active:scale-95 tm-focus"
            onClick={() => navigateTo('settings')}
            type="button"
          >
            <User className="size-5" />
          </button>
        </header>
      ) : null}

      <PwaLifecycleBanner topAppBar={showTopAppBar} />

      <main
        className={getMainClassName({ fullScreen, ownsCanvas, showGlobalAiCommand, showTabBar, showTopAppBar })}
      >
        <div className={fullScreen ? 'h-full min-h-0 w-full' : 'page-transition min-h-full w-full'}>
          {children}
        </div>
      </main>

      {showGlobalAiCommand ? (
        <GlobalAiCommandBar activeRoute={activeRoute} hasBottomTab={showTabBar} />
      ) : null}
      {showTabBar ? <BottomTabBar activeRoute={activeRoute} lastTripId={lastTripId} /> : null}
    </div>
  )
}

function shouldShowGlobalAiCommand(activeRoute: RouteId) {
  return activeRoute !== 'trip/new'
    && activeRoute !== 'trip/edit'
    && activeRoute !== 'item/new'
    && activeRoute !== 'item/edit'
    && activeRoute !== 'shared-trip'
    && activeRoute !== 'ledger/expense'
}

function getMainClassName({
  fullScreen,
  ownsCanvas,
  showGlobalAiCommand,
  showTabBar,
  showTopAppBar,
}: {
  fullScreen: boolean
  ownsCanvas: boolean
  showGlobalAiCommand: boolean
  showTabBar: boolean
  showTopAppBar: boolean
}) {
  if (fullScreen) {
    return 'relative min-h-0 flex-1 overflow-hidden'
  }

  if (ownsCanvas) {
    return `relative min-h-0 flex-1 overflow-y-auto ${showGlobalAiCommand ? 'pb-32' : ''} app-scrollbar`
  }

  const topPadding = showTopAppBar ? 'pt-24' : 'pt-4'
  const bottomPadding = showGlobalAiCommand
    ? showTabBar ? 'pb-48' : 'pb-28'
    : showTabBar ? 'pb-28' : 'pb-6'
  return `relative min-h-0 flex-1 overflow-y-auto px-4 ${topPadding} ${bottomPadding} app-scrollbar`
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
      id: 'documents',
      label: '资料',
      icon: FolderLock,
      active: activeRoute === 'tickets' || activeRoute === 'documents',
      onClick: () => navigateTo('documents', { tripId }),
    },
  ]

  return (
    <nav className={`rounded-lg border border-outline-variant/70 bg-surface-container p-1.5 ${className}`}>
      <div className="grid grid-cols-4 gap-1">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition active:scale-[0.98] tm-focus ${
                item.active
                  ? 'bg-primary text-on-primary shadow-sm'
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
