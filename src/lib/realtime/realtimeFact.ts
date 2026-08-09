import { isValidPlainDate } from '../plainDate'
import type { TicketReadinessStatus, TransportMode, TransportSegmentStatus } from '../../types'

export const REALTIME_FACT_SCHEMA_VERSION = 1 as const

export const REALTIME_FACT_KINDS = [
  'weather_current',
  'weather_forecast',
  'place_opening_status',
  'route_eta',
  'transport_status',
  'ticket_status',
] as const

export const REALTIME_FACT_SUBJECT_TYPES = [
  'trip',
  'day',
  'item',
  'booking',
  'transport_segment',
  'ticket',
] as const

export type RealtimeFactKind = typeof REALTIME_FACT_KINDS[number]
export type RealtimeFactSubjectType = typeof REALTIME_FACT_SUBJECT_TYPES[number]
export type RealtimeFactConfidence = 'high' | 'medium' | 'low'
export type RealtimeFactFreshness = 'current' | 'stale' | 'future'
export type WeatherCondition =
  | 'clear'
  | 'mainly_clear'
  | 'partly_cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'showers'
  | 'snow'
  | 'thunderstorm'
  | 'unknown'

export type RealtimeFactSource = {
  provider:
    | 'fixture_weather'
    | 'fixture_places'
    | 'fixture_routes'
    | 'open_meteo'
    | 'google_places'
    | 'google_routes'
    | 'openrouteservice'
    | 'mock_weather'
    | 'mock_place'
    | 'mock_route'
    | 'mock_transport'
    | 'local_ticket'
  label: string
  url?: string
}

export type WeatherCurrentValue = {
  locationName: string
  temperatureCelsius: number
  apparentTemperatureCelsius?: number
  condition: WeatherCondition
  precipitationProbability?: number
  windKph?: number
}

export type WeatherForecastValue = {
  date: string
  locationName: string
  minCelsius: number
  maxCelsius: number
  condition: WeatherCondition
  precipitationProbability?: number
  shortAdvice?: string
}

export type PlaceOpeningStatusValue = {
  status: 'open' | 'closed' | 'temporarily_closed' | 'unknown'
  opensAt?: string
  closesAt?: string
}

export type RouteEtaValue = {
  mode: TransportMode
  durationMinutes: number
  distanceMeters?: number
  status: 'road' | 'mixed' | 'straight' | 'unavailable'
  trafficDelayMinutes?: number
}

export type TransportStatusValue = {
  mode: 'flight' | 'rail'
  status: TransportSegmentStatus
  departureTime?: string
  arrivalTime?: string
  terminal?: string
  gate?: string
  platform?: string
  delayMinutes?: number
}

export type TicketStatusValue = {
  status: TicketReadinessStatus
  serviceDate?: string
  entryTime?: string
}

type RealtimeFactBase<K extends RealtimeFactKind, V> = {
  schemaVersion: typeof REALTIME_FACT_SCHEMA_VERSION
  id: string
  tripId: string
  kind: K
  subject: {
    type: RealtimeFactSubjectType
    id: string
  }
  value: V
  source: RealtimeFactSource
  observedAt: string
  expiresAt: string
  confidence: RealtimeFactConfidence
  rawRef: string
}

export type RealtimeFactV1 =
  | RealtimeFactBase<'weather_current', WeatherCurrentValue>
  | RealtimeFactBase<'weather_forecast', WeatherForecastValue>
  | RealtimeFactBase<'place_opening_status', PlaceOpeningStatusValue>
  | RealtimeFactBase<'route_eta', RouteEtaValue>
  | RealtimeFactBase<'transport_status', TransportStatusValue>
  | RealtimeFactBase<'ticket_status', TicketStatusValue>

export type RealtimeFactValidationResult =
  | { ok: true; value: RealtimeFactV1 }
  | { ok: false; error: string }

