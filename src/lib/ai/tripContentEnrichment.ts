import { sortItineraryItems } from '../itinerary'
import { recordTripWriteForSync } from '../tripSyncQueue'
import { db } from '../../db/database'
import {
  PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
  PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
  PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
  PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION,
  type ProviderProxyPlaceDetailsSuccessResponse,
  type ProviderProxyPlaceLookupSuccessResponse,
  type ProviderProxyTravelSearchResult,
  type ProviderProxyTravelSearchSuccessResponse,
  type ProviderProxyTravelSearchType,
  type ProviderProxyTripContentEnrichmentRequest,
  type ProviderProxyTripContentEnrichmentSuccessResponse,
} from './providerProxyContract'
import {
  fetchProviderProxyPlaceDetails,
  fetchProviderProxyPlaceLookup,
  fetchProviderProxyTravelSearch,
  fetchProviderProxyTripContentEnrichment,
} from '../providerProxyClient'
import type {
  ContentEnrichmentConfidence,
  ContentEnrichmentFactSection,
  ContentEnrichmentSource,
  ContentEnrichmentSourceType,
  Day,
  ItemContentEnrichment,
  ItineraryItem,
  Trip,
} from '../../types'

export const TRIP_CONTENT_ENRICHMENT_MAX_ITEMS = 6
export const TRIP_CONTENT_ENRICHMENT_MAX_SEARCHES_PER_ITEM = 2

export type TripContentEnrichmentPreviewItem = {
  checkedByDefault: boolean
  enrichment: ItemContentEnrichment
  hasWrite: boolean
  id: string
  itemId: string
  itemTitle: string
  summary: string
  warnings: string[]
}

export type TripContentEnrichmentPreview = {
  baselineFingerprint: string
  checkedIds: string[]
  generatedAt: string
  items: TripContentEnrichmentPreviewItem[]
  requestCounts: TripContentEnrichmentRequestCounts
  warnings: string[]
}

export type TripContentEnrichmentRequestCounts = {
  aiSynthesis: number
  placeDetails: number
  placeLookup: number
  travelSearch: number
  total: number
}

export type TripContentEnrichmentApplyResult =
  | { appliedCount: number; ok: true }
  | { errors: string[]; ok: false }

export type TripContentSourceRefreshSectionKey = 'openingHours' | 'ticketPrice' | 'officialWebsite'

export type TripContentSourceRefreshSection = {
  changed: boolean
  key: TripContentSourceRefreshSectionKey
  label: string
  newSourceIds: string[]
  newText?: string
  oldSourceIds: string[]
  oldText?: string
  warning?: string
}

export type TripContentSourceRefreshPreview = {
  baselineFingerprint: string
  enrichment: ItemContentEnrichment
  generatedAt: string
  itemId: string
  itemTitle: string
  requestCounts: TripContentEnrichmentRequestCounts
  sections: TripContentSourceRefreshSection[]
  warnings: string[]
}

export type TripContentSourceRefreshApplyResult =
  | { ok: true }
  | { errors: string[]; ok: false }

type TripContentEnrichmentProviderClients = {
  contentEnrichment?: typeof fetchProviderProxyTripContentEnrichment
  placeDetails?: typeof fetchProviderProxyPlaceDetails
  placeLookup?: typeof fetchProviderProxyPlaceLookup
  travelSearch?: typeof fetchProviderProxyTravelSearch
}

type EnrichmentWorkingItem = {
  day?: Day
  details?: ProviderProxyPlaceDetailsSuccessResponse['details']
  item: ItineraryItem
  searchResults: ProviderProxyTravelSearchResult[]
  sources: ContentEnrichmentSource[]
  warnings: string[]
}

export function getTripContentEnrichmentTargets(items: ItineraryItem[], trip: Trip) {
  return sortItineraryItems(items)
    .filter((item) => item.title.trim().length > 0)
    .filter((item) => {
      const currentFingerprint = buildItemContentEnrichmentFingerprint(item, trip)
      return item.contentEnrichment?.baselineFingerprint !== currentFingerprint
    })
    .slice(0, TRIP_CONTENT_ENRICHMENT_MAX_ITEMS)
}

export function estimateTripContentEnrichmentRequestCounts(items: ItineraryItem[]) {
  const targetCount = Math.min(items.length, TRIP_CONTENT_ENRICHMENT_MAX_ITEMS)
  const placeLookup = targetCount
  const placeDetails = targetCount
  const travelSearch = targetCount * TRIP_CONTENT_ENRICHMENT_MAX_SEARCHES_PER_ITEM
  const aiSynthesis = targetCount > 0 ? 1 : 0
  return {
    aiSynthesis,
    placeDetails,
    placeLookup,
    total: placeLookup + placeDetails + travelSearch + aiSynthesis,
    travelSearch,
  }
}

export function estimateTripContentSourceRefreshRequestCounts(item: ItineraryItem) {
  const placeLookup = item.contentEnrichment?.matchedPlace?.placeId ? 0 : 1
  const placeDetails = 1
  const travelSearch = 3
  const aiSynthesis = 0
  return {
    aiSynthesis,
    placeDetails,
    placeLookup,
    total: placeLookup + placeDetails + travelSearch + aiSynthesis,
    travelSearch,
  }
}

