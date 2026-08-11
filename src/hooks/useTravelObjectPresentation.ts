import { useEffect, useMemo, useRef, useState } from 'react'
import { listTransportBookings, listTransportSegments } from '../lib/travelDocumentCenter'
import { fetchProviderProxyPlaceDetails, fetchProviderProxyWeatherForecast } from '../lib/providerProxyClient'
import { getProviderProxyConfig } from '../lib/providerProxyClientShared'
import {
  PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
  PROVIDER_PROXY_WEATHER_FORECAST_OPERATION,
} from '../lib/ai/providerProxyContract'
import { buildPlacePhotoMediaAsset } from '../lib/media/placeMedia'
import { TravelMediaCache } from '../lib/media/travelMediaCache'
import { RealtimeFactCache } from '../lib/realtime/realtimeFactCache'
import { getRealtimeFactFreshness, type RealtimeFactV1 } from '../lib/realtime/realtimeFact'
import {
  buildTravelObjectCollection,
  type TravelObjectCollectionV1,
} from '../lib/travelObjects/viewModel'
import {
  buildLocalTicketRealtimeFacts,
  buildTicketBlobMediaAssets,
  createEmptyTravelObjectRuntimeSupplements,
  TRAVEL_OBJECT_MEDIA_CACHE_KEY,
  TRAVEL_OBJECT_REALTIME_CACHE_KEY,
  type TravelObjectRuntimeSupplementsV1,
} from '../lib/travelObjects/runtime'
import type {
  Day,
  ItineraryItem,
  TicketMeta,
  TransportBooking,
  TransportSegment,
  Trip,
} from '../types'
import { useMediaNetworkPolicy } from './useMediaNetworkPolicy'

type WeatherTarget = {
  date: string
  latitude: number
  locationName: string
  longitude: number
  subject: { id: string; type: 'trip' | 'day' | 'item' }
  timeZone: string
}

type RuntimeState = {
  bookings: TransportBooking[]
  cachedFacts: RealtimeFactV1[]
  cachedMedia: ReturnType<TravelMediaCache['list']>
  isLoading: boolean
  segments: TransportSegment[]
  supplements: TravelObjectRuntimeSupplementsV1
}

const EMPTY_COLLECTION = buildTravelObjectCollection({
  days: [],
  items: [],
  tickets: [],
  tripId: 'empty',
})