const FACT_FIELDS = new Set([
  'schemaVersion',
  'id',
  'tripId',
  'kind',
  'subject',
  'value',
  'source',
  'observedAt',
  'expiresAt',
  'confidence',
  'rawRef',
])
const SUBJECT_FIELDS = new Set(['type', 'id'])
const SOURCE_FIELDS = new Set(['provider', 'label', 'url'])
const WEATHER_CURRENT_FIELDS = new Set([
  'locationName',
  'temperatureCelsius',
  'apparentTemperatureCelsius',
  'condition',
  'precipitationProbability',
  'windKph',
])
const WEATHER_FORECAST_FIELDS = new Set([
  'date',
  'locationName',
  'minCelsius',
  'maxCelsius',
  'condition',
  'precipitationProbability',
  'shortAdvice',
])
const PLACE_OPENING_FIELDS = new Set(['status', 'opensAt', 'closesAt'])
const ROUTE_ETA_FIELDS = new Set(['mode', 'durationMinutes', 'distanceMeters', 'status', 'trafficDelayMinutes'])
const TRANSPORT_STATUS_FIELDS = new Set([
  'mode',
  'status',
  'departureTime',
  'arrivalTime',
  'terminal',
  'gate',
  'platform',
  'delayMinutes',
])
const TICKET_STATUS_FIELDS = new Set(['status', 'serviceDate', 'entryTime'])
const FACT_KIND_SET = new Set<string>(REALTIME_FACT_KINDS)
const SUBJECT_TYPE_SET = new Set<string>(REALTIME_FACT_SUBJECT_TYPES)
const CONFIDENCE_SET = new Set<RealtimeFactConfidence>(['high', 'medium', 'low'])
const WEATHER_CONDITION_SET = new Set<WeatherCondition>([
  'clear',
  'mainly_clear',
  'partly_cloudy',
  'overcast',
  'fog',
  'drizzle',
  'rain',
  'showers',
  'snow',
  'thunderstorm',
  'unknown',
])
const SOURCE_PROVIDERS = new Set<RealtimeFactSource['provider']>([
  'fixture_weather',
  'fixture_places',
  'fixture_routes',
  'open_meteo',
  'google_places',
  'google_routes',
  'openrouteservice',
  'mock_weather',
  'mock_place',
  'mock_route',
  'mock_transport',
  'local_ticket',
])
const TRANSPORT_MODES = new Set<TransportMode>(['walk', 'transit', 'bus', 'car', 'train', 'flight', 'other'])
const TRANSPORT_STATUSES = new Set<TransportSegmentStatus>(['scheduled', 'delayed', 'cancelled', 'departed', 'arrived', 'unknown'])
const TICKET_STATUSES = new Set<TicketReadinessStatus>(['ready', 'needs_review', 'expired', 'unavailable'])
const CONTROLLED_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const OPAQUE_REF = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,239}$/
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const MAX_TTL_MS: Record<RealtimeFactKind, number> = {
  place_opening_status: 2 * 60 * 60_000,
  route_eta: 15 * 60_000,
  ticket_status: 24 * 60 * 60_000,
  transport_status: 15 * 60_000,
  weather_current: 90 * 60_000,
  weather_forecast: 6 * 60 * 60_000,
}

export function validateRealtimeFactV1(input: unknown): RealtimeFactValidationResult {
  const record = readRecord(input)
  if (!hasOnlyFields(record, FACT_FIELDS)) return invalid('实时事实包含未知字段。')
  if (record.schemaVersion !== REALTIME_FACT_SCHEMA_VERSION) return invalid('实时事实 schemaVersion 无效。')

  const id = readControlledId(record.id)
  const tripId = readControlledId(record.tripId)
  const kind = typeof record.kind === 'string' && FACT_KIND_SET.has(record.kind)
    ? record.kind as RealtimeFactKind
    : null
  const subject = readSubject(record.subject)
  const source = readSource(record.source)
  const observedAt = readIsoDate(record.observedAt)
  const expiresAt = readIsoDate(record.expiresAt)
  const confidence = typeof record.confidence === 'string' && CONFIDENCE_SET.has(record.confidence as RealtimeFactConfidence)
    ? record.confidence as RealtimeFactConfidence
    : null
  const rawRef = readOpaqueRef(record.rawRef)
  if (!id || !tripId || !kind || !subject || !source || !observedAt || !expiresAt || !confidence || !rawRef) {
    return invalid('实时事实标识、来源或时间无效。')
  }
  const observedMs = Date.parse(observedAt)
  const expiresMs = Date.parse(expiresAt)
  if (expiresMs <= observedMs || expiresMs - observedMs > MAX_TTL_MS[kind]) {
    return invalid('实时事实有效期无效。')
  }

  const value = readValue(kind, record.value)
  if (!value) return invalid('实时事实值无效。')
  return {
    ok: true,
    value: {
      confidence,
      expiresAt,
      id,
      kind,
      observedAt,
      rawRef,
      schemaVersion: REALTIME_FACT_SCHEMA_VERSION,
      source,
      subject,
      tripId,
      value,
    } as RealtimeFactV1,
  }
}

