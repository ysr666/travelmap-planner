export type TransportMode = 'walk' | 'transit' | 'bus' | 'car' | 'train' | 'flight' | 'other'
export type TimeZoneSource = 'device' | 'provider' | 'manual' | 'imported'
export type TicketScope = 'trip' | 'item' | 'unassigned'
export type TicketStorageMode = 'copy' | 'reference' | 'external'
export type TicketCategory = 'admission_ticket' | 'train_ticket' | 'flight_ticket' | 'hotel_booking' | 'restaurant_reservation' | 'transport_booking' | 'other'
export type ContentEnrichmentSourceType = 'google_places' | 'official' | 'map' | 'ticketing' | 'travel_site' | 'ai_estimate' | 'unknown'
export type ContentEnrichmentConfidence = 'high' | 'medium' | 'low' | 'unknown'

export type ContentEnrichmentSource = {
  id: string
  label: string
  title: string
  sourceType: ContentEnrichmentSourceType
  confidence: ContentEnrichmentConfidence
  retrievedAt: string
  url?: string
  displayUrl?: string
  domain?: string
  snippet?: string
}

export type ContentEnrichmentFactSection = {
  text: string
  sourceIds: string[]
}

export type ContentEnrichmentStayRecommendation = {
  basis: 'ai_estimate' | 'source'
  durationMinutes: number
  reason: string
  sourceIds?: string[]
  text: string
}

export type ItemContentEnrichment = {
  schemaVersion: 1
  generatedAt: string
  baselineFingerprint: string
  matchedPlace?: {
    address?: string
    googleMapsUri?: string
    lat?: number
    lng?: number
    name: string
    placeId: string
    retrievedAt: string
    websiteUri?: string
  }
  introduction?: ContentEnrichmentFactSection
  openingHours?: ContentEnrichmentFactSection
  ticketPrice?: ContentEnrichmentFactSection & {
    kind: 'admission' | 'place_price_level' | 'unknown'
  }
  notices: ContentEnrichmentFactSection[]
  recommendedStay?: ContentEnrichmentStayRecommendation
  sources: ContentEnrichmentSource[]
  warnings: string[]
}

export type Trip = {
  id: string
  title: string
  destination: string
  startDate: string
  endDate: string
  timeZone?: string
  timeZoneSource?: TimeZoneSource
  notes?: string
  restoredAt?: number
  restoredFromCloudBackupId?: string
  restoredFromCloudExportedAt?: string
  restoredFromCloudOriginalTripId?: string
  createdAt: number
  updatedAt: number
}

export type Day = {
  id: string
  tripId: string
  date: string
  title: string
  timeZone?: string
  timeZoneSource?: TimeZoneSource
  sortOrder: number
}

