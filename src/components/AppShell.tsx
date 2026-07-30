import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  Search,
  Sparkles,
  Map,
  FolderLock,
  WalletCards,
} from 'lucide-react'
import type { RouteId } from '../types'
import { getRouteParams, navigateTo } from '../lib/routes'
import { BottomTabBar } from './BottomTabBar'
import { PwaLifecycleBanner } from './PwaLifecycleBanner'
import {
  getPrimaryDestination,
  getRouteTitle,
  isImmersiveRoute,
  isPushRoute,
  shouldShowAiCommand,
  shouldShowPrimaryNavigation,
  shouldShowSearchCommand,
} from './shell/routePresentation'

const GlobalAiCommandBar = lazy(() =>
  import('./ai/GlobalAiCommandBar').then((module) => ({ default: module.GlobalAiCommandBar })),
)

type AppShellProps = {
  activeRoute: RouteId
  children: ReactNode
  lastTripId?: string | null
  tripTitle?: string | null
}

export function AppShell({ activeRoute, children, lastTripId, tripTitle }: AppShellProps) {
  const [aiRoute, setAiRoute] = useState<RouteId | null>(null)
  const aiTriggerRef = useRef<HTMLButtonElement>(null)
  const ownsCanvas = activeRoute === 'home'
    || activeRoute === 'day'
  const fullScreen = isImmersiveRoute(activeRoute)
  const showTopAppBar = !fullScreen
  const showPrimaryNav = shouldShowPrimaryNavigation(activeRoute)
  const showGlobalAiCommand = shouldShowAiCommand(activeRoute)
  const showSearch = shouldShowSearchCommand(activeRoute)
  const routeTitle = getRouteTitle(activeRoute)
  const aiOpen = aiRoute !== null

  function handleAiOpenChange(nextOpen: boolean) {
    setAiRoute(nextOpen ? activeRoute : null)
    if (!nextOpen) {
      window.requestAnimationFrame(() => aiTriggerRef.current?.focus())
    }
  }

  return (
    <div className="app-viewport app-scaffold bg-background text-on-surface">
      {showPrimaryNav ? <BottomTabBar activeRoute={activeRoute} lastTripId={lastTripId} /> : null}
      <div className="app-shell-column">
        {showTopAppBar ? (
          <header className="context-header">
            <div className="context-header-leading">
              {isPushRoute(activeRoute) ? (
                <button
                  aria-label="返回"
                  className="context-header-icon tm-focus"
                  onClick={() => navigateBack(activeRoute, lastTripId)}
                  title="返回"
                  type="button"
                >
                  <ArrowLeft className="size-5" />
                </button>
              ) : (
                <button
                  aria-label={tripTitle ? `当前旅行：${tripTitle}` : '返回今日'}
                  className="context-trip-switcher tm-focus"
                  onClick={() => {
                    if (lastTripId) navigateTo('trip', { tripId: lastTripId })
                    else navigateTo('home')
                  }}
                  title={tripTitle ?? '今日'}
                  type="button"
                >
                  <BriefcaseBusiness className="size-5 shrink-0" />
                  <span>{tripTitle ?? '选择旅行'}</span>
                </button>
              )}
            </div>
            <h1 className="context-header-title">{routeTitle}</h1>
            <div className="context-header-actions">
              {showSearch ? (
                <button
                  aria-label="搜索"
                  className="context-header-icon tm-focus"
                  onClick={() => navigateTo('search', {
                    from: getPrimaryDestination(activeRoute),
                    ...(lastTripId ? { tripId: lastTripId } : {}),
                  })}
                  title="搜索"
                  type="button"
                >
                  <Search className="size-5" />
                </button>
              ) : null}
              {showGlobalAiCommand ? (
                <button
                  aria-expanded={aiOpen}
                  aria-haspopup="dialog"
                  aria-label="AI 助手"
                  className="context-header-icon context-header-ai tm-focus"
                  onClick={() => setAiRoute(activeRoute)}
                  ref={aiTriggerRef}
                  title="AI 助手"
                  type="button"
                >
                  <Sparkles className="size-5" />
                </button>
              ) : null}
            </div>
          </header>
        ) : null}

        <PwaLifecycleBanner topAppBar={showTopAppBar} />

        <main
          className={getMainClassName({
            activeRoute,
            fullScreen,
            ownsCanvas,
            showPrimaryNav,
            showTopAppBar,
          })}
        >
          <div className={fullScreen || ownsCanvas ? 'page-transition h-full min-h-0 w-full' : 'page-transition min-h-full w-full'}>
            {children}
          </div>
        </main>
      </div>

      {showGlobalAiCommand && aiOpen ? (
        <Suspense fallback={null}>
          <GlobalAiCommandBar
            activeRoute={activeRoute}
            onOpenChange={handleAiOpenChange}
            open={aiOpen}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

function getMainClassName({
  activeRoute,
  fullScreen,
  ownsCanvas,
  showPrimaryNav,
  showTopAppBar,
}: {
  activeRoute: RouteId
  fullScreen: boolean
  ownsCanvas: boolean
  showPrimaryNav: boolean
  showTopAppBar: boolean
}) {
  if (fullScreen) {
    return 'app-shell-main relative min-h-0 flex-1 overflow-hidden'
  }

  if (ownsCanvas) {
    const insetClassName = activeRoute === 'home'
      ? 'app-shell-main-today'
      : activeRoute === 'day'
        ? 'app-shell-main-day'
        : ''
    return `app-shell-main relative min-h-0 flex-1 overflow-y-auto app-scrollbar ${insetClassName}`
  }

  const topPadding = showTopAppBar ? 'pt-24' : 'pt-4'
  const bottomPadding = showPrimaryNav ? 'pb-28 min-[600px]:pb-6' : 'pb-6'
  return `relative min-h-0 flex-1 overflow-y-auto px-4 ${topPadding} ${bottomPadding} app-scrollbar`
}

function navigateBack(activeRoute: RouteId, lastTripId?: string | null) {
  const params = getRouteParams()
  const tripId = params.get('tripId') ?? lastTripId
  const dayId = params.get('dayId')
  const itemId = params.get('itemId')

  if (activeRoute.startsWith('settings/')) {
    navigateTo('settings')
    return
  }
  if (activeRoute === 'ledger/expense' && tripId) {
    navigateTo('ledger', { tripId })
    return
  }
  if (activeRoute === 'day' && tripId) {
    navigateTo('trip', { tripId, ...(dayId ? { dayId } : {}) })
    return
  }
  if (activeRoute === 'item/edit' && tripId && dayId && itemId) {
    navigateTo('item', { tripId, dayId, itemId })
    return
  }
  if (activeRoute === 'item' && tripId && dayId) {
    navigateTo('day', { tripId, dayId, view: 'schedule' })
    return
  }
  if (activeRoute === 'item/new' && tripId && dayId) {
    navigateTo('day', { tripId, dayId, view: 'schedule' })
    return
  }
  if ((activeRoute === 'trip/edit' || activeRoute === 'shared-trip' || activeRoute === 'ai-draft') && tripId) {
    navigateTo('trip', { tripId })
    return
  }
  if (activeRoute === 'search') {
    const source = params.get('from')
    if (source === 'trip' && tripId) {
      navigateTo('trip', { tripId })
      return
    }
    if (source === 'inbox') {
      navigateTo('inbox')
      return
    }
    if (source === 'settings') {
      navigateTo('settings')
      return
    }
  }
  navigateTo('home')
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
      id: 'schedule',
      label: '日程',
      icon: CalendarDays,
      active: activeRoute === 'trip' || (activeRoute === 'day' && activeView !== 'map'),
      onClick: () => {
        navigateTo('trip', targetDayId ? { tripId, dayId: targetDayId } : { tripId })
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
    {
      id: 'ledger',
      label: '费用',
      icon: WalletCards,
      active: activeRoute === 'ledger' || activeRoute === 'ledger/expense',
      onClick: () => navigateTo('ledger', { tripId }),
    },
  ]

  return (
    <nav aria-label="行程内容" className={`rounded-lg border border-outline-variant/70 bg-surface-container p-1 ${className}`}>
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