export function buildTripContentEnrichmentLocalStateFingerprint({
  days,
  items,
  trip,
}: {
  days: Day[]
  items: ItineraryItem[]
  trip: Trip
}) {
  const normalized = {
    days: [...days]
      .filter((day) => day.tripId === trip.id)
      .sort((first, second) => first.sortOrder - second.sortOrder || first.id.localeCompare(second.id))
      .map((day) => ({
        date: day.date,
        id: day.id,
        sortOrder: day.sortOrder,
        title: day.title,
      })),
    items: [...items]
      .filter((item) => item.tripId === trip.id)
      .sort((first, second) => first.dayId.localeCompare(second.dayId) || first.sortOrder - second.sortOrder || first.id.localeCompare(second.id))
      .map((item) => ({
        address: item.address ?? '',
        baseline: item.contentEnrichment?.baselineFingerprint ?? '',
        dayId: item.dayId,
        enrichmentGeneratedAt: item.contentEnrichment?.generatedAt ?? '',
        endTime: item.endTime ?? '',
        id: item.id,
        lat: finiteNumberOrNull(item.lat),
        lng: finiteNumberOrNull(item.lng),
        locationName: item.locationName ?? '',
        sortOrder: item.sortOrder,
        startTime: item.startTime ?? '',
        title: item.title,
      })),
    trip: {
      destination: trip.destination,
      endDate: trip.endDate,
      id: trip.id,
      startDate: trip.startDate,
      title: trip.title,
    },
  }
  return stableHash(JSON.stringify(normalized))
}

export function buildItemContentEnrichmentFingerprint(item: ItineraryItem, trip: Trip) {
  return stableHash(JSON.stringify({
    address: item.address ?? '',
    destination: trip.destination,
    endTime: item.endTime ?? '',
    lat: finiteNumberOrNull(item.lat),
    lng: finiteNumberOrNull(item.lng),
    locationName: item.locationName ?? '',
    startTime: item.startTime ?? '',
    title: item.title,
  }))
}

export function buildTripContentEnrichmentPlaceLookupQuery(item: ItineraryItem, trip: Trip) {
  return clampText(dedupeText([item.locationName, item.address, item.title, trip.destination]).join(' '), 200)
}

export async function generateTripContentEnrichmentPreview({
  clients = {},
  days,
  items,
  proxyUrl,
  targets,
  trip,
}: {
  clients?: TripContentEnrichmentProviderClients
  days: Day[]
  items: ItineraryItem[]
  proxyUrl: string
  targets?: ItineraryItem[]
  trip: Trip
}): Promise<TripContentEnrichmentPreview> {
  const placeLookup = clients.placeLookup ?? fetchProviderProxyPlaceLookup
  const placeDetails = clients.placeDetails ?? fetchProviderProxyPlaceDetails
  const travelSearch = clients.travelSearch ?? fetchProviderProxyTravelSearch
  const contentEnrichment = clients.contentEnrichment ?? fetchProviderProxyTripContentEnrichment
  const generatedAt = new Date().toISOString()
  const baselineFingerprint = buildTripContentEnrichmentLocalStateFingerprint({ days, items, trip })
  const targetItems = (targets ?? getTripContentEnrichmentTargets(items, trip)).slice(0, TRIP_CONTENT_ENRICHMENT_MAX_ITEMS)
  const dayById = new Map(days.map((day) => [day.id, day]))
  const workingItems: EnrichmentWorkingItem[] = []
  const warnings: string[] = []
  const requestCounts: TripContentEnrichmentRequestCounts = {
    aiSynthesis: 0,
    placeDetails: 0,
    placeLookup: 0,
    total: 0,
    travelSearch: 0,
  }

  for (const item of targetItems) {
    const working: EnrichmentWorkingItem = {
      day: dayById.get(item.dayId),
      item,
      searchResults: [],
      sources: [],
      warnings: [],
    }
    requestCounts.placeLookup += 1
    requestCounts.total += 1
    try {
      const lookupResponse = await placeLookup({
        locale: 'zh-CN',
        maxResults: 3,
        operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
        query: buildTripContentEnrichmentPlaceLookupQuery(item, trip),
      }, proxyUrl)
      const candidate = selectBestPlaceLookupResult(lookupResponse)
      if (!candidate) {
        working.warnings.push('未找到可用于内容补充的 Places 候选。')
      } else {
        requestCounts.placeDetails += 1
        requestCounts.total += 1
        const detailsResponse = await placeDetails({
          locale: 'zh-CN',
          operation: PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
          placeId: candidate.placeId,
        }, proxyUrl)
        working.details = detailsResponse.details
        working.sources.push(...buildSourcesFromPlaceDetails(detailsResponse.details))
      }
    } catch {
      working.warnings.push('Places 信息获取失败，已跳过该行程点的 Places 来源。')
    }

    const searchPlan = buildTravelSearchPlan(item, trip, working.details)
    for (const searchType of searchPlan) {
      requestCounts.travelSearch += 1
      requestCounts.total += 1
      try {
        const searchResponse = await travelSearch({
          locale: 'zh-CN',
          maxResults: 3,
          operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
          query: buildTravelSearchQuery(item, trip, searchType),
          searchType,
        }, proxyUrl)
        working.searchResults.push(...searchResponse.results)
        working.sources.push(...buildSourcesFromTravelSearch(item, searchResponse))
      } catch {
        working.warnings.push(`${formatSearchType(searchType)}搜索失败。`)
      }
    }

    working.sources = dedupeSources(sortSourcesByPriority(working.sources))
    if (working.sources.length === 0) {
      working.warnings.push('没有可引用来源，未生成事实性内容。')
    }
    workingItems.push(working)
  }

  const aiReadyItems = workingItems.filter((item) => item.sources.length > 0)
  if (aiReadyItems.length === 0) {
    return {
      baselineFingerprint,
      checkedIds: [],
      generatedAt,
      items: [],
      requestCounts,
      warnings: dedupeWarnings([...warnings, '没有可用于内容补充的来源。']),
    }
  }

  requestCounts.aiSynthesis += 1
  requestCounts.total += 1
  const aiRequest = buildTripContentEnrichmentAiRequest(aiReadyItems, trip)
  let aiResponse: ProviderProxyTripContentEnrichmentSuccessResponse
  try {
    aiResponse = await contentEnrichment(aiRequest, proxyUrl)
  } catch {
    return {
      baselineFingerprint,
      checkedIds: [],
      generatedAt,
      items: [],
      requestCounts,
      warnings: dedupeWarnings([...warnings, 'AI 内容合成失败，未生成可应用预览。']),
    }
  }

  const workingByItemId = new Map(aiReadyItems.map((item) => [item.item.id, item]))
  const previewItems = aiResponse.items.flatMap((result): TripContentEnrichmentPreviewItem[] => {
    const working = workingByItemId.get(result.itemId)
    if (!working) return []
    const enrichment = buildItemContentEnrichment({
      details: working.details,
      generatedAt,
      item: working.item,
      result,
      sources: working.sources,
      trip,
      warnings: [...working.warnings, ...(result.warnings ?? [])],
    })
    if (!enrichment) return []
    return [{
      checkedByDefault: true,
      enrichment,
      hasWrite: true,
      id: `content:${working.item.id}`,
      itemId: working.item.id,
      itemTitle: working.item.title,
      summary: summarizeEnrichment(enrichment),
      warnings: enrichment.warnings,
    }]
  })

  return {
    baselineFingerprint,
    checkedIds: previewItems.map((item) => item.id),
    generatedAt,
    items: previewItems,
    requestCounts,
    warnings: dedupeWarnings([
      ...warnings,
      ...(aiResponse.warnings ?? []),
      previewItems.length === 0 ? 'AI 返回内容没有通过来源校验。' : '',
    ]),
  }
}