export function getRealtimeFactFreshness(
  fact: RealtimeFactV1,
  now: Date | number | string = Date.now(),
): RealtimeFactFreshness {
  const nowMs = toTimestamp(now)
  if (!Number.isFinite(nowMs) || Date.parse(fact.observedAt) > nowMs + 5 * 60_000) return 'future'
  return Date.parse(fact.expiresAt) > nowMs ? 'current' : 'stale'
}

export function isRealtimeFactCurrent(fact: RealtimeFactV1, now?: Date | number | string) {
  return getRealtimeFactFreshness(fact, now) === 'current'
}

export function selectRealtimeFact(
  facts: RealtimeFactV1[],
  input: {
    kind: RealtimeFactKind
    subjectId: string
    subjectType?: RealtimeFactSubjectType
    now?: Date | number | string
  },
): { fact?: RealtimeFactV1; state: 'current' | 'stale' | 'unavailable' } {
  const matching = facts
    .filter((fact) => fact.kind === input.kind && fact.subject.id === input.subjectId)
    .filter((fact) => !input.subjectType || fact.subject.type === input.subjectType)
    .filter((fact) => getRealtimeFactFreshness(fact, input.now) !== 'future')
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))
  const current = matching.find((fact) => isRealtimeFactCurrent(fact, input.now))
  if (current) return { fact: current, state: 'current' }
  return matching[0] ? { fact: matching[0], state: 'stale' } : { state: 'unavailable' }
}

function readValue(kind: RealtimeFactKind, input: unknown): RealtimeFactV1['value'] | null {
  if (kind === 'weather_current') return readWeatherCurrent(input)
  if (kind === 'weather_forecast') return readWeatherForecast(input)
  if (kind === 'place_opening_status') return readPlaceOpening(input)
  if (kind === 'route_eta') return readRouteEta(input)
  if (kind === 'transport_status') return readTransportStatus(input)
  return readTicketStatus(input)
}

function readWeatherCurrent(input: unknown): WeatherCurrentValue | null {
  const record = readRecord(input)
  if (!hasOnlyFields(record, WEATHER_CURRENT_FIELDS)) return null
  const locationName = readText(record.locationName, 160)
  const temperatureCelsius = readNumber(record.temperatureCelsius, -100, 70)
  const apparentTemperatureCelsius = readOptionalNumber(record.apparentTemperatureCelsius, -120, 80)
  const condition = readWeatherCondition(record.condition)
  const precipitationProbability = readOptionalNumber(record.precipitationProbability, 0, 100)
  const windKph = readOptionalNumber(record.windKph, 0, 500)
  if (!locationName || temperatureCelsius === null || !condition || hasInvalidOptionalNumbers(record, {
    apparentTemperatureCelsius,
    precipitationProbability,
    windKph,
  })) return null
  return { apparentTemperatureCelsius, condition, locationName, precipitationProbability, temperatureCelsius, windKph }
}

function readWeatherForecast(input: unknown): WeatherForecastValue | null {
  const record = readRecord(input)
  if (!hasOnlyFields(record, WEATHER_FORECAST_FIELDS)) return null
  const date = readPlainDate(record.date)
  const locationName = readText(record.locationName, 160)
  const minCelsius = readNumber(record.minCelsius, -100, 70)
  const maxCelsius = readNumber(record.maxCelsius, -100, 70)
  const condition = readWeatherCondition(record.condition)
  const precipitationProbability = readOptionalNumber(record.precipitationProbability, 0, 100)
  const shortAdvice = readOptionalText(record.shortAdvice, 80)
  if (
    !date || !locationName || minCelsius === null || maxCelsius === null || maxCelsius < minCelsius || !condition
    || hasInvalidOptionalNumbers(record, { precipitationProbability })
    || (record.shortAdvice !== undefined && !shortAdvice)
  ) return null
  return { condition, date, locationName, maxCelsius, minCelsius, precipitationProbability, shortAdvice }
}