export type ItineraryItem = {
  id: string
  tripId: string
  dayId: string
  title: string
  startTime?: string
  endTime?: string
  startTimeZone?: string
  endDate?: string
  endTimeZone?: string
  locationName?: string
  address?: string
  lat?: number
  lng?: number
  transportMode?: TransportMode
  previousTransportMode?: TransportMode
  previousTransportDurationMinutes?: number
  previousTransportNote?: string
  notes?: string
  contentEnrichment?: ItemContentEnrichment
  ticketIds: string[]
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export type TicketMeta = {
  id: string
  tripId: string
  itemId?: string
  scope?: TicketScope
  title?: string
  storageMode?: TicketStorageMode
  externalUrl?: string
  referenceLocation?: string
  ticketCategory?: TicketCategory
  fileName: string
  fileType: 'image' | 'pdf' | 'other'
  mimeType: string
  size: number
  note?: string
  createdAt: number
  updatedAt: number
}

export type TicketBlob = {
  ticketId: string
  blob: Blob
}

export type SyncObjectType = 'trip' | 'day' | 'item' | 'ticket_meta'
export type SyncOutboxOperation = 'upsert' | 'delete'
export type SyncOutboxStatus = 'pending' | 'syncing' | 'error'
export type SyncObjectPayload = Trip | Day | ItineraryItem | TicketMeta

export type SyncOutboxEntry = {
  id: string
  tripId: string
  objectType: SyncObjectType
  objectId: string
  objectKey: string
  operation: SyncOutboxOperation
  payload?: SyncObjectPayload
  updatedAtMs: number
  deletedAtMs?: number
  deviceId: string
  opId: string
  status: SyncOutboxStatus
  attempts: number
  lastError?: string
  createdAt: number
  updatedAt: number
}

export type ObjectSyncBase = {
  objectKey: string
  tripId: string
  objectType: SyncObjectType
  objectId: string
  payload?: SyncObjectPayload
  deletedAtMs?: number
  cloudUpdatedAtMs: number
  updatedAt: number
}

export type ObjectSyncConflictType =
  | 'field_conflict'
  | 'local_delete_remote_update'
  | 'remote_delete_local_update'

export type ObjectSyncConflictResolution = 'local' | 'remote' | 'merge_notes' | 'delete' | 'keep'

export type ObjectSyncConflictField = {
  fieldPath: string
  label: string
  baseValue?: unknown
  localValue?: unknown
  remoteValue?: unknown
  defaultResolution: Exclude<ObjectSyncConflictResolution, 'delete' | 'keep'>
  allowNotesMerge?: boolean
}

export type ObjectSyncConflict = {
  id: string
  tripId: string
  objectKey: string
  objectType: SyncObjectType
  objectId: string
  objectLabel: string
  conflictType: ObjectSyncConflictType
  basePayload?: SyncObjectPayload
  localPayload?: SyncObjectPayload
  remotePayload?: SyncObjectPayload
  localDeletedAtMs?: number
  remoteDeletedAtMs?: number
  fields: ObjectSyncConflictField[]
  status: 'pending' | 'resolved'
  createdAt: number
  updatedAt: number
}

export type ObjectSyncState = {
  objectKey: string
  tripId: string
  objectType: SyncObjectType
  objectId: string
  cloudUpdatedAtMs?: number
  cloudDeletedAtMs?: number
  localUpdatedAtMs?: number
  localDeletedAtMs?: number
  lastSyncedAt?: number
  conflictAt?: number
  conflictReason?: string
}

export type TicketBlobUploadStatus = 'pending' | 'uploading' | 'synced' | 'error' | 'missing' | 'deleted'
export type TicketBlobCacheStatus = 'cached' | 'cleared' | 'missing'

export type TicketBlobSyncState = {
  ticketId: string
  tripId: string
  uploadStatus: TicketBlobUploadStatus
  cacheStatus: TicketBlobCacheStatus
  sha256?: string
  cloudStoragePath?: string
  mimeType?: string
  size?: number
  fileName?: string
  lastUploadedAt?: number
  lastDownloadedAt?: number
  lastCacheCheckedAt?: number
  lastError?: string
  updatedAt: number
}

export type TravelInboxSourceKind = 'pasted_text' | 'text_file' | 'email' | 'html' | 'pdf' | 'image' | 'trip_plan' | 'ticket_file'
export type TravelInboxEntryStatus = 'ready' | 'recognizing' | 'previewed' | 'error'
export type TravelInboxEntryCategory = 'unclassified' | 'itinerary' | 'ticket' | 'note' | 'mixed'
export type TravelInboxPreviewStatus = 'ready' | 'applying' | 'applied' | 'discarded'

export type TravelInboxEntry = {
  id: string
  tripId: string
  status: TravelInboxEntryStatus
  sourceKind: TravelInboxSourceKind
  category: TravelInboxEntryCategory
  label?: string
  fileName?: string
  mimeType?: string
  size?: number
  extractedText: string
  warnings: string[]
  error?: string
  createdAt: number
  updatedAt: number
}

export type TravelInboxBlob = {
  entryId: string
  blob: Blob
}

export type TravelInboxPreviewRecord = {
  id: string
  tripId: string
  entryIds: string[]
  preview: unknown
  checkedDiffIds: string[]
  status: TravelInboxPreviewStatus
  createdAt: number
  updatedAt: number
}

export type TicketFile = TicketMeta & {
  blob: Blob
}

export type RouteId =
  | 'home'
  | 'trip'
  | 'day'
  | 'item'
  | 'tickets'
  | 'search'
  | 'settings'
  | 'settings/privacy'
  | 'settings/maps'
  | 'settings/route'
  | 'trip/new'
  | 'trip/edit'
  | 'item/new'
  | 'item/edit'
  | 'ai-draft'