export async function applyTripContentEnrichmentPreviewsToDb(
  tripId: string,
  previews: TripContentEnrichmentPreviewItem[],
  checkedIds: string[],
  options: { expectedBaselineFingerprint?: string; now?: number } = {},
): Promise<TripContentEnrichmentApplyResult> {
  const selected = previews.filter((preview) => checkedIds.includes(preview.id) && preview.hasWrite)
  if (selected.length === 0) {
    return { appliedCount: 0, ok: true }
  }
  try {
    const now = options.now ?? Date.now()
    const result = await db.transaction('rw', db.trips, db.days, db.itineraryItems, async () => {
      const [trip, days, items] = await Promise.all([
        db.trips.get(tripId),
        db.days.where('tripId').equals(tripId).toArray(),
        db.itineraryItems.where('tripId').equals(tripId).toArray(),
      ])
      if (!trip) {
        return { errors: ['旅行不存在。'], ok: false as const }
      }
      if (options.expectedBaselineFingerprint) {
        const freshFingerprint = buildTripContentEnrichmentLocalStateFingerprint({ days, items, trip })
        if (freshFingerprint !== options.expectedBaselineFingerprint) {
          return { errors: ['本地行程已变化，请重新生成内容补充预览。'], ok: false as const }
        }
      }

      const itemMap = new Map(items.map((item) => [item.id, item]))
      const changedItems: ItineraryItem[] = []
      for (const preview of selected) {
        const item = itemMap.get(preview.itemId)
        if (!item) {
          return { errors: [`行程点不存在：${preview.itemId}`], ok: false as const }
        }
        changedItems.push({
          ...item,
          contentEnrichment: preview.enrichment,
          updatedAt: now,
        })
      }
      if (changedItems.length > 0) {
        await db.itineraryItems.bulkPut(changedItems)
        await db.trips.update(tripId, { updatedAt: now })
      }
      return { appliedCount: changedItems.length, changed: changedItems.length > 0, ok: true as const }
    })
    if (!result.ok) {
      return result
    }
    if (result.changed) {
      recordTripWriteForSync(tripId, 'trip-content-enrichment-applied')
    }
    return { appliedCount: result.appliedCount, ok: true }
  } catch {
    return { errors: ['应用内容补充失败，旅行未完成写入。'], ok: false }
  }
}

