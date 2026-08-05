import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  BriefcaseBusiness,
  ChevronDown,
  Search,
  Sparkles,
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
  const [initialAiCommand, setInitialAiCommand] = useState<string | null>(null)
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
  const usesNestedTripHeader = activeRoute === 'tickets'

  useEffect(() => {
    function handleOpenAi(event: Event) {
      const command = (event as CustomEvent<{ command?: string }>).detail?.command?.trim()
      setInitialAiCommand(command || null)
      setAiRoute(activeRoute)
    }

    window.addEventListener('tripmap:open-ai', handleOpenAi)
    return () => window.removeEventListener('tripmap:open-ai', handleOpenAi)
  }, [activeRoute])

  function handleAiOpenChange(nextOpen: boolean) {
    setAiRoute(nextOpen ? activeRoute : null)
    if (!nextOpen) setInitialAiCommand(null)
    if (!nextOpen) {
      window.requestAnimationFrame(() => aiTriggerRef.current?.focus())
    }
  }

  return (
    <div
      className="app-viewport app-scaffold bg-background text-on-surface"
      data-ai-open={aiOpen ? 'true' : undefined}
      data-route={activeRoute}
    >
      {showPrimaryNav ? <BottomTabBar activeRoute={activeRoute} lastTripId={lastTripId} /> : null}
      <div className="app-shell-column">
        {showTopAppBar ? (
          <header className="context-header">
            <div className="context-header-leading">
              {isPushRoute(activeRoute) || usesNestedTripHeader ? (
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
                  <ChevronDown aria-hidden="true" className="context-trip-switcher-chevron" />
                </button>
              )}
            </div>
            <div className={`context-header-heading ${usesNestedTripHeader ? 'context-header-heading-stacked' : ''}`}>
              {usesNestedTripHeader && tripTitle ? (
                <span className="context-header-subtitle">{tripTitle}</span>
              ) : null}
              <h1 className="context-header-title">{routeTitle}</h1>
            </div>
            <div className="context-header-actions">
              {showSearch ? (
                <button
                  aria-label={activeRoute === 'documents' || usesNestedTripHeader ? '搜索资料' : '搜索'}
                  className="context-header-icon tm-focus"
                  onClick={() => {
                    if (activeRoute === 'documents' || usesNestedTripHeader) {
                      window.dispatchEvent(new Event('tripmap:ticket-search'))
                      return
                    }
                    navigateTo('search', {
                      from: getPrimaryDestination(activeRoute),
                      ...(lastTripId ? { tripId: lastTripId } : {}),
                    })
                  }}
                  title={activeRoute === 'documents' || usesNestedTripHeader ? '搜索资料' : '搜索'}
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
                  onClick={() => {
                    setInitialAiCommand(null)
                    setAiRoute(activeRoute)
                  }}
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
            fallbackTripId={lastTripId}
            initialCommand={initialAiCommand}
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

  if (activeRoute === 'trip') {
    return 'app-shell-main app-shell-main-trip relative min-h-0 flex-1 overflow-y-auto app-scrollbar'
  }

  const topPadding = showTopAppBar
    ? activeRoute === 'tickets'
      ? 'pt-[calc(52px+env(safe-area-inset-top))]'
      : 'pt-[calc(56px+env(safe-area-inset-top)+8px)]'
    : 'pt-4'
  const bottomPadding = showPrimaryNav
    ? 'pb-[calc(66px+env(safe-area-inset-bottom)+16px)] min-[600px]:pb-6'
    : 'pb-6'
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
  if ((activeRoute === 'documents' || activeRoute === 'tickets') && tripId) {
    navigateTo('trip', { tripId })
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
      navigateTo('documents', tripId ? { tripId } : undefined)
      return
    }
    if (source === 'documents') {
      navigateTo('documents', tripId ? { tripId } : undefined)
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
      active: activeRoute === 'trip' || (activeRoute === 'day' && activeView !== 'map'),
      onClick: () => {
        navigateTo('trip', targetDayId ? { tripId, dayId: targetDayId } : { tripId })
      },
    },
    {
      id: 'map',
      label: '地图',
      active: activeRoute === 'day' && activeView === 'map',
      onClick: () => {
        if (targetDayId) {
          navigateTo('day', { tripId, dayId: targetDayId, view: 'map' })
        } else {
          navigateTo('trip', { tripId })
        }
      },
    },
  ]

  return (
    <nav aria-label="行程内容" className={`trip-context-tabs ${className}`}>
      <div className="trip-context-tabs-track">
        {items.map((item) => {
          return (
            <button
              aria-current={item.active ? 'page' : undefined}
              className="trip-context-tab tm-focus"
              data-active={item.active ? 'true' : undefined}
              key={item.id}
              onClick={item.onClick}
              type="button"
            >
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