export function useTravelObjectPresentation({
  days,
  items,
  mediaItemIds = [],
  now,
  tickets,
  trip,
  weatherTarget,
}: {
  days: Day[]
  items: ItineraryItem[]
  mediaItemIds?: string[]
  now?: Date | number | string
  tickets: TicketMeta[]
  trip: Trip | null
  weatherTarget?: WeatherTarget
}): {
  collection: TravelObjectCollectionV1
  facts: RealtimeFactV1[]
  isLoading: boolean
} {
  const [runtime, setRuntime] = useState<RuntimeState>(() => emptyRuntimeState())
  const [mountedAt] = useState(Date.now)
  const mediaNetworkPolicy = useMediaNetworkPolicy()
  const mediaAttemptsRef = useRef(new Set<string>())
  const weatherAttemptsRef = useRef(new Set<string>())
  const nowKey = normalizeNowKey(now ?? mountedAt)
  const effectiveNow = nowKey * 60_000
  const mediaItemKey = useMemo(() => [...new Set(mediaItemIds)].sort().join('|'), [mediaItemIds])
  const tripId = trip?.id ?? null

  useEffect(() => {
    mediaAttemptsRef.current.clear()
    weatherAttemptsRef.current.clear()
    if (!tripId) {
      queueMicrotask(() => setRuntime(emptyRuntimeState(false)))
      return
    }

    let cancelled = false
    const storage = getBrowserStorage('localStorage')
    const cacheNow = Date.now()
    const mediaCache = new TravelMediaCache({ storage, storageKey: TRAVEL_OBJECT_MEDIA_CACHE_KEY })
    const realtimeCache = new RealtimeFactCache({ storage, storageKey: TRAVEL_OBJECT_REALTIME_CACHE_KEY })
    const supplements = createEmptyTravelObjectRuntimeSupplements()
    queueMicrotask(() => {
      if (cancelled) return
      setRuntime((current) => ({
        ...current,
        cachedFacts: realtimeCache.list(cacheNow),
        cachedMedia: mediaCache.list(cacheNow),
        isLoading: true,
        supplements,
      }))
    })

    if (__TRIPMAP_E2E__) {
      void loadE2eTravelObjectSupplements(tripId).then((loadedSupplements) => {
        if (!cancelled) {
          setRuntime((current) => ({ ...current, supplements: loadedSupplements }))
        }
      })
    }

    void listTransportBookings(tripId).then(async (bookings) => {
      const segments = (await Promise.all(bookings.map((booking) => listTransportSegments(booking.id)))).flat()
      if (!cancelled) {
        setRuntime((current) => ({ ...current, bookings, isLoading: false, segments }))
      }
    }).catch(() => {
      if (!cancelled) setRuntime((current) => ({ ...current, bookings: [], isLoading: false, segments: [] }))
    })

    return () => {
      cancelled = true
    }
  }, [tripId])

  const mediaAssets = useMemo(() => mergeById([
    ...runtime.supplements.mediaAssets,
    ...runtime.cachedMedia,
    ...buildTicketBlobMediaAssets(tickets, effectiveNow),
  ]), [effectiveNow, runtime.cachedMedia, runtime.supplements.mediaAssets, tickets])
  const facts = useMemo(() => mergeById([
    ...runtime.supplements.realtimeFacts,
    ...runtime.cachedFacts,
    ...buildLocalTicketRealtimeFacts(tickets),
  ]), [runtime.cachedFacts, runtime.supplements.realtimeFacts, tickets])
  const collection = useMemo(() => trip ? buildTravelObjectCollection({
    days,
    insurancePolicies: runtime.supplements.insurancePolicies,
    items,
    lodgingReservations: runtime.supplements.lodgingReservations,
    mediaAssets,
    now: effectiveNow,
    tickets,
    transportBookings: runtime.bookings,
    transportSegments: runtime.segments,
    tripId: trip.id,
  }) : EMPTY_COLLECTION, [days, effectiveNow, items, mediaAssets, runtime.bookings, runtime.segments, runtime.supplements.insurancePolicies, runtime.supplements.lodgingReservations, tickets, trip])

  useEffect(() => {
    if (!trip || !mediaItemKey || mediaNetworkPolicy !== 'online') return
    const targets = items.filter((item) => (
      mediaItemIds.includes(item.id)
      && !collection.byItemId.get(item.id)?.media
      && Boolean(item.contentEnrichment?.matchedPlace?.placeId)
    )).slice(0, 4)
    if (targets.length === 0) return
    const config = getProviderProxyConfig()
    if (!config.configured || !config.proxyUrl) return
    const controllers: AbortController[] = []

    for (const item of targets) {
      const placeId = item.contentEnrichment?.matchedPlace?.placeId
      if (!placeId) continue
      const attemptKey = `${trip.id}:${item.id}:${placeId}`
      if (mediaAttemptsRef.current.has(attemptKey)) continue
      mediaAttemptsRef.current.add(attemptKey)
      const controller = new AbortController()
      controllers.push(controller)
      void fetchProviderProxyPlaceDetails({
        locale: 'zh-CN',
        operation: PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
        placeId,
      }, config.proxyUrl, { signal: controller.signal }).then((response) => {
        const asset = buildPlacePhotoMediaAsset({ itemId: item.id, response, tripId: trip.id })
        if (!asset) return
        const mediaCache = new TravelMediaCache({
          storage: getBrowserStorage('localStorage'),
          storageKey: TRAVEL_OBJECT_MEDIA_CACHE_KEY,
        })
        const result = mediaCache.put(asset, effectiveNow)
        if (result.ok) setRuntime((current) => ({ ...current, cachedMedia: mediaCache.list(effectiveNow) }))
      }).catch(() => {
        // Missing media never blocks the travel surface or invents a replacement.
      })
    }

    return () => controllers.forEach((controller) => controller.abort())
  }, [collection.byItemId, effectiveNow, items, mediaItemIds, mediaItemKey, mediaNetworkPolicy, trip])

  useEffect(() => {
    if (!trip || !weatherTarget || mediaNetworkPolicy === 'offline') return
    const weatherFact = facts.find((fact) => (
      (fact.kind === 'weather_current' || fact.kind === 'weather_forecast')
      && fact.subject.id === weatherTarget.subject.id
      && fact.subject.type === weatherTarget.subject.type
      && getRealtimeFactFreshness(fact, effectiveNow) === 'current'
    ))
    if (weatherFact) return
    const config = getProviderProxyConfig()
    if (!config.configured || !config.proxyUrl) return
    const attemptKey = [
      trip.id,
      weatherTarget.subject.type,
      weatherTarget.subject.id,
      weatherTarget.date,
      weatherTarget.latitude.toFixed(4),
      weatherTarget.longitude.toFixed(4),
    ].join(':')
    if (weatherAttemptsRef.current.has(attemptKey)) return
    weatherAttemptsRef.current.add(attemptKey)
    const controller = new AbortController()

    void fetchProviderProxyWeatherForecast({
      date: weatherTarget.date,
      includeCurrent: weatherTarget.subject.type !== 'trip',
      latitude: weatherTarget.latitude,
      locationName: weatherTarget.locationName,
      longitude: weatherTarget.longitude,
      operation: PROVIDER_PROXY_WEATHER_FORECAST_OPERATION,
      subject: weatherTarget.subject,
      timeZone: weatherTarget.timeZone,
      tripId: trip.id,
    }, config.proxyUrl, { signal: controller.signal }).then((response) => {
      const realtimeCache = new RealtimeFactCache({
        storage: getBrowserStorage('localStorage'),
        storageKey: TRAVEL_OBJECT_REALTIME_CACHE_KEY,
      })
      realtimeCache.putAll(response.facts, effectiveNow)
      setRuntime((current) => ({ ...current, cachedFacts: realtimeCache.list(effectiveNow) }))
    }).catch(() => {
      // A missing current fact stays absent; Provider diagnostics are not product copy.
    })

    return () => controller.abort()
  }, [effectiveNow, facts, mediaNetworkPolicy, trip, weatherTarget])

  return { collection, facts, isLoading: runtime.isLoading }
}

function emptyRuntimeState(isLoading = true): RuntimeState {
  return {
    bookings: [],
    cachedFacts: [],
    cachedMedia: [],
    isLoading,
    segments: [],
    supplements: createEmptyTravelObjectRuntimeSupplements(),
  }
}

async function loadE2eTravelObjectSupplements(tripId: string) {
  if (!__TRIPMAP_E2E__) return createEmptyTravelObjectRuntimeSupplements()
  const { readE2eTravelObjectSupplements } = await import('../lib/travelObjects/e2eRuntime')
  return readE2eTravelObjectSupplements({
    allowFixture: true,
    storage: getBrowserStorage('sessionStorage'),
    tripId,
  })
}

function getBrowserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window[kind]
  } catch {
    return null
  }
}

function mergeById<T extends { id: string }>(values: T[]) {
  return [...new Map(values.map((value) => [value.id, value])).values()]
}

function normalizeNowKey(value: Date | number | string) {
  const timestamp = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 60_000) : 0
}