export async function generateTripContentSourceRefreshPreview({
  clients = {},
  item,
  proxyUrl,
  trip,
}: {
  clients?: Pick<TripContentEnrichmentProviderClients, 'placeDetails' | 'placeLookup' | 'travelSearch'>
  item: ItineraryItem
  proxyUrl: string
  trip: Trip
}): Promise<TripContentSourceRefreshPreview> {
  const placeLookup = clients.placeLookup ?? fetchProviderProxyPlaceLookup
  const placeDetails = clients.placeDetails ?? fetchProviderProxyPlaceDetails
  const travelSearch = clients.travelSearch ?? fetchProviderProxyTravelSearch
  const generatedAt = new Date().toISOString()
  const requestCounts: TripContentEnrichmentRequestCounts = {
    aiSynthesis: 0,
    placeDetails: 0,
    placeLookup: 0,
    total: 0,
    travelSearch: 0,
  }
  const warnings: string[] = []
  const baselineFingerprint = buildItemContentSourceRefreshBaselineFingerprint(item, trip)
  const baseEnrichment = buildRefreshBaseEnrichment(item, trip, generatedAt)

  let details: ProviderProxyPlaceDetailsSuccessResponse['details'] | undefined
  let placeId = item.contentEnrichment?.matchedPlace?.placeId
  if (!placeId) {
    requestCounts.placeLookup += 1
    requestCounts.total += 1
    try {
      const lookupResponse = await placeLookup({
        locale: 'zh-CN',
        maxResults: 3,
        operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
        query: buildTripContentEnrichmentPlaceLookupQuery(item, trip),
      }, proxyUrl)
      placeId = selectBestPlaceLookupResult(lookupResponse)?.placeId
      if (!placeId) {
        warnings.push('未找到可用于刷新来源的 Places 候选。')
      }
    } catch {
      warnings.push('Places 候选查询失败，已跳过地点详情刷新。')
    }
  }

  if (placeId) {
    requestCounts.placeDetails += 1
    requestCounts.total += 1
    try {
      const detailsResponse = await placeDetails({
        locale: 'zh-CN',
        operation: PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
        placeId,
      }, proxyUrl)
      details = detailsResponse.details
    } catch {
      warnings.push('Places 详情刷新失败，已保留已有地点详情。')
    }
  }

  const sources: ContentEnrichmentSource[] = []
  if (details) {
    sources.push(...buildSourcesFromPlaceDetails(details))
  }
  const searchPlan = buildSourceRefreshSearchPlan(details)
  for (const searchType of searchPlan) {
    requestCounts.travelSearch += 1
    requestCounts.total += 1
    try {
      const searchResponse = await travelSearch({
        locale: 'zh-CN',
        maxResults: 3,
        operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
        query: buildTravelSearchQuery(item, trip, searchType),
        searchType,
      }, proxyUrl)
      sources.push(...buildSourcesFromTravelSearch(item, searchResponse))
    } catch {
      warnings.push(`${formatSearchType(searchType)}来源搜索失败。`)
    }
  }

  const next = buildSourceRefreshEnrichment({
    baseEnrichment,
    details,
    generatedAt,
    item,
    refreshedSources: dedupeSources(sortSourcesByPriority(sources)),
    trip,
    warnings,
  })

  return {
    baselineFingerprint,
    enrichment: next.enrichment,
    generatedAt,
    itemId: item.id,
    itemTitle: item.title,
    requestCounts,
    sections: next.sections,
    warnings: next.warnings,
  }
}

export async function applyTripContentSourceRefreshPreviewToDb(
  tripId: string,
  preview: TripContentSourceRefreshPreview,
  options: { expectedBaselineFingerprint?: string; now?: number } = {},
): Promise<TripContentSourceRefreshApplyResult> {
  try {
    const now = options.now ?? Date.now()
    const result = await db.transaction('rw', db.trips, db.itineraryItems, async () => {
      const [trip, item] = await Promise.all([
        db.trips.get(tripId),
        db.itineraryItems.get(preview.itemId),
      ])
      if (!trip || !item || item.tripId !== tripId) {
        return { errors: ['行程点不存在。'], ok: false as const }
      }
      if (options.expectedBaselineFingerprint) {
        const freshFingerprint = buildItemContentSourceRefreshBaselineFingerprint(item, trip)
        if (freshFingerprint !== options.expectedBaselineFingerprint) {
          return { errors: ['本地行程已变化，请重新刷新来源。'], ok: false as const }
        }
      }
      await db.itineraryItems.put({
        ...item,
        contentEnrichment: preview.enrichment,
        updatedAt: now,
      })
      await db.trips.update(tripId, { updatedAt: now })
      return { ok: true as const }
    })
    if (!result.ok) {
      return result
    }
    recordTripWriteForSync(tripId, 'trip-content-source-refresh-applied')
    return { ok: true }
  } catch {
    return { errors: ['应用来源刷新失败，行程点未完成写入。'], ok: false }
  }
}

function buildTripContentEnrichmentAiRequest(
  workingItems: EnrichmentWorkingItem[],
  trip: Trip,
): ProviderProxyTripContentEnrichmentRequest {
  return {
    items: workingItems.map((working) => ({
      address: working.item.address,
      date: working.day?.date,
      dayTitle: working.day?.title,
      destination: trip.destination,
      itemId: working.item.id,
      locationName: working.item.locationName,
      place: working.details ? {
        displayName: working.details.displayName,
        editorialSummary: working.details.editorialSummary,
        formattedAddress: working.details.formattedAddress,
        googleMapsUri: working.details.googleMapsUri,
        placeId: working.details.placeId,
        priceLevel: working.details.priceLevel,
        priceRangeText: working.details.priceRangeText,
        regularOpeningHours: working.details.regularOpeningHours,
        retrievedAt: working.details.retrievedAt,
        websiteUri: working.details.websiteUri,
      } : undefined,
    sources: working.sources.map((source) => ({
      confidence: source.confidence,
      displayUrl: source.displayUrl,
      domain: source.domain,
      id: source.id,
      label: source.label,
      retrievedAt: source.retrievedAt,
      snippet: source.snippet,
      sourceType: source.sourceType,
      title: source.title,
      url: source.url,
      })),
      title: working.item.title,
    })),
    locale: 'zh-CN',
    operation: PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION,
  }
}

