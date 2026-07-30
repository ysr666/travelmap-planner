import { useMemo, useRef, useState, useEffect } from 'react'
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Crosshair,
  FileText,
  LocateFixed,
  Navigation,
  Plus,
  Route,
  Ticket,
  WalletCards,
} from 'lucide-react'
import {
  createDemoTrip,
  listDaysByTrip,
  listItemsByTrip,
  listTicketsByTrip,
  listTrips,
} from '../db'
import { DayMap, type DayMapHandle } from '../components/DayMap'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { subscribeTravelDataChanged } from '../lib/dataEvents'
import { formatDateRange, formatShortDateWithWeekday } from '../lib/dates'
import {
  buildHomePortfolioModel,
  type HomePortfolioModel,
  type HomeTripOverview,
  type HomeTripSnapshot,
} from '../lib/homeOverview'
import { describeItemTime, describePreviousTransport, sortItineraryItems } from '../lib/itinerary'
import { buildGoogleMapsUrl } from '../lib/mapLinks'
import { readTripNavigationContext } from '../lib/navigationContext'
import { navigateTo } from '../lib/routes'
import { getTicketDisplayTitle } from '../lib/tickets'
import type { ItineraryItem, TicketMeta, Trip } from '../types'

const EMPTY_PORTFOLIO: HomePortfolioModel = { activeAndUpcoming: [], completed: [], primary: null }
const E2E_MODE = import.meta.env.VITE_E2E_AUTH_BYPASS === '1'

export function HomePage({
  onPrimaryTripChange,
}: {
  onPrimaryTripChange?: (trip: Pick<Trip, 'id' | 'title'> | null) => void
} = {}) {
  const [snapshots, setSnapshots] = useState<HomeTripSnapshot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreatingDemo, setIsCreatingDemo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preferredTripId = useMemo(() => readTripNavigationContext()?.tripId ?? null, [])
  const portfolio = useMemo(
    () => snapshots.length > 0
      ? buildHomePortfolioModel(snapshots, { preferredTripId })
      : EMPTY_PORTFOLIO,
    [preferredTripId, snapshots],
  )
  const primarySnapshot = useMemo(() => {
    const primaryTripId = portfolio.primary?.trip.id
    return primaryTripId
      ? snapshots.find((snapshot) => snapshot.trip.id === primaryTripId) ?? null
      : null
  }, [portfolio.primary?.trip.id, snapshots])

  useEffect(() => {
    onPrimaryTripChange?.(portfolio.primary?.trip ?? null)
  }, [onPrimaryTripChange, portfolio.primary?.trip])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const nextSnapshots = await loadHomeTripSnapshots()
        if (!cancelled) {
          setSnapshots(nextSnapshots)
          setError(null)
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '读取旅行失败')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    const unsubscribe = subscribeTravelDataChanged(() => void load())
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  async function handleCreateDemoTrip() {
    setIsCreatingDemo(true)
    setError(null)
    try {
      await createDemoTrip()
      setSnapshots(await loadHomeTripSnapshots())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建示例旅行失败')
    } finally {
      setIsCreatingDemo(false)
    }
  }

  if (isLoading) {
    return <TodayLoading />
  }

  if (!portfolio.primary || !primarySnapshot) {
    return (
      <TodayEmpty
        error={error}
        isCreatingDemo={isCreatingDemo}
        onCreateDemo={() => void handleCreateDemoTrip()}
      />
    )
  }

  return (
    <div className="h-full min-h-0" data-testid="trip-card">
      <span aria-hidden="true" className="sr-only">{portfolio.primary.trip.title}</span>
      <div className="h-full min-h-0" data-testid="home-primary-trip">
        <TodayWorkspace
          error={error}
          otherTrips={[...portfolio.activeAndUpcoming, ...portfolio.completed]}
          overview={portfolio.primary}
          snapshot={primarySnapshot}
        />
      </div>
    </div>
  )
}