function readPlaceOpening(input: unknown): PlaceOpeningStatusValue | null {
  const record = readRecord(input)
  if (!hasOnlyFields(record, PLACE_OPENING_FIELDS)) return null
  const status = isOneOf(record.status, ['open', 'closed', 'temporarily_closed', 'unknown'] as const)
  const opensAt = readOptionalTime(record.opensAt)
  const closesAt = readOptionalTime(record.closesAt)
  if (!status || (record.opensAt !== undefined && !opensAt) || (record.closesAt !== undefined && !closesAt)) return null
  return { closesAt, opensAt, status }
}

function readRouteEta(input: unknown): RouteEtaValue | null {
  const record = readRecord(input)
  if (!hasOnlyFields(record, ROUTE_ETA_FIELDS)) return null
  const mode = typeof record.mode === 'string' && TRANSPORT_MODES.has(record.mode as TransportMode) ? record.mode as TransportMode : null
  const durationMinutes = readInteger(record.durationMinutes, 0, 24 * 60)
  const distanceMeters = readOptionalInteger(record.distanceMeters, 0, 5_000_000)
  const trafficDelayMinutes = readOptionalInteger(record.trafficDelayMinutes, 0, 24 * 60)
  const status = isOneOf(record.status, ['road', 'mixed', 'straight', 'unavailable'] as const)
  if (!mode || durationMinutes === null || !status || hasInvalidOptionalNumbers(record, { distanceMeters, trafficDelayMinutes })) return null
  return { distanceMeters, durationMinutes, mode, status, trafficDelayMinutes }
}

function readTransportStatus(input: unknown): TransportStatusValue | null {
  const record = readRecord(input)
  if (!hasOnlyFields(record, TRANSPORT_STATUS_FIELDS)) return null
  const mode = isOneOf(record.mode, ['flight', 'rail'] as const)
  const status = typeof record.status === 'string' && TRANSPORT_STATUSES.has(record.status as TransportSegmentStatus)
    ? record.status as TransportSegmentStatus
    : null
  const departureTime = readOptionalTime(record.departureTime)
  const arrivalTime = readOptionalTime(record.arrivalTime)
  const terminal = readOptionalText(record.terminal, 24)
  const gate = readOptionalText(record.gate, 24)
  const platform = readOptionalText(record.platform, 24)
  const delayMinutes = readOptionalInteger(record.delayMinutes, 0, 24 * 60)
  if (
    !mode || !status || hasInvalidOptionalNumbers(record, { delayMinutes })
    || (record.departureTime !== undefined && !departureTime)
    || (record.arrivalTime !== undefined && !arrivalTime)
    || (record.terminal !== undefined && !terminal)
    || (record.gate !== undefined && !gate)
    || (record.platform !== undefined && !platform)
  ) return null
  return { arrivalTime, delayMinutes, departureTime, gate, mode, platform, status, terminal }
}

function readTicketStatus(input: unknown): TicketStatusValue | null {
  const record = readRecord(input)
  if (!hasOnlyFields(record, TICKET_STATUS_FIELDS)) return null
  const status = typeof record.status === 'string' && TICKET_STATUSES.has(record.status as TicketReadinessStatus)
    ? record.status as TicketReadinessStatus
    : null
  const serviceDate = readOptionalPlainDate(record.serviceDate)
  const entryTime = readOptionalTime(record.entryTime)
  if (!status || (record.serviceDate !== undefined && !serviceDate) || (record.entryTime !== undefined && !entryTime)) return null
  return { entryTime, serviceDate, status }
}

function readSubject(input: unknown): RealtimeFactV1['subject'] | null {
  const record = readRecord(input)
  if (!hasOnlyFields(record, SUBJECT_FIELDS)) return null
  const id = readControlledId(record.id)
  const type = typeof record.type === 'string' && SUBJECT_TYPE_SET.has(record.type)
    ? record.type as RealtimeFactSubjectType
    : null
  return id && type ? { id, type } : null
}

