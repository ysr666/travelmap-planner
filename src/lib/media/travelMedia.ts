export const TRAVEL_MEDIA_SCHEMA_VERSION = 1 as const

export const TRAVEL_MEDIA_KINDS = [
  'place_photo',
  'hotel_photo',
  'restaurant_photo',
  'transport_photo',
  'document_preview',
] as const

export const TRAVEL_MEDIA_SUBJECT_TYPES = [
  'trip',
  'day',
  'item',
  'booking',
  'lodging',
  'ticket',
] as const

export type TravelMediaKind = typeof TRAVEL_MEDIA_KINDS[number]
export type TravelMediaSubjectType = typeof TRAVEL_MEDIA_SUBJECT_TYPES[number]
export type TravelMediaSource = 'fixture_registry' | 'google_places' | 'ticket_blob'

export type TravelMediaAttribution = {
  label: string
  uri?: string
}

export type TravelMediaRenderRef =
  | {
      type: 'provider_photo'
      provider: 'google_places'
      photoRef: string
    }
  | {
      type: 'fixture_asset'
      assetId: string
    }
  | {
      type: 'ticket_blob'
      ticketId: string
    }

export type TravelMediaAssetV1 = {
  schemaVersion: typeof TRAVEL_MEDIA_SCHEMA_VERSION
  id: string
  tripId?: string
  subjectType: TravelMediaSubjectType
  subjectId: string
  kind: TravelMediaKind
  source: TravelMediaSource
  providerRef: string
  attribution: TravelMediaAttribution[]
  rightsRef?: string
  sourceUri?: string
  observedAt: string
  expiresAt: string
  width: number
  height: number
  aspectRatio: number
  focalPoint?: {
    x: number
    y: number
  }
  renderRef: TravelMediaRenderRef
}

export type TravelMediaValidationResult =
  | { ok: true; value: TravelMediaAssetV1 }
  | { ok: false; error: string }

const MEDIA_FIELDS = new Set([
  'schemaVersion',
  'id',
  'tripId',
  'subjectType',
  'subjectId',
  'kind',
  'source',
  'providerRef',
  'attribution',
  'rightsRef',
  'sourceUri',
  'observedAt',
  'expiresAt',
  'width',
  'height',
  'aspectRatio',
  'focalPoint',
  'renderRef',
])
const ATTRIBUTION_FIELDS = new Set(['label', 'uri'])
const FOCAL_POINT_FIELDS = new Set(['x', 'y'])
const PROVIDER_RENDER_FIELDS = new Set(['type', 'provider', 'photoRef'])
const FIXTURE_RENDER_FIELDS = new Set(['type', 'assetId'])
const TICKET_RENDER_FIELDS = new Set(['type', 'ticketId'])
const MEDIA_KIND_SET = new Set<string>(TRAVEL_MEDIA_KINDS)
const SUBJECT_TYPE_SET = new Set<string>(TRAVEL_MEDIA_SUBJECT_TYPES)
const SOURCE_SET = new Set<TravelMediaSource>(['fixture_registry', 'google_places', 'ticket_blob'])
const GOOGLE_AUTHOR_HOSTS = new Set(['google.com', 'www.google.com', 'maps.google.com'])
const MAX_MEDIA_DIMENSION = 8_192
const MAX_MEDIA_PIXELS = 24_000_000
const MAX_ATTRIBUTIONS = 5
const CONTROLLED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const FIXTURE_ASSET_PATTERN = /^media_[a-z0-9_]{1,120}_v\d+$/
const GOOGLE_PLACE_PHOTO_REF_PATTERN = /^places\/[A-Za-z0-9_-]{3,220}\/photos\/[A-Za-z0-9_-]{8,1200}$/

