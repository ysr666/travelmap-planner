import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CalendarDays, MoreVertical, Sparkles } from 'lucide-react'
import { ItemDetailContent, ItemHeaderMoreMenu } from '../components/trip/ItemDetailContent'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { getDay, getItineraryItem, getTrip } from '../db'
import { getRouteParams, navigateTo } from '../lib/routes'
import type { Day, ItineraryItem, Trip } from '../types'

const GlobalAiCommandBar = lazy(() =>
  import('../components/ai/GlobalAiCommandBar').then((module) => ({ default: module.GlobalAiCommandBar })),
)

export function ItemDetailPage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const dayId = params.get('dayId')
  const itemId = params.get('itemId')
  const hasMissingParams = !tripId || !dayId || !itemId
  const sourceView = normalizeSourceView(params.get('view'))
  const [trip, setTrip] = useState<Trip | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [item, setItem] = useState<ItineraryItem | null>(null)
  const [isLoading, setIsLoading] = useState(!hasMissingParams)
  const [isAiOpen, setIsAiOpen] = useState(false)
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)
  const aiTriggerRef = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState<string | null>(() => {
    if (hasMissingParams) return '缺少行程点参数。'
    return null
  })

  useEffect(() => {
    if (hasMissingParams) return

    let cancelled = false
    const timeout = window.setTimeout(() => {
      setIsLoading(true)
      setError(null)
      void Promise.all([
        getTrip(tripId),
        getDay(dayId),
        getItineraryItem(itemId),
      ]).then(([foundTrip, foundDay, foundItem]) => {
        if (cancelled) return
        if (!foundTrip || !foundDay || !foundItem) {
          setError('未找到该行程点。')
          setTrip(foundTrip ?? null)
          setDay(foundDay ?? null)
          setItem(foundItem ?? null)
          return
        }
        setTrip(foundTrip)
        setDay(foundDay)
        setItem(foundItem)
      }).catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : '加载行程点失败')
        }
      }).finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [dayId, hasMissingParams, itemId, tripId])

  function goBackToDay() {
    if (tripId && dayId) {
      navigateTo('day', { tripId, dayId, view: sourceView })
    } else if (tripId) {
      navigateTo('trip', { tripId })
    } else {
      navigateTo('home')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <Card className="space-y-3">
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-1/2" />
        </Card>
      </div>
    )
  }

  if (error || !trip || !day || !item) {
    return (
      <div className="space-y-4 px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <EmptyState
          body={error || '请从每日行程重新打开。'}
          icon={<CalendarDays className="size-6" />}
          title="无法打开行程点"
        />
        <Button onClick={goBackToDay} variant="secondary">
          返回每日行程
        </Button>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden" data-testid="item-detail-page">
      <header className="item-detail-header">
        <button
          aria-label="返回上一页"
          className="item-detail-header-icon tm-focus"
          onClick={goBackToDay}
          type="button"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="item-detail-header-title">地点详情</div>
        <div className="item-detail-header-actions">
          <button
            aria-expanded={isAiOpen}
            aria-haspopup="dialog"
            aria-label="AI 助手"
            className="item-detail-header-icon text-primary tm-focus"
            onClick={() => setIsAiOpen(true)}
            ref={aiTriggerRef}
            type="button"
          >
            <Sparkles className="size-5" />
          </button>
          <button
            aria-expanded={isMoreMenuOpen}
            aria-haspopup="dialog"
            aria-label="更多"
            className="item-detail-header-icon tm-focus"
            onClick={() => setIsMoreMenuOpen(true)}
            type="button"
          >
            <MoreVertical className="size-5" />
          </button>
        </div>
      </header>
      <main className="item-detail-scroll min-h-0 flex-1 overflow-y-auto app-scrollbar">
        <div className="mx-auto max-w-3xl">
          <ItemDetailContent
            day={day}
            item={item}
            key={item.id}
            onItemDeleted={goBackToDay}
            onItemUpdated={setItem}
            sourceView={sourceView}
            trip={trip}
          />
        </div>
      </main>

      <ItemHeaderMoreMenu
        day={day}
        item={item}
        onClose={() => setIsMoreMenuOpen(false)}
        open={isMoreMenuOpen}
        sourceView={sourceView}
        trip={trip}
      />

      {isAiOpen ? (
        <Suspense fallback={null}>
          <GlobalAiCommandBar
            activeRoute="item"
            onOpenChange={(open) => {
              setIsAiOpen(open)
              if (!open) window.requestAnimationFrame(() => aiTriggerRef.current?.focus())
            }}
            open={isAiOpen}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

function normalizeSourceView(value: string | null): 'schedule' | 'map' {
  return value === 'map' ? 'map' : 'schedule'
}
