export type TransportMode = 'walk' | 'transit' | 'bus' | 'car' | 'train' | 'flight' | 'other'
export type TicketScope = 'trip' | 'item' | 'unassigned'
export type TicketStorageMode = 'copy' | 'reference' | 'external'
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
  sortOrder: number
}

export type ItineraryItem = {
  id: string
  tripId: string
  dayId: string
  title: string
  startTime?: string
  endTime?: string
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