function buildItemContentEnrichment({
  details,
  generatedAt,
  item,
  result,
  sources,
  trip,
  warnings,
}: {
  details?: ProviderProxyPlaceDetailsSuccessResponse['details']
  generatedAt: string
  item: ItineraryItem
  result: ProviderProxyTripContentEnrichmentSuccessResponse['items'][number]
  sources: ContentEnrichmentSource[]
  trip: Trip
  warnings: string[]
}): ItemContentEnrichment | null {
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const introduction = filterFact(result.introduction, sourceById)
  const openingHours = filterFact(result.openingHours, sourceById)
  const ticketPriceFact = filterFact(result.ticketPrice, sourceById)
  const notices = (result.notices ?? []).flatMap((notice) => {
    const filtered = filterFact(notice, sourceById)
    return filtered ? [filtered] : []
  })
  const recommendedStay = result.recommendedStay
    ? {
      basis: result.recommendedStay.basis,
      durationMinutes: result.recommendedStay.durationMinutes,
      reason: result.recommendedStay.reason,
      sourceIds: result.recommendedStay.sourceIds?.filter((sourceId) => sourceById.has(sourceId)),
      text: result.recommendedStay.text,
    }
    : undefined

  if (!introduction && !openingHours && !ticketPriceFact && notices.length === 0 && !recommendedStay) {
    return null
  }

  const placeSource = sources.find((source) => source.sourceType === 'google_places')
  const enrichment: ItemContentEnrichment = {
    baselineFingerprint: buildItemContentEnrichmentFingerprint(item, trip),
    generatedAt,
    introduction,
    matchedPlace: placeSource && details ? {
      address: details.formattedAddress,
      googleMapsUri: details.googleMapsUri,
      lat: details.location?.lat,
      lng: details.location?.lng,
      name: details.displayName,
      placeId: details.placeId,
      retrievedAt: details.retrievedAt,
      websiteUri: details.websiteUri,
    } : undefined,
    notices,
    openingHours,
    recommendedStay,
    schemaVersion: 1,
    sources,
    ticketPrice: ticketPriceFact ? {
      ...ticketPriceFact,
      kind: result.ticketPrice?.kind ?? 'unknown',
    } : undefined,
    warnings: dedupeWarnings(warnings),
  }
  return enrichment
}

function buildItemContentSourceRefreshBaselineFingerprint(item: ItineraryItem, trip: Trip) {
  return stableHash(JSON.stringify({
    contentEnrichment: item.contentEnrichment ? {
      baselineFingerprint: item.contentEnrichment.baselineFingerprint,
      generatedAt: item.contentEnrichment.generatedAt,
      matchedPlace: item.contentEnrichment.matchedPlace,
      openingHours: item.contentEnrichment.openingHours,
      sources: item.contentEnrichment.sources.map((source) => ({
        id: source.id,
        retrievedAt: source.retrievedAt,
        sourceType: source.sourceType,
        url: source.url,
      })),
      ticketPrice: item.contentEnrichment.ticketPrice,
    } : undefined,
    item: buildItemContentEnrichmentFingerprint(item, trip),
    tripId: trip.id,
  }))
}

function buildRefreshBaseEnrichment(item: ItineraryItem, trip: Trip, generatedAt: string): ItemContentEnrichment {
  return item.contentEnrichment ?? {
    baselineFingerprint: buildItemContentEnrichmentFingerprint(item, trip),
    generatedAt,
    notices: [],
    schemaVersion: 1,
    sources: [],
    warnings: [],
  }
}

function buildSourceRefreshSearchPlan(details?: ProviderProxyPlaceDetailsSuccessResponse['details']): ProviderProxyTravelSearchType[] {
  const plan: ProviderProxyTravelSearchType[] = ['ticket_price']
  if (!details?.regularOpeningHours?.weekdayDescriptions.length) {
    plan.push('opening_hours')
  }
  if (!details?.websiteUri) {
    plan.push('official_site')
  }
  return plan
}

function buildSourceRefreshEnrichment({
  baseEnrichment,
  details,
  generatedAt,
  item,
  refreshedSources,
  trip,
  warnings,
}: {
  baseEnrichment: ItemContentEnrichment
  details?: ProviderProxyPlaceDetailsSuccessResponse['details']
  generatedAt: string
  item: ItineraryItem
  refreshedSources: ContentEnrichmentSource[]
  trip: Trip
  warnings: string[]
}) {
  const placeSource = refreshedSources.find((source) => source.sourceType === 'google_places')
  const refreshedOpeningHours = buildOpeningHoursFactFromDetails(details, placeSource) ?? buildFactFromSource(selectOpeningHoursSource(refreshedSources))
  const refreshedTicketPrice = buildTicketPriceFactFromSource(selectTicketPriceSource(refreshedSources))
  const officialSource = selectOfficialWebsiteSource(refreshedSources)
  const nextOpeningHours = refreshedOpeningHours ?? baseEnrichment.openingHours
  const nextTicketPrice = refreshedTicketPrice ?? baseEnrichment.ticketPrice
  const nextMatchedPlace = buildRefreshedMatchedPlace(baseEnrichment, details, officialSource, generatedAt)
  const nextWarnings = dedupeWarnings([
    ...baseEnrichment.warnings,
    ...warnings,
    refreshedOpeningHours ? '' : baseEnrichment.openingHours ? '未找到新的开放时间来源，已保留原内容。' : '未找到开放时间来源。',
    refreshedTicketPrice ? '' : baseEnrichment.ticketPrice ? '未找到新的票价来源，已保留原内容。' : '未找到票价来源。',
    officialSource ? '' : baseEnrichment.matchedPlace?.websiteUri ? '未找到新的官网来源，已保留原内容。' : '未找到官网来源。',
  ])
  const enrichment: ItemContentEnrichment = {
    ...baseEnrichment,
    baselineFingerprint: buildItemContentEnrichmentFingerprint(item, trip),
    generatedAt,
    matchedPlace: nextMatchedPlace,
    openingHours: nextOpeningHours,
    sources: mergeSourceRefreshSources({
      baseEnrichment,
      nextOpeningHours,
      nextTicketPrice,
      officialWebsiteUri: nextMatchedPlace?.websiteUri,
      officialSource,
      refreshedSources,
    }),
    ticketPrice: nextTicketPrice,
    warnings: nextWarnings,
  }

  return {
    enrichment,
    sections: buildSourceRefreshSections(baseEnrichment, enrichment),
    warnings: nextWarnings,
  }
}

