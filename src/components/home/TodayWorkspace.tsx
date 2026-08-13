import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Bookmark,
  BusFront,
  CalendarDays,
  CarFront,
  ChevronRight,
  Clock3,
  Crosshair,
  FileText,
  LocateFixed,
  Navigation,
  Plus,
  PersonStanding,
  Route,
  SquarePlus,
  Ticket,
  TrainFront,
  WalletCards,
} from 'lucide-react'
import { DayMap, type DayMapHandle } from '../DayMap'
import { TravelObjectMedia } from '../media/TravelObjectMedia'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { formatDateRange, formatShortDate } from '../../lib/dates'
import type { HomeTripOverview, HomeTripSnapshot } from '../../lib/homeOverview'
import { getHomeDeparturePresentation } from '../../lib/homeDeparture'
import { sortItineraryItems, transportModeLabels } from '../../lib/itinerary'
import { buildGoogleMapsUrl } from '../../lib/mapLinks'
import { MAP_STYLES } from '../../lib/mapConfig'
import type { RouteLineKind } from '../../lib/mapEngine'
import { generateAndCacheDayRoutePreview } from '../../lib/routeGeneration'
import { getPersistentRouteProvider } from '../../lib/routePreparation'
import {
  ROUTE_CACHE_CHANGED_EVENT,
  buildCurrentRouteCacheIdentity,
  loadRouteCache,
} from '../../lib/routeCache'
import { navigateTo } from '../../lib/routes'
import {
  ROUTING_CONFIG_CHANGED_EVENT,
  fetchDayRoute,
  getItemLngLat,
  getRoutingConfig,
  type LngLat,
} from '../../lib/routing'
import {
  USER_LOCATION_DISTANCE_THRESHOLD_METERS,
  getDistanceMeters,
} from '../../lib/dayMapViewport'
import { getTicketDisplayTitle } from '../../lib/tickets'
import { useLiveClock } from '../../hooks/useLiveClock'
import { useTravelObjectPresentation } from '../../hooks/useTravelObjectPresentation'
import {
  getTravelObjectForItineraryItem,
  type TravelObjectViewModelV1,
} from '../../lib/travelObjects'
import type { ItineraryItem, TicketMeta, TransportMode } from '../../types'

const E2E_MODE = __TRIPMAP_E2E__
const E2E_USE_LIVE_MAP = import.meta.env.VITE_E2E_USE_LIVE_MAP === '1'
const TODAY_MAP_VIEWPORT_PADDING = { top: 60, right: 76, bottom: 132, left: 60 } as const

type OriginRouteState = { lineString: LngLat[]; signature: string }
type TodayRouteGeometry = { kind: RouteLineKind; lineStrings: LngLat[][] }

export function TodayStageContainer({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="h-full min-h-0" data-testid="trip-card">
      <span aria-hidden="true" className="sr-only">{title}</span>
      <div className="h-full min-h-0" data-testid="home-primary-trip">{children}</div>
    </div>
  )
}