function TodayWorkspace({
  error,
  otherTrips,
  overview,
  snapshot,
}: {
  error: string | null
  otherTrips: HomeTripOverview[]
  overview: HomeTripOverview
  snapshot: HomeTripSnapshot
}) {
  const mapRef = useRef<DayMapHandle | null>(null)
  const [selection, setSelection] = useState<{ dayId: string; itemId: string; source: 'marker' | 'list' } | null>(null)
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const day = overview.focusDay
  const items = useMemo(
    () => day
      ? sortItineraryItems(snapshot.items.filter((item) => item.dayId === day.id))
      : [],
    [day, snapshot.items],
  )
  const fallbackItem = overview.nextItem ?? items[0] ?? null
  const selectedItemId = selection && selection.dayId === day?.id ? selection.itemId : null
  const selectedItem = selectedItemId
    ? items.find((item) => item.id === selectedItemId) ?? fallbackItem
    : fallbackItem
  const selectedItemIndex = selectedItem
    ? Math.max(0, items.findIndex((item) => item.id === selectedItem.id))
    : -1
  const selectedTicket = selectedItem
    ? findPrimaryTicket(selectedItem, snapshot.tickets)
    : null

  function selectItem(item: ItineraryItem, source: 'marker' | 'list') {
    if (!day) return
    setSelection({ dayId: day.id, itemId: item.id, source })
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('error')
      return
    }

    setLocationStatus('loading')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          setLocationStatus('error')
          return
        }
        setUserLocation([longitude, latitude])
        setLocationStatus('idle')
        window.requestAnimationFrame(() => mapRef.current?.recenter())
      },
      () => setLocationStatus('error'),
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 8_000,
      },
    )
  }

  return (
    <div className="today-workspace">
      <section aria-label="今日地图" className="today-map-stage">
        {day ? (
          <DayMap
            heightClassName="h-full min-h-0"
            items={items}
            markerLabel="sequence"
            onSelectItem={(item) => selectItem(item, 'marker')}
            ref={mapRef}
            selectedItemId={selectedItem?.id}
            selectedItemSource={selection?.source ?? 'list'}
            surface="fullscreen"
            userLocation={userLocation}
            viewportPadding={{ top: 64, right: 40, bottom: 40, left: 40 }}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-map-bg p-5">
            <EmptyState
              body="先添加一天日程，再查看今日路线。"
              icon={<CalendarDays className="size-6" />}
              title="还没有每日行程"
            />
          </div>
        )}

        {day ? (
          <button
            className="today-map-date tm-focus"
            onClick={() => navigateTo('day', { tripId: overview.trip.id, dayId: day.id, view: 'map' })}
            type="button"
          >
            <span>{getDayPosition(day.id, snapshot.days)}天</span>
            <span aria-hidden="true">·</span>
            <span>{formatShortDateWithWeekday(day.date)}</span>
            <ChevronRight className="size-4" />
          </button>
        ) : null}

        {day && items.length > 0 ? (
          <div className="today-map-controls" aria-label="地图控制">
            <button
              aria-label="回到今日路线"
              className="today-map-control tm-focus"
              onClick={() => mapRef.current?.recenter()}
              title="回到今日路线"
              type="button"
            >
              <Crosshair className="size-5" />
            </button>
            <button
              aria-label={locationStatus === 'loading' ? '正在获取当前位置' : '显示当前位置'}
              className="today-map-control tm-focus"
              disabled={locationStatus === 'loading'}
              onClick={requestLocation}
              title="显示当前位置"
              type="button"
            >
              <LocateFixed className="size-5" />
            </button>
          </div>
        ) : null}

        {locationStatus === 'error' ? (
          <p className="today-map-notice" role="status">暂时无法取得位置</p>
        ) : null}
      </section>

      <section aria-label="今日行程" className="today-trip-sheet">
        <span aria-hidden="true" className="today-sheet-handle" />
        <div className="today-sheet-scroll app-scrollbar">
          <button
            className="today-trip-meta tm-focus"
            onClick={() => navigateTo('trip', { tripId: overview.trip.id })}
            type="button"
          >
            <span>{day ? getDayPosition(day.id, snapshot.days) : overview.statusLabel}</span>
            {day ? <span aria-hidden="true">·</span> : null}
            <span>{day ? formatShortDateWithWeekday(day.date) : formatDateRange(overview.trip.startDate, overview.trip.endDate)}</span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate">{overview.trip.destination || overview.trip.title}</span>
            <ChevronRight className="size-4 shrink-0" />
          </button>

          {error ? (
            <p className="today-inline-error" role="status">{error}</p>
          ) : null}

          {selectedItem ? (
            <>
              <div className="today-next-stop">
                <div className="min-w-0 flex-1">
                  <p className="today-overline">{overview.status === 'completed' ? '旅程回顾' : '下一站'}</p>
                  <div className="mt-2 flex min-w-0 items-start gap-3">
                    <span className="today-stop-number">{selectedItemIndex + 1}</span>
                    <div className="min-w-0 flex-1">
                      <h2>{selectedItem.title}</h2>
                      <p>{selectedItem.locationName || selectedItem.address || overview.trip.destination}</p>
                    </div>
                  </div>
                  <p className="today-transport">
                    <Route className="size-4 shrink-0" />
                    <span>{describePreviousTransport(selectedItem) || describeItemTime(selectedItem)}</span>
                  </p>
                </div>
                <div className="today-stop-time">
                  <Clock3 className="size-4" />
                  <span>{selectedItem.startTime || '时间待定'}</span>
                </div>
              </div>

              {selectedTicket ? (
                <button
                  className="today-ticket-row tm-focus"
                  onClick={() => navigateTo('tickets', {
                    tripId: overview.trip.id,
                    ticketId: selectedTicket.id,
                  })}
                  type="button"
                >
                  <span className="today-ticket-icon"><Ticket className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <strong>{getTicketDisplayTitle(selectedTicket)}</strong>
                    <small>{selectedTicket.fileType === 'pdf' ? 'PDF 票据' : '已关联票据'}</small>
                  </span>
                  <span className="today-ticket-action">打开</span>
                </button>
              ) : null}

              <a
                className="today-navigation-action tm-focus"
                href={buildGoogleMapsUrl(selectedItem)}
                rel="noreferrer"
                target="_blank"
              >
                <Navigation className="size-5" />
                开始导航
              </a>

              {items.length > 1 ? (
                <div className="today-stops" aria-label="今日其他行程">
                  {items.map((item, index) => (
                    <button
                      aria-current={item.id === selectedItem.id ? 'true' : undefined}
                      className="today-stop-row tm-focus"
                      key={item.id}
                      onClick={() => selectItem(item, 'list')}
                      type="button"
                    >
                      <span className="today-stop-row-number">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <strong>{item.title}</strong>
                        <small>{describePreviousTransport(item) || item.locationName || item.address || '地点待补充'}</small>
                      </span>
                      <time>{item.startTime || '--:--'}</time>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="today-no-stops">
              <p>{overview.preparationLabel}</p>
              <Button
                icon={<Plus className="size-4" />}
                onClick={() => day
                  ? navigateTo('item/new', { tripId: overview.trip.id, dayId: day.id })
                  : navigateTo('trip', { tripId: overview.trip.id })}
              >
                {day ? '添加行程点' : '安排日程'}
              </Button>
            </div>
          )}

          {overview.status === 'completed' ? (
            <div className="today-after-trip">
              <button onClick={() => navigateTo('documents', { tripId: overview.trip.id })} type="button">
                <FileText className="size-5" />
                旅行资料
              </button>
              <button onClick={() => navigateTo('ledger', { tripId: overview.trip.id })} type="button">
                <WalletCards className="size-5" />
                费用汇总
              </button>
            </div>
          ) : null}

          {otherTrips.length > 0 ? <OtherTrips overviews={otherTrips} /> : null}
        </div>
      </section>
    </div>
  )
}

function OtherTrips({ overviews }: { overviews: HomeTripOverview[] }) {
  return (
    <details className="today-other-trips">
      <summary>其他旅行 <span>{overviews.length}</span></summary>
      <div>
        {overviews.map((overview) => (
          <button
            key={overview.trip.id}
            onClick={() => navigateTo('trip', { tripId: overview.trip.id })}
            type="button"
          >
            <span className="min-w-0 flex-1">
              <strong>{overview.trip.title}</strong>
              <small>{overview.statusLabel} · {formatDateRange(overview.trip.startDate, overview.trip.endDate)}</small>
            </span>
            <ChevronRight className="size-4 shrink-0" />
          </button>
        ))}
      </div>
    </details>
  )
}

function TodayEmpty({
  error,
  isCreatingDemo,
  onCreateDemo,
}: {
  error: string | null
  isCreatingDemo: boolean
  onCreateDemo: () => void
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-5">
      <div className="w-full max-w-sm space-y-4">
        <EmptyState
          body="新建旅行后，今日路线、下一站和票据会出现在这里。"
          icon={<CalendarDays className="size-6" />}
          title="还没有旅行"
        />
        {error ? <p className="today-inline-error" role="status">{error}</p> : null}
        <Button
          className="w-full"
          icon={<Plus className="size-4" />}
          onClick={() => navigateTo('trip/new')}
        >
          新建旅行
        </Button>
        {E2E_MODE ? (
          <Button className="w-full" loading={isCreatingDemo} onClick={onCreateDemo} variant="secondary">
            创建示例旅行
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function TodayLoading() {
  return (
    <div className="today-workspace" aria-label="正在加载今日行程">
      <div className="bg-surface-container-high" />
      <div className="space-y-4 bg-surface p-5">
        <SkeletonLine className="w-1/3" />
        <SkeletonLine className="w-3/4" />
        <SkeletonLine className="w-full" />
        <SkeletonLine className="w-1/2" />
      </div>
    </div>
  )
}

function findPrimaryTicket(item: ItineraryItem, tickets: TicketMeta[]) {
  return item.ticketIds
    .map((ticketId) => tickets.find((ticket) => ticket.id === ticketId))
    .find((ticket): ticket is TicketMeta => Boolean(ticket))
    ?? tickets.find((ticket) => ticket.itemId === item.id)
    ?? null
}

function getDayPosition(dayId: string, days: HomeTripSnapshot['days']) {
  const sortedDays = [...days].sort((first, second) => (
    first.date.localeCompare(second.date) || first.sortOrder - second.sortOrder
  ))
  const index = sortedDays.findIndex((day) => day.id === dayId)
  return `第 ${Math.max(0, index) + 1} `
}

async function loadHomeTripSnapshots(): Promise<HomeTripSnapshot[]> {
  const trips = await listTrips()
  return Promise.all(trips.map(async (trip) => {
    const [days, items, tickets] = await Promise.all([
      listDaysByTrip(trip.id),
      listItemsByTrip(trip.id),
      listTicketsByTrip(trip.id),
    ])
    return { days, items, tickets, trip }
  }))
}