function buildOpeningHoursFactFromDetails(
  details: ProviderProxyPlaceDetailsSuccessResponse['details'] | undefined,
  placeSource: ContentEnrichmentSource | undefined,
): ContentEnrichmentFactSection | undefined {
  const descriptions = details?.regularOpeningHours?.weekdayDescriptions
  if (!descriptions?.length || !placeSource) return undefined
  return {
    sourceIds: [placeSource.id],
    text: descriptions.join('；'),
  }
}

function buildFactFromSource(source: ContentEnrichmentSource | undefined): ContentEnrichmentFactSection | undefined {
  if (!source?.snippet?.trim()) return undefined
  return {
    sourceIds: [source.id],
    text: source.snippet.trim(),
  }
}

function buildTicketPriceFactFromSource(source: ContentEnrichmentSource | undefined): ItemContentEnrichment['ticketPrice'] {
  const fact = buildFactFromSource(source)
  if (!fact) return undefined
  return {
    ...fact,
    kind: 'admission',
  }
}

function buildRefreshedMatchedPlace(
  baseEnrichment: ItemContentEnrichment,
  details: ProviderProxyPlaceDetailsSuccessResponse['details'] | undefined,
  officialSource: ContentEnrichmentSource | undefined,
  generatedAt: string,
): ItemContentEnrichment['matchedPlace'] {
  if (details) {
    return {
      address: details.formattedAddress,
      googleMapsUri: details.googleMapsUri,
      lat: details.location?.lat,
      lng: details.location?.lng,
      name: details.displayName,
      placeId: details.placeId,
      retrievedAt: details.retrievedAt,
      websiteUri: details.websiteUri ?? officialSource?.url ?? baseEnrichment.matchedPlace?.websiteUri,
    }
  }
  if (baseEnrichment.matchedPlace && officialSource?.url) {
    return {
      ...baseEnrichment.matchedPlace,
      retrievedAt: generatedAt,
      websiteUri: officialSource.url,
    }
  }
  return baseEnrichment.matchedPlace
}

function mergeSourceRefreshSources({
  baseEnrichment,
  nextOpeningHours,
  nextTicketPrice,
  officialWebsiteUri,
  officialSource,
  refreshedSources,
}: {
  baseEnrichment: ItemContentEnrichment
  nextOpeningHours?: ContentEnrichmentFactSection
  nextTicketPrice?: ItemContentEnrichment['ticketPrice']
  officialWebsiteUri?: string
  officialSource?: ContentEnrichmentSource
  refreshedSources: ContentEnrichmentSource[]
}) {
  const preservedSourceIds = new Set<string>()
  collectFactSourceIds(baseEnrichment.introduction, preservedSourceIds)
  collectFactSourceIds(nextOpeningHours, preservedSourceIds)
  collectFactSourceIds(nextTicketPrice, preservedSourceIds)
  for (const notice of baseEnrichment.notices) {
    collectFactSourceIds(notice, preservedSourceIds)
  }
  for (const sourceId of baseEnrichment.recommendedStay?.sourceIds ?? []) {
    preservedSourceIds.add(sourceId)
  }
  if (officialSource) {
    preservedSourceIds.add(officialSource.id)
  }
  for (const source of baseEnrichment.sources) {
    if (officialWebsiteUri && source.sourceType === 'official' && source.url === officialWebsiteUri) {
      preservedSourceIds.add(source.id)
    }
  }

  const preservedSources = baseEnrichment.sources.filter((source) => preservedSourceIds.has(source.id))
  return dedupeSources(sortSourcesByPriority([...preservedSources, ...refreshedSources]))
}

function collectFactSourceIds(section: ContentEnrichmentFactSection | undefined, sourceIds: Set<string>) {
  for (const sourceId of section?.sourceIds ?? []) {
    sourceIds.add(sourceId)
  }
}

function buildSourceRefreshSections(
  oldEnrichment: ItemContentEnrichment,
  newEnrichment: ItemContentEnrichment,
): TripContentSourceRefreshSection[] {
  return [
    buildFactRefreshSection('openingHours', '开放时间', oldEnrichment.openingHours, newEnrichment.openingHours),
    buildFactRefreshSection('ticketPrice', '票价', oldEnrichment.ticketPrice, newEnrichment.ticketPrice),
    buildOfficialWebsiteRefreshSection(oldEnrichment, newEnrichment),
  ]
}

function buildFactRefreshSection(
  key: Extract<TripContentSourceRefreshSectionKey, 'openingHours' | 'ticketPrice'>,
  label: string,
  oldSection: ContentEnrichmentFactSection | undefined,
  newSection: ContentEnrichmentFactSection | undefined,
): TripContentSourceRefreshSection {
  const oldSourceIds = oldSection?.sourceIds ?? []
  const newSourceIds = newSection?.sourceIds ?? []
  const changed = (oldSection?.text ?? '') !== (newSection?.text ?? '') || normalizeSourceIds(oldSourceIds) !== normalizeSourceIds(newSourceIds)
  return {
    changed,
    key,
    label,
    newSourceIds,
    newText: newSection?.text,
    oldSourceIds,
    oldText: oldSection?.text,
    warning: changed ? undefined : '未发现新的可更新来源。',
  }
}