export function TodayWorkspace({
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
  const attemptedRouteSignaturesRef = useRef(new Set<string>())
  const attemptedOriginRouteSignaturesRef = useRef(new Set<string>())
  const [selection, setSelection] = useState<{ dayId: string; itemId: string; source: 'marker' | 'list' } | null>(null)
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [routeCacheRevision, setRouteCacheRevision] = useState(0)
  const [routeGeometry, setRouteGeometry] = useState<TodayRouteGeometry | undefined>()
  const [originRoute, setOriginRoute] = useState<OriginRouteState | null>(null)
  const [missingRouteSignature, setMissingRouteSignature] = useState<string | null>(null)
  const liveNow = useLiveClock(1_000)
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
  const canRecenterRoute = Boolean(selection || userLocation)
  const selectedItemIndex = selectedItem
    ? Math.max(0, items.findIndex((item) => item.id === selectedItem.id))
    : -1
  const selectedTicket = selectedItem
    ? findPrimaryTicket(selectedItem, snapshot.tickets)
    : null
  const selectedTicketPresentation = selectedTicket
    ? getTicketPresentation(selectedTicket)
    : null
  const transportSummary = selectedItem ? describeTodayTransport(selectedItem) : ''
  const departure = day && selectedItem
    ? getHomeDeparturePresentation({
        day,
        item: selectedItem,
        now: liveNow,
        status: overview.status,
        trip: overview.trip,
      })
    : null
  const mediaItemIds = useMemo(() => selectedItem ? [selectedItem.id] : [], [selectedItem])
  const { collection: travelObjects } = useTravelObjectPresentation({
    days: snapshot.days,
    items: snapshot.items,
    mediaItemIds,
    now: liveNow,
    tickets: snapshot.tickets,
    trip: overview.trip,
  })
  const selectedTravelObject = selectedItem
    ? getTravelObjectForItineraryItem(travelObjects, selectedItem)
    : undefined
  const relatedItems = selectedItem
    ? items.filter((item) => item.id !== selectedItem.id)
    : items
  const visibleRelatedItems = relatedItems.slice(0, 2)
  const routingConfig = useMemo(() => {
    void routeCacheRevision
    return getRoutingConfig()
  }, [routeCacheRevision])
  const routeProvider = getPersistentRouteProvider(routingConfig)
  const firstItemCoordinate = useMemo(() => getItemLngLat(items[0]), [items])
  const originRouteSignature = useMemo(() => {
    if (
      !day
      || !routeProvider
      || !userLocation
      || !firstItemCoordinate
      || items.length === 0
      || getDistanceMeters(userLocation, firstItemCoordinate) > USER_LOCATION_DISTANCE_THRESHOLD_METERS
    ) {
      return null
    }
    return [
      routeProvider,
      day.id,
      userLocation.map((value) => value.toFixed(5)).join(','),
      firstItemCoordinate.map((value) => value.toFixed(5)).join(','),
      items[0].previousTransportMode ?? items[0].transportMode ?? 'walk',
    ].join('::')
  }, [day, firstItemCoordinate, items, routeProvider, userLocation])
  const originRouteLineString = originRoute?.signature === originRouteSignature
    ? originRoute.lineString
    : undefined
  const routeLineKind = routeGeometry?.kind ?? 'sequence'
  const routeLineStrings = routeGeometry?.lineStrings
  const routeCacheIdentity = useMemo(() => {
    if (!day || items.length < 2) return null
    return {
      ...buildCurrentRouteCacheIdentity({
        tripId: overview.trip.id,
        dayId: day.id,
        items,
        provider: routeProvider ?? 'openrouteservice',
      }),
      revision: routeCacheRevision,
    }
  }, [day, items, overview.trip.id, routeCacheRevision, routeProvider])
  useEffect(() => {
    const refreshRoute = () => setRouteCacheRevision((current) => current + 1)
    window.addEventListener(ROUTE_CACHE_CHANGED_EVENT, refreshRoute)
    window.addEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshRoute)
    return () => {
      window.removeEventListener(ROUTE_CACHE_CHANGED_EVENT, refreshRoute)
      window.removeEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshRoute)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function refreshCachedRoute() {
      if (!routeCacheIdentity) {
        setRouteGeometry(undefined)
        setMissingRouteSignature(null)
        return
      }

      try {
        const cached = await loadRouteCache(routeCacheIdentity.signature)
        if (!cancelled) {
          setRouteGeometry(cached
            ? {
                kind: cached.status === 'road' ? 'road' : 'sequence',
                lineStrings: cached.lineStrings,
              }
            : undefined)
          setMissingRouteSignature(cached ? null : routeCacheIdentity.signature)
        }
      } catch {
        if (!cancelled) {
          setRouteGeometry(undefined)
          setMissingRouteSignature(routeCacheIdentity.signature)
        }
      }
    }

    void refreshCachedRoute()
    return () => {
      cancelled = true
    }
  }, [routeCacheIdentity])

  useEffect(() => {
    const attemptedRouteSignatures = attemptedRouteSignaturesRef.current
    if (
      !day
      || !routeProvider
      || !routeCacheIdentity
      || missingRouteSignature !== routeCacheIdentity.signature
      || overview.status === 'completed'
      || attemptedRouteSignatures.has(routeCacheIdentity.signature)
    ) {
      return
    }

    attemptedRouteSignatures.add(routeCacheIdentity.signature)
    const abortController = new AbortController()
    let cancelled = false
    let settled = false

    void generateAndCacheDayRoutePreview({
      config: routingConfig,
      day,
      forceRefresh: true,
      items,
      signal: abortController.signal,
      tripId: overview.trip.id,
    }).then((outcome) => {
      if (cancelled || outcome.status === 'failed' || outcome.lineStrings.length === 0) return
      setRouteGeometry({
        kind: outcome.result?.status === 'road' ? 'road' : 'sequence',
        lineStrings: outcome.lineStrings,
      })
      setMissingRouteSignature(null)
    }).catch(() => {
      // The map keeps its local point sequence when the online route is unavailable.
    }).finally(() => {
      settled = true
    })

    return () => {
      cancelled = true
      abortController.abort()
      if (!settled) attemptedRouteSignatures.delete(routeCacheIdentity.signature)
    }
  }, [
    day,
    items,
    missingRouteSignature,
    overview.status,
    overview.trip.id,
    routeCacheIdentity,
    routeProvider,
    routingConfig,
  ])

  useEffect(() => {
    const attemptedOriginRouteSignatures = attemptedOriginRouteSignaturesRef.current
    if (!day || !routeProvider || !userLocation || !firstItemCoordinate || !originRouteSignature) {
      return
    }

    if (attemptedOriginRouteSignatures.has(originRouteSignature)) {
      return
    }
    attemptedOriginRouteSignatures.add(originRouteSignature)

    const abortController = new AbortController()
    let cancelled = false
    let settled = false
    const timestamp = Date.now()
    const originItem: ItineraryItem = {
      createdAt: timestamp,
      dayId: day.id,
      id: 'current-location',
      lat: userLocation[1],
      lng: userLocation[0],
      sortOrder: -1,
      ticketIds: [],
      title: '当前位置',
      tripId: overview.trip.id,
      updatedAt: timestamp,
    }
    const destinationItem: ItineraryItem = {
      ...items[0],
      previousTransportMode: items[0].previousTransportMode ?? items[0].transportMode ?? 'walk',
    }

    void fetchDayRoute([originItem, destinationItem], routingConfig, {
      forceRefresh: true,
      signal: abortController.signal,
    }).then((result) => {
      if (cancelled) return
      const roadSegment = result.segments.find((segment) => segment.kind === 'road')
      if (roadSegment?.coordinates.length && roadSegment.coordinates.length >= 2) {
        setOriginRoute({
          lineString: roadSegment.coordinates,
          signature: originRouteSignature,
        })
      }
    }).catch(() => {
      // DayMap retains the short direct connector when the live origin route is unavailable.
    }).finally(() => {
      settled = true
    })

    return () => {
      cancelled = true
      abortController.abort()
      if (!settled) attemptedOriginRouteSignatures.delete(originRouteSignature)
    }
  }, [
    day,
    firstItemCoordinate,
    items,
    overview.trip.id,
    originRouteSignature,
    routeProvider,
    routingConfig,
    userLocation,
  ])

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
            connectUserLocationToFirst
            heightClassName="h-full min-h-0"
            items={items}
            mapEngine={E2E_MODE && !E2E_USE_LIVE_MAP ? 'maplibre' : 'auto'}
            mapStyleUrl={MAP_STYLES.positron}
            markerLabel="details"
            onSelectItem={(item) => selectItem(item, 'marker')}
            ref={mapRef}
            selectedItemId={selectedItem?.id}
            selectedItemSource={selection?.source ?? null}
            surface="fullscreen"
            routeLineStrings={routeLineStrings}
            routeLineKind={routeLineKind}
            originRouteLineString={originRouteLineString}
            userLocation={userLocation}
            viewportPadding={TODAY_MAP_VIEWPORT_PADDING}
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

        {day && items.length > 0 && (!userLocation || selection) ? (
          <div className="today-map-controls" aria-label="地图控制">
            <button
              aria-label={locationStatus === 'loading'
                ? '正在获取当前位置'
                : canRecenterRoute
                  ? '回到今日路线'
                  : '显示当前位置'}
              className="today-map-control tm-focus"
              disabled={locationStatus === 'loading'}
              onClick={canRecenterRoute
                ? () => {
                    setSelection(null)
                    mapRef.current?.recenter()
                  }
                : requestLocation}
              title={canRecenterRoute ? '回到今日路线' : '显示当前位置'}
              type="button"
            >
              {canRecenterRoute ? <Crosshair className="size-5" /> : <LocateFixed className="size-5" />}
            </button>
          </div>
        ) : null}

        {locationStatus === 'error' ? (
          <p className="today-map-notice" role="status">暂时无法取得位置</p>
        ) : null}

        {overview.status === 'ongoing' && day && selectedItem ? (
          <div className="today-map-place-sheet" data-testid="today-map-place-sheet">
            <button
              className="today-map-place-sheet-copy tm-focus"
              onClick={() => navigateTo('item', {
                dayId: day.id,
                itemId: selectedItem.id,
                tripId: overview.trip.id,
                view: 'map',
              })}
              type="button"
            >
              <span className="today-map-place-sheet-heading">
                <strong>{selectedItem.title}</strong>
                {selectedItem.startTime ? <time>{selectedItem.startTime} 入场</time> : null}
              </span>
              <small>
                {selectedTicket && selectedTicketPresentation
                  ? `门票 · ${selectedTicketPresentation.status}`
                  : selectedItem.locationName || selectedItem.address || '查看地点详情'}
              </small>
            </button>
            {selectedTicket ? (
              <button
                aria-label={`打开票据 ${getTicketDisplayTitle(selectedTicket)}`}
                className="today-map-place-sheet-ticket tm-focus"
                onClick={() => navigateTo('tickets', {
                  ticketId: selectedTicket.id,
                  tripId: overview.trip.id,
                })}
                title="打开票据"
                type="button"
              >
                <Ticket className="size-5" />
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section
        aria-label="今日行程"
        className="today-trip-sheet"
        data-testid="today-trip-sheet"
      >
        <div className="today-sheet-scroll app-scrollbar" id="today-sheet-content">
          <button
            aria-label={`${day ? getDayPosition(day.id, snapshot.days) : overview.statusLabel}，${day ? formatShortDate(day.date) : formatDateRange(overview.trip.startDate, overview.trip.endDate)}，${overview.trip.destination || overview.trip.title}`}
            className="today-trip-meta tm-focus"
            onClick={() => navigateTo('trip', { tripId: overview.trip.id })}
            type="button"
          >
            <span>{day ? getDayPosition(day.id, snapshot.days) : overview.statusLabel}</span>
            <span aria-hidden="true" className="min-w-0 truncate">
              {day ? ` · ${formatShortDate(day.date)}` : ` ${formatDateRange(overview.trip.startDate, overview.trip.endDate)}`}
              {` · ${overview.trip.destination || overview.trip.title}`}
            </span>
          </button>

          {error ? (
            <p className="today-inline-error" role="status">{error}</p>
          ) : null}

          {selectedItem ? (
            <>
              {selectedTravelObject?.media && overview.status !== 'completed' ? (
                <ActiveTodayHero
                  departure={departure}
                  item={selectedItem}
                  object={selectedTravelObject}
                  onOpenTicket={selectedTicket ? () => navigateTo('tickets', {
                    tripId: overview.trip.id,
                    ticketId: selectedTicket.id,
                  }) : undefined}
                  selectedTicket={selectedTicket}
                  selectedTicketPresentation={selectedTicketPresentation}
                  stopNumber={selectedItemIndex + 1}
                  transportSummary={transportSummary}
                />
              ) : (
                <>
                  <div className="today-next-stop">
                    <div className="min-w-0 flex-1">
                      <p className="today-overline">{overview.status === 'completed' ? '旅程回顾' : '下一站'}</p>
                      <div className="mt-1 flex min-w-0 items-start gap-3">
                        <span className="today-stop-number">{selectedItemIndex + 1}</span>
                        <div className="min-w-0 flex-1">
                          <h2>{selectedItem.title}</h2>
                          <p>{selectedItem.locationName || selectedItem.address || overview.trip.destination}</p>
                        </div>
                      </div>
                      {transportSummary ? (
                        <p className="today-transport">
                          <TransportModeIcon mode={selectedItem.previousTransportMode} />
                          <span>{transportSummary}</span>
                        </p>
                      ) : null}
                    </div>
                    {departure ? (
                      <div
                        aria-label={departure.accessibleLabel}
                        className="today-departure"
                        data-testid="today-departure-countdown"
                      >
                        <span className="today-departure-label">
                          <Clock3 className="size-4" />
                          {departure.label}
                        </span>
                        <strong>{departure.value}</strong>
                        <small>{departure.footer}</small>
                      </div>
                    ) : null}
                  </div>

                  {selectedTicket && selectedTicketPresentation ? (
                    <button
                      className="today-ticket-row tm-focus"
                      onClick={() => navigateTo('tickets', {
                        tripId: overview.trip.id,
                        ticketId: selectedTicket.id,
                      })}
                      type="button"
                    >
                      <span className="today-ticket-icon"><Ticket /></span>
                      <span className="min-w-0 flex-1">
                        <strong>
                          {getTicketDisplayTitle(selectedTicket)}
                          {selectedTicketPresentation.detail ? <span> · {selectedTicketPresentation.detail}</span> : null}
                        </strong>
                        <small>{selectedTicketPresentation.status}</small>
                      </span>
                      <span className="today-ticket-action">
                        <SquarePlus aria-hidden="true" className="size-4" />
                        打开门票
                      </span>
                    </button>
                  ) : null}

                  {overview.status === 'completed' ? (
                    <button
                      className="today-navigation-action tm-focus"
                      onClick={() => navigateTo('trip', { tripId: overview.trip.id })}
                      type="button"
                    >
                      <CalendarDays className="size-5" />
                      查看行程
                    </button>
                  ) : (
                    <a
                      className="today-navigation-action tm-focus"
                      href={buildGoogleMapsUrl(selectedItem)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Navigation className="size-5" />
                      开始导航
                    </a>
                  )}
                </>
              )}

              {relatedItems.length > 0 ? (
                <div className="today-stops" aria-label="今日其他行程">
                  {visibleRelatedItems.map((item) => (
                    <button
                      className="today-stop-row tm-focus"
                      key={item.id}
                      onClick={() => selectItem(item, 'list')}
                      type="button"
                    >
                      <span className="today-stop-row-number">{items.indexOf(item) + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="today-stop-row-heading">
                          <strong>{item.title}</strong>
                          {getSecondaryPlaceName(item) ? <em>{getSecondaryPlaceName(item)}</em> : null}
                        </span>
                        <small>
                          <TransportModeIcon mode={item.previousTransportMode} />
                          <span>{describeTodayTransport(item) || item.address || '地点待补充'}</span>
                        </small>
                      </span>
                      <span className="today-stop-row-trailing">
                        <time>{item.startTime || '--:--'}</time>
                        <Bookmark aria-hidden="true" className="size-5" />
                      </span>
                    </button>
                  ))}
                  {relatedItems.length > visibleRelatedItems.length && day ? (
                    <button
                      className="today-all-stops tm-focus"
                      onClick={() => navigateTo('day', {
                        tripId: overview.trip.id,
                        dayId: day.id,
                        view: 'schedule',
                      })}
                      type="button"
                    >
                      查看全天行程
                      <ChevronRight className="size-4" />
                    </button>
                  ) : null}
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

function ActiveTodayHero({
  departure,
  item,
  object,
  onOpenTicket,
  selectedTicket,
  selectedTicketPresentation,
  stopNumber,
  transportSummary,
}: {
  departure: ReturnType<typeof getHomeDeparturePresentation>
  item: ItineraryItem
  object: TravelObjectViewModelV1
  onOpenTicket?: () => void
  selectedTicket: TicketMeta | null
  selectedTicketPresentation: ReturnType<typeof getTicketPresentation> | null
  stopNumber: number
  transportSummary: string | null
}) {
  return (
    <section className="today-active-hero" data-testid="today-active-hero">
      <div className="today-active-hero-copy">
        <p className="today-active-hero-overline">第 {stopNumber} 站 · 下一站</p>
        <h2>{item.title}</h2>
        {departure ? (
          <div
            aria-label={departure.accessibleLabel}
            className="today-active-departure"
            data-testid="today-departure-countdown"
          >
            <Clock3 aria-hidden="true" className="size-4 shrink-0" />
            <span>{departure.label}</span>
            <strong>{departure.value}</strong>
          </div>
        ) : null}
        {transportSummary ? (
          <p className="today-active-transport">
            <TransportModeIcon mode={item.previousTransportMode} />
            <span>{transportSummary}</span>
          </p>
        ) : null}
        {selectedTicket && selectedTicketPresentation && onOpenTicket ? (
          <button className="today-active-ticket tm-focus" onClick={onOpenTicket} type="button">
            <Ticket aria-hidden="true" className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <strong>{getTicketDisplayTitle(selectedTicket)}</strong>
              <small>
                {selectedTicketPresentation.detail ? `${selectedTicketPresentation.detail} · ` : ''}
                {selectedTicketPresentation.status}
              </small>
            </span>
            <span>打开门票</span>
          </button>
        ) : null}
      </div>
      <TravelObjectMedia
        alt={object.title}
        asset={object.media}
        className="today-active-hero-media"
        eager
        sizes="(max-width: 599px) 38vw, 320px"
        variant="hero"
      />
      <a
        className="today-active-navigation tm-focus"
        href={buildGoogleMapsUrl(item)}
        rel="noreferrer"
        target="_blank"
      >
        <Navigation className="size-5" />
        开始导航
      </a>
    </section>
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

function findPrimaryTicket(item: ItineraryItem, tickets: TicketMeta[]) {
  return item.ticketIds
    .map((ticketId) => tickets.find((ticket) => ticket.id === ticketId))
    .find((ticket): ticket is TicketMeta => Boolean(ticket))
    ?? tickets.find((ticket) => ticket.itemId === item.id)
    ?? null
}

function getTicketPresentation(ticket: TicketMeta) {
  const note = ticket.note?.trim()
  if (note) {
    const parts = note.split('·').map((part) => part.trim()).filter(Boolean)
    if (parts.length > 1) {
      return {
        detail: parts.slice(0, -1).join(' · '),
        status: parts.at(-1) ?? '已关联',
      }
    }
    return { detail: '', status: note }
  }
  return ticket.fileType === 'pdf'
    ? { detail: 'PDF 票据', status: '已关联' }
    : { detail: '', status: '已关联票据' }
}

function getSecondaryPlaceName(item: ItineraryItem) {
  const locationName = item.locationName?.trim()
  if (!locationName || locationName.toLocaleLowerCase() === item.title.trim().toLocaleLowerCase()) {
    return null
  }
  return locationName
}

function TransportModeIcon({ mode }: { mode?: TransportMode }) {
  const className = 'size-4 shrink-0'
  if (mode === 'walk') return <PersonStanding aria-hidden="true" className={className} />
  if (mode === 'bus') return <BusFront aria-hidden="true" className={className} />
  if (mode === 'car') return <CarFront aria-hidden="true" className={className} />
  if (mode === 'train' || mode === 'transit') {
    return <TrainFront aria-hidden="true" className={className} />
  }
  return <Route aria-hidden="true" className={className} />
}

function describeTodayTransport(item: ItineraryItem) {
  const details = [
    item.previousTransportMode ? transportModeLabels[item.previousTransportMode] : '',
    item.previousTransportDurationMinutes === undefined
      ? ''
      : `${item.previousTransportDurationMinutes} 分钟`,
  ].filter(Boolean)
  const summary = details.join(' · ')
  const note = item.previousTransportNote?.trim()
  if (!note) return summary || null
  return summary ? `${summary} (${note})` : note
}

function getDayPosition(dayId: string, days: HomeTripSnapshot['days']) {
  const sortedDays = [...days].sort((first, second) => (
    first.date.localeCompare(second.date) || first.sortOrder - second.sortOrder
  ))
  const index = sortedDays.findIndex((day) => day.id === dayId)
  return `第${Math.max(0, index) + 1}天`
}