export function validateTravelMediaAssetV1(input: unknown): TravelMediaValidationResult {
  const record = readRecord(input)
  if (!hasOnlyFields(record, MEDIA_FIELDS)) return invalid('媒体对象包含未知字段。')
  if (record.schemaVersion !== TRAVEL_MEDIA_SCHEMA_VERSION) return invalid('媒体 schemaVersion 无效。')

  const id = readControlledId(record.id)
  const tripId = record.tripId === undefined ? undefined : readControlledId(record.tripId)
  const subjectId = readControlledId(record.subjectId)
  const providerRef = readString(record.providerRef, 1_500)
  if (!id || (record.tripId !== undefined && !tripId) || !subjectId || !providerRef) {
    return invalid('媒体对象标识无效。')
  }
  if (typeof record.subjectType !== 'string' || !SUBJECT_TYPE_SET.has(record.subjectType)) {
    return invalid('媒体对象类型无效。')
  }
  if (typeof record.kind !== 'string' || !MEDIA_KIND_SET.has(record.kind)) {
    return invalid('媒体类别无效。')
  }
  if (typeof record.source !== 'string' || !SOURCE_SET.has(record.source as TravelMediaSource)) {
    return invalid('媒体来源无效。')
  }

  const observedAt = readIsoDate(record.observedAt)
  const expiresAt = readIsoDate(record.expiresAt)
  if (!observedAt || !expiresAt || Date.parse(expiresAt) <= Date.parse(observedAt)) {
    return invalid('媒体观察时间或有效期无效。')
  }

  const width = readDimension(record.width)
  const height = readDimension(record.height)
  const aspectRatio = readPositiveNumber(record.aspectRatio)
  if (!width || !height || width * height > MAX_MEDIA_PIXELS || !aspectRatio) {
    return invalid('媒体尺寸无效。')
  }
  if (Math.abs(width / height - aspectRatio) > 0.01) {
    return invalid('媒体宽高比与尺寸不一致。')
  }

  const attribution = readAttribution(record.attribution, record.source as TravelMediaSource)
  if (!attribution) return invalid('媒体署名无效。')
  const rightsRef = readOptionalHttpsUrl(record.rightsRef)
  const sourceUri = readOptionalHttpsUrl(record.sourceUri)
  if (record.rightsRef !== undefined && !rightsRef) return invalid('媒体权利链接无效。')
  if (record.sourceUri !== undefined && !sourceUri) return invalid('媒体来源链接无效。')

  const focalPoint = readFocalPoint(record.focalPoint)
  if (record.focalPoint !== undefined && !focalPoint) return invalid('媒体焦点无效。')
  const renderRef = readRenderRef(record.renderRef, record.source as TravelMediaSource, providerRef)
  if (!renderRef) return invalid('媒体渲染引用无效。')

  return {
    ok: true,
    value: {
      aspectRatio,
      attribution,
      expiresAt,
      focalPoint: focalPoint ?? undefined,
      height,
      id,
      kind: record.kind as TravelMediaKind,
      observedAt,
      providerRef,
      renderRef,
      rightsRef,
      schemaVersion: TRAVEL_MEDIA_SCHEMA_VERSION,
      source: record.source as TravelMediaSource,
      sourceUri,
      subjectId,
      subjectType: record.subjectType as TravelMediaSubjectType,
      tripId,
      width,
    },
  }
}

export function isTravelMediaAssetCurrent(asset: TravelMediaAssetV1, now: Date | number | string = Date.now()) {
  const nowMs = typeof now === 'number' ? now : now instanceof Date ? now.getTime() : Date.parse(now)
  return Number.isFinite(nowMs)
    && Date.parse(asset.observedAt) <= nowMs
    && Date.parse(asset.expiresAt) > nowMs
}

export function selectTravelMediaAsset(
  assets: TravelMediaAssetV1[],
  input: {
    subjectType: TravelMediaSubjectType
    subjectId: string
    kinds?: TravelMediaKind[]
    now?: Date | number | string
    minimumWidth?: number
  },
) {
  const kinds = input.kinds ? new Set<TravelMediaKind>(input.kinds) : null
  return assets
    .filter((asset) => asset.subjectType === input.subjectType && asset.subjectId === input.subjectId)
    .filter((asset) => !kinds || kinds.has(asset.kind))
    .filter((asset) => isTravelMediaAssetCurrent(asset, input.now))
    .sort((left, right) => {
      const leftMeetsWidth = left.width >= (input.minimumWidth ?? 0) ? 1 : 0
      const rightMeetsWidth = right.width >= (input.minimumWidth ?? 0) ? 1 : 0
      if (leftMeetsWidth !== rightMeetsWidth) return rightMeetsWidth - leftMeetsWidth
      return right.width - left.width
    })[0]
}