function buildOfficialWebsiteRefreshSection(
  oldEnrichment: ItemContentEnrichment,
  newEnrichment: ItemContentEnrichment,
): TripContentSourceRefreshSection {
  const oldSourceIds = getOfficialWebsiteSourceIds(oldEnrichment)
  const newSourceIds = getOfficialWebsiteSourceIds(newEnrichment)
  const oldText = getOfficialWebsiteText(oldEnrichment)
  const newText = getOfficialWebsiteText(newEnrichment)
  const changed = (oldText ?? '') !== (newText ?? '') || normalizeSourceIds(oldSourceIds) !== normalizeSourceIds(newSourceIds)
  return {
    changed,
    key: 'officialWebsite',
    label: '官网来源',
    newSourceIds,
    newText,
    oldSourceIds,
    oldText,
    warning: changed ? undefined : '未发现新的官网来源。',
  }
}

function getOfficialWebsiteText(enrichment: ItemContentEnrichment) {
  const websiteUri = enrichment.matchedPlace?.websiteUri
  const matchingSource = websiteUri
    ? enrichment.sources.find((source) => source.sourceType === 'official' && source.url === websiteUri)
    : undefined
  return matchingSource?.url ?? websiteUri ?? selectOfficialWebsiteSource(enrichment.sources)?.url
}

function getOfficialWebsiteSourceIds(enrichment: ItemContentEnrichment) {
  const websiteUri = enrichment.matchedPlace?.websiteUri
  const sources = enrichment.sources
    .filter((source) => source.sourceType === 'official' && Boolean(source.url))
    .filter((source) => !websiteUri || source.url === websiteUri)
    .map((source) => source.id)
  return sources.length > 0
    ? sources
    : enrichment.sources
      .filter((source) => source.sourceType === 'official' && Boolean(source.url))
      .map((source) => source.id)
}

function normalizeSourceIds(sourceIds: string[]) {
  return [...sourceIds].sort().join('|')
}

function selectOpeningHoursSource(sources: ContentEnrichmentSource[]) {
  return sortSourcesByPriority(sources.filter((source) => {
    if (!source.snippet?.trim()) return false
    if (source.sourceType === 'official' || source.sourceType === 'map') return true
    return source.sourceType === 'travel_site' && source.confidence === 'high'
  }))[0]
}

function selectTicketPriceSource(sources: ContentEnrichmentSource[]) {
  return sources.filter((source) => {
    if (!source.snippet?.trim()) return false
    if (source.sourceType === 'ticketing') return true
    const text = `${source.label} ${source.title} ${source.snippet}`.toLowerCase()
    const mentionsTicket = /票|门票|收费|免费|元|价格|入场|admission|ticket|price/.test(text)
    if (!mentionsTicket) return false
    if (source.sourceType === 'official' || source.sourceType === 'map') return true
    return source.sourceType === 'travel_site' && source.confidence === 'high'
  }).sort((first, second) => ticketSourcePriority(second) - ticketSourcePriority(first))[0]
}

function selectOfficialWebsiteSource(sources: ContentEnrichmentSource[]) {
  return sources
    .filter((source) => source.sourceType === 'official' && Boolean(source.url))
    .sort((first, second) => officialWebsiteSourcePriority(second) - officialWebsiteSourcePriority(first))[0]
}

function ticketSourcePriority(source: ContentEnrichmentSource) {
  return (source.sourceType === 'ticketing' ? 1000 : 0) + sourcePriority(source)
}

function officialWebsiteSourcePriority(source: ContentEnrichmentSource) {
  const text = `${source.label} ${source.title} ${source.snippet ?? ''}`
  const looksLikeWebsite = /官网|官方网站|official site/i.test(text) ? 500 : 0
  let rootUrlBonus = 0
  if (source.url) {
    try {
      const url = new URL(source.url)
      rootUrlBonus = url.pathname === '/' || url.pathname === '' ? 100 : 0
    } catch {
      rootUrlBonus = 0
    }
  }
  return looksLikeWebsite + rootUrlBonus + sourcePriority(source)
}

function filterFact<T extends { sourceIds: string[]; text: string } | undefined>(
  fact: T,
  sourceById: Map<string, ContentEnrichmentSource>,
) {
  if (!fact?.text.trim()) return undefined
  const sourceIds = fact.sourceIds.filter((sourceId) => sourceById.has(sourceId))
  if (sourceIds.length === 0) return undefined
  return { sourceIds, text: fact.text.trim() }
}

function buildSourcesFromPlaceDetails(details: ProviderProxyPlaceDetailsSuccessResponse['details']): ContentEnrichmentSource[] {
  const sources: ContentEnrichmentSource[] = [{
    confidence: 'high',
    displayUrl: 'Google Places',
    id: `place:${details.placeId}`,
    label: 'Google Places',
    retrievedAt: details.retrievedAt,
    snippet: [
      details.editorialSummary,
      details.regularOpeningHours?.weekdayDescriptions.join('；'),
      details.priceLevel ? `价格等级：${details.priceLevel}` : '',
      details.priceRangeText ? `价格范围：${details.priceRangeText}` : '',
    ].filter(Boolean).join(' '),
    sourceType: 'google_places',
    title: details.displayName,
    url: details.googleMapsUri,
  }]
  if (details.websiteUri) {
    sources.push({
      confidence: 'high',
      displayUrl: formatDisplayUrl(details.websiteUri),
      domain: getDomain(details.websiteUri),
      id: `official:${stableHash(details.websiteUri)}`,
      label: '官网',
      retrievedAt: details.retrievedAt,
      snippet: 'Google Places 返回的官方网站链接。',
      sourceType: 'official',
      title: `${details.displayName} 官网`,
      url: details.websiteUri,
    })
  }
  return sources
}