function readSource(input: unknown): RealtimeFactSource | null {
  const record = readRecord(input)
  if (!hasOnlyFields(record, SOURCE_FIELDS)) return null
  const provider = typeof record.provider === 'string' && SOURCE_PROVIDERS.has(record.provider as RealtimeFactSource['provider'])
    ? record.provider as RealtimeFactSource['provider']
    : null
  const label = readText(record.label, 80)
  const url = readSourceUrl(record.url, provider)
  if (!provider || !label || (record.url !== undefined && !url)) return null
  return { label, provider, url: url ?? undefined }
}

function readSourceUrl(input: unknown, provider: RealtimeFactSource['provider'] | null) {
  if (input === undefined) return undefined
  if (typeof input !== 'string' || !provider) return null
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (provider === 'open_meteo' && (host === 'open-meteo.com' || host.endsWith('.open-meteo.com'))) return url.toString()
    if ((provider === 'google_places' || provider === 'google_routes') && (host === 'google.com' || host.endsWith('.google.com'))) return url.toString()
    if (provider === 'openrouteservice' && (host === 'openrouteservice.org' || host.endsWith('.openrouteservice.org'))) return url.toString()
    return null
  } catch {
    return null
  }
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
}

function hasOnlyFields(record: Record<string, unknown>, fields: Set<string>) {
  return Object.keys(record).every((key) => fields.has(key))
}

function readControlledId(input: unknown) {
  return typeof input === 'string' && CONTROLLED_ID.test(input) ? input : ''
}

function readOpaqueRef(input: unknown) {
  return typeof input === 'string'
    && OPAQUE_REF.test(input)
    && !input.includes('://')
    && !/(?:authorization|bearer|token|secret|api[_-]?key)/i.test(input)
    ? input
    : ''
}

function readIsoDate(input: unknown) {
  if (typeof input !== 'string') return null
  const timestamp = Date.parse(input)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function readPlainDate(input: unknown) {
  return typeof input === 'string' && isValidPlainDate(input) ? input : null
}

function readOptionalPlainDate(input: unknown) {
  return input === undefined ? undefined : readPlainDate(input) ?? undefined
}

function readText(input: unknown, maxLength: number) {
  if (typeof input !== 'string') return ''
  const value = input.trim()
  return value && value.length <= maxLength ? value : ''
}

function readOptionalText(input: unknown, maxLength: number) {
  return input === undefined ? undefined : readText(input, maxLength) || undefined
}

function readOptionalTime(input: unknown) {
  return input === undefined ? undefined : typeof input === 'string' && TIME.test(input) ? input : undefined
}

function readWeatherCondition(input: unknown) {
  return typeof input === 'string' && WEATHER_CONDITION_SET.has(input as WeatherCondition)
    ? input as WeatherCondition
    : null
}

function readNumber(input: unknown, minimum: number, maximum: number) {
  return typeof input === 'number' && Number.isFinite(input) && input >= minimum && input <= maximum ? input : null
}

function readOptionalNumber(input: unknown, minimum: number, maximum: number) {
  return input === undefined ? undefined : readNumber(input, minimum, maximum) ?? undefined
}

function readInteger(input: unknown, minimum: number, maximum: number) {
  return typeof input === 'number' && Number.isInteger(input) && input >= minimum && input <= maximum ? input : null
}

function readOptionalInteger(input: unknown, minimum: number, maximum: number) {
  return input === undefined ? undefined : readInteger(input, minimum, maximum) ?? undefined
}

function hasInvalidOptionalNumbers(
  record: Record<string, unknown>,
  values: Record<string, number | undefined>,
) {
  return Object.entries(values).some(([key, value]) => record[key] !== undefined && value === undefined)
}

function isOneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  return typeof value === 'string' && values.includes(value) ? value as T[number] : null
}

function toTimestamp(value: Date | number | string) {
  return typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value)
}

function invalid(error: string): RealtimeFactValidationResult {
  return { error, ok: false }
}