export function isGooglePlacesPhotoRef(value: unknown): value is string {
  return typeof value === 'string' && GOOGLE_PLACE_PHOTO_REF_PATTERN.test(value)
}

function readRenderRef(
  input: unknown,
  source: TravelMediaSource,
  providerRef: string,
): TravelMediaRenderRef | null {
  const record = readRecord(input)
  if (record.type === 'provider_photo') {
    if (!hasOnlyFields(record, PROVIDER_RENDER_FIELDS)) return null
    if (source !== 'google_places' || record.provider !== 'google_places') return null
    if (!isGooglePlacesPhotoRef(record.photoRef) || record.photoRef !== providerRef) return null
    return { photoRef: record.photoRef, provider: 'google_places', type: 'provider_photo' }
  }
  if (record.type === 'fixture_asset') {
    if (!hasOnlyFields(record, FIXTURE_RENDER_FIELDS)) return null
    if (source !== 'fixture_registry' || typeof record.assetId !== 'string' || !FIXTURE_ASSET_PATTERN.test(record.assetId)) return null
    if (record.assetId !== providerRef) return null
    return { assetId: record.assetId, type: 'fixture_asset' }
  }
  if (record.type === 'ticket_blob') {
    if (!hasOnlyFields(record, TICKET_RENDER_FIELDS)) return null
    const ticketId = readControlledId(record.ticketId)
    if (source !== 'ticket_blob' || !ticketId || ticketId !== providerRef) return null
    return { ticketId, type: 'ticket_blob' }
  }
  return null
}

function readAttribution(input: unknown, source: TravelMediaSource): TravelMediaAttribution[] | null {
  if (!Array.isArray(input) || input.length > MAX_ATTRIBUTIONS) return null
  if (source === 'google_places' && input.length === 0) return null
  const values: TravelMediaAttribution[] = []
  for (const raw of input) {
    const record = readRecord(raw)
    if (!hasOnlyFields(record, ATTRIBUTION_FIELDS)) return null
    const label = readString(record.label, 120)
    if (!label) return null
    const uri = readOptionalHttpsUrl(record.uri)
    if (record.uri !== undefined && !uri) return null
    if (source === 'google_places' && uri && !isGoogleAuthorUri(uri)) return null
    values.push({ label, uri })
  }
  return values
}

function readFocalPoint(input: unknown): TravelMediaAssetV1['focalPoint'] | null | undefined {
  if (input === undefined) return undefined
  const record = readRecord(input)
  if (!hasOnlyFields(record, FOCAL_POINT_FIELDS)) return null
  const x = Number(record.x)
  const y = Number(record.y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}

function isGoogleAuthorUri(uri: string) {
  const hostname = new URL(uri).hostname.toLowerCase()
  return GOOGLE_AUTHOR_HOSTS.has(hostname) || hostname.endsWith('.google.com')
}

function readControlledId(input: unknown) {
  return typeof input === 'string' && CONTROLLED_ID_PATTERN.test(input) ? input : ''
}

function readDimension(input: unknown) {
  return typeof input === 'number' && Number.isInteger(input) && input > 0 && input <= MAX_MEDIA_DIMENSION
    ? input
    : 0
}

function readPositiveNumber(input: unknown) {
  return typeof input === 'number' && Number.isFinite(input) && input > 0 ? input : 0
}

function readIsoDate(input: unknown) {
  if (typeof input !== 'string' || !input.trim() || !Number.isFinite(Date.parse(input))) return ''
  return new Date(input).toISOString()
}

function readString(input: unknown, maxLength: number) {
  if (typeof input !== 'string') return ''
  const value = input.trim()
  return value && value.length <= maxLength ? value : ''
}

function readOptionalHttpsUrl(input: unknown) {
  if (input === undefined) return undefined
  if (typeof input !== 'string' || input.length > 2_048) return undefined
  try {
    const url = new URL(input)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function hasOnlyFields(record: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(record).every((field) => allowed.has(field))
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function invalid(error: string): TravelMediaValidationResult {
  return { error, ok: false }
}