function buildSourcesFromTravelSearch(
  item: ItineraryItem,
  response: ProviderProxyTravelSearchSuccessResponse,
): ContentEnrichmentSource[] {
  return response.results.map((result, index) => ({
    confidence: mapSearchConfidence(result.confidence),
    displayUrl: result.displayUrl,
    domain: result.domain,
    id: `search:${item.id}:${stableHash(`${result.url}:${index}`)}`,
    label: formatSourceLabel(result.sourceType),
    retrievedAt: result.retrievedAt,
    snippet: result.snippet,
    sourceType: mapSearchSourceType(result.sourceType),
    title: result.title,
    url: result.url,
  }))
}

function buildTravelSearchPlan(
  item: ItineraryItem,
  trip: Trip,
  details?: ProviderProxyPlaceDetailsSuccessResponse['details'],
): ProviderProxyTravelSearchType[] {
  void item
  void trip
  const plan: ProviderProxyTravelSearchType[] = []
  if (!details?.regularOpeningHours?.weekdayDescriptions.length) {
    plan.push('opening_hours')
  }
  plan.push('ticket_price')
  if (plan.length < TRIP_CONTENT_ENRICHMENT_MAX_SEARCHES_PER_ITEM && !details?.websiteUri) {
    plan.push('official_site')
  }
  return plan.slice(0, TRIP_CONTENT_ENRICHMENT_MAX_SEARCHES_PER_ITEM)
}

function buildTravelSearchQuery(item: ItineraryItem, trip: Trip, searchType: ProviderProxyTravelSearchType) {
  const suffix = searchType === 'ticket_price'
    ? '门票 票价 官网'
    : searchType === 'opening_hours'
      ? '开放时间 官网'
      : '官方网站'
  return clampText(dedupeText([
    item.locationName,
    item.address,
    item.title,
    trip.destination,
    suffix,
  ]).join(' '), 300)
}

function selectBestPlaceLookupResult(response: ProviderProxyPlaceLookupSuccessResponse) {
  return [...response.results].sort((first, second) => {
    const firstScore = (first.location ? 20 : 0) + (first.googleMapsUri ? 10 : 0) + (first.formattedAddress ? 5 : 0)
    const secondScore = (second.location ? 20 : 0) + (second.googleMapsUri ? 10 : 0) + (second.formattedAddress ? 5 : 0)
    return secondScore - firstScore
  })[0]
}

function sortSourcesByPriority(sources: ContentEnrichmentSource[]) {
  return [...sources].sort((first, second) => sourcePriority(second) - sourcePriority(first))
}

function sourcePriority(source: ContentEnrichmentSource) {
  const typeScore: Record<ContentEnrichmentSourceType, number> = {
    ai_estimate: 0,
    google_places: 90,
    map: 70,
    official: 100,
    ticketing: 95,
    travel_site: 45,
    unknown: 10,
  }
  const confidenceScore: Record<ContentEnrichmentConfidence, number> = {
    high: 30,
    low: 5,
    medium: 15,
    unknown: 0,
  }
  return typeScore[source.sourceType] + confidenceScore[source.confidence] + (source.url ? 2 : 0)
}

function dedupeSources(sources: ContentEnrichmentSource[]) {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = source.url ?? source.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
}

function summarizeEnrichment(enrichment: ItemContentEnrichment) {
  const parts = [
    enrichment.introduction ? '介绍' : '',
    enrichment.openingHours ? '开放时间' : '',
    enrichment.ticketPrice ? '票价来源' : '',
    enrichment.notices.length ? '注意事项' : '',
    enrichment.recommendedStay ? '推荐停留时长' : '',
  ].filter(Boolean)
  return parts.length ? `将补充：${parts.join('、')}` : '将补充结构化景点信息'
}

function mapSearchSourceType(sourceType: ProviderProxyTravelSearchResult['sourceType']): ContentEnrichmentSourceType {
  if (sourceType === 'official') return 'official'
  if (sourceType === 'map') return 'map'
  if (sourceType === 'ticketing') return 'ticketing'
  if (sourceType === 'travel_site') return 'travel_site'
  return 'unknown'
}

function mapSearchConfidence(confidence: ProviderProxyTravelSearchResult['confidence']): ContentEnrichmentConfidence {
  if (confidence === 'high' || confidence === 'medium' || confidence === 'low') return confidence
  return 'unknown'
}

function formatSourceLabel(sourceType: ProviderProxyTravelSearchResult['sourceType']) {
  if (sourceType === 'official') return '官网'
  if (sourceType === 'map') return '地图来源'
  if (sourceType === 'ticketing') return '购票来源'
  if (sourceType === 'travel_site') return '旅行网站'
  return '网页来源'
}

function formatSearchType(searchType: ProviderProxyTravelSearchType) {
  if (searchType === 'opening_hours') return '开放时间'
  if (searchType === 'ticket_price') return '票价'
  if (searchType === 'official_site') return '官网'
  return '网页'
}

function getDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

function formatDisplayUrl(value: string) {
  try {
    const url = new URL(value)
    return `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return value
  }
}

function dedupeText(values: Array<string | undefined>) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value?.trim().replace(/\s+/g, ' ')
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function dedupeWarnings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function clampText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

function finiteNumberOrNull(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(6)) : null
}

function stableHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
