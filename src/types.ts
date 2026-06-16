export type TransportMode = 'walk' | 'transit' | 'bus' | 'car' | 'train' | 'flight' | 'other'
export type TimeZoneSource = 'device' | 'provider' | 'manual' | 'imported'
export type TicketScope = 'trip' | 'item' | 'unassigned'
export type TicketStorageMode = 'copy' | 'reference' | 'external'
export type TicketCategory = 'admission_ticket' | 'train_ticket' | 'flight_ticket' | 'hotel_booking' | 'restaurant_reservation' | 'transport_booking' | 'other'
export type ContentEnrichmentSourceType = 'google_places' | 'official' | 'map' | 'ticketing' | 'travel_site' | 'ai_estimate' | 'unknown'
export type ContentEnrichmentConfidence = 'high' | 'medium' | 'low' | 'unknown'
export type ItineraryExecutionStatus = 'completed' | 'skipped'

export type ItineraryExecutionState = {
  status: ItineraryExecutionStatus
  updatedAt: number
}

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
  executionState?: ItineraryExecutionState
  ticketIds: string[]
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export type TicketMeta = {
  id: string
  tripId: string
  itemId?: string
  bookingId?: string
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

export type LedgerExpenseCategory =
  | 'lodging'
  | 'transport'
  | 'admission'
  | 'food'
  | 'shopping'
  | 'insurance'
  | 'connectivity'
  | 'other'

export type LedgerExpenseStatus = 'draft' | 'confirmed' | 'void'
export type LedgerSplitMode = 'equal' | 'exclude' | 'weights'
export type LedgerBudgetScope = 'trip' | 'category' | 'date'
export type LedgerSourceKind = 'manual' | 'ticket' | 'inbox' | 'transport_booking' | 'itinerary_note'
export type LedgerSourceRole =
  | 'order_confirmation'
  | 'payment_receipt'
  | 'invoice'
  | 'credit_card_notice'
  | 'cancellation_notice'
  | 'refund_notice'
  | 'other'
export type LedgerLineItemKind = 'base' | 'tax' | 'tip' | 'discount' | 'refund' | 'other'
export type LedgerPaymentStatus = 'unknown' | 'unpaid' | 'paid' | 'partially_refunded' | 'refunded'
export type LedgerOrderStatus = 'active' | 'cancelled'
export type LedgerReviewStatus = 'unreviewed' | 'auto_confirmed' | 'reviewed' | 'needs_review'

export type LedgerSettings = {
  id: string
  tripId: string
  homeCurrency: string
  tripCurrency: string
  settlementCurrency: string
  createdAt: number
  updatedAt: number
}

export type LedgerParticipant = {
  id: string
  tripId: string
  displayName: string
  isSelf?: boolean
  source?: 'manual' | 'shared_trip' | 'traveler_profile'
  sourceId?: string
  createdAt: number
  updatedAt: number
}

export type LedgerBudget = {
  id: string
  tripId: string
  scope: LedgerBudgetScope
  amountMinor: number
  currency: string
  category?: LedgerExpenseCategory
  date?: string
  createdAt: number
  updatedAt: number
}

export type LedgerExpenseSplitShare = {
  participantId: string
  weight: number
}

export type LedgerExpenseSource = {
  kind: LedgerSourceKind
  sourceId?: string
  label?: string
  fingerprint?: string
}

export type LedgerExpenseSourceLink = LedgerExpenseSource & {
  id: string
  role: LedgerSourceRole
  title?: string
  capturedAt?: string
  available?: boolean
}

export type LedgerExpenseLineItem = {
  id: string
  title: string
  kind: LedgerLineItemKind
  category: LedgerExpenseCategory
  amountMinor: number
  currency: string
}

export type LedgerExchangeRateSnapshot = {
  requestedDate: string
  effectiveDate: string
  baseCurrency: string
  tripCurrency: string
  homeCurrency: string
  rateToTrip: string
  rateToHome: string
  provider: 'frankfurter' | 'manual'
  sourceUrl?: string
  fetchedAt: string
}

export type LedgerExpense = {
  id: string
  tripId: string
  title: string
  date: string
  category: LedgerExpenseCategory
  status: LedgerExpenseStatus
  amountMinor?: number
  currency?: string
  payerParticipantId?: string
  splitMode: LedgerSplitMode
  splitShares: LedgerExpenseSplitShare[]
  source: LedgerExpenseSource
  sourceLinks?: LedgerExpenseSourceLink[]
  lineItems?: LedgerExpenseLineItem[]
  merchant?: string
  city?: string
  orderNumber?: string
  itemIds?: string[]
  bookedAt?: string
  paidAt?: string
  serviceStartAt?: string
  serviceEndAt?: string
  cancelledAt?: string
  refundedAt?: string
  paymentStatus?: LedgerPaymentStatus
  orderStatus?: LedgerOrderStatus
  reviewStatus?: LedgerReviewStatus
  recognitionConfidence?: number
  autoConfirmReason?: string
  originalExpenseId?: string
  exchangeRate?: LedgerExchangeRateSnapshot
  duplicateAcknowledged?: boolean
  notes?: string
  createdAt: number
  updatedAt: number
}

export type LedgerArchiveQueueEntry = {
  id: string
  tripId: string
  sourceKey: string
  fingerprint: string
  status: 'pending' | 'processing' | 'done' | 'error'
  attempts: number
  nextAttemptAt?: number
  lastError?: string
  createdAt: number
  updatedAt: number
}

export type AccountAiPreferences = {
  autoExpenseAiEnabled: boolean
  consentedAt?: string
  privacyVersion: number
}

export type ExchangeRateCache = {
  id: string
  requestedDate: string
  effectiveDate: string
  baseCurrency: string
  quoteCurrency: string
  rate: string
  provider: 'frankfurter'
  sourceUrl: string
  fetchedAt: string
  updatedAt: number
}

export type CompanionPermission = 'read' | 'comment' | 'collaborate'
export type CompanionInviteStatus = 'active' | 'revoked' | 'expired'
export type CompanionActivityType =
  | 'viewed'
  | 'joined'
  | 'commented'
  | 'confirmed_meeting'
  | 'submitted_change'
  | 'applied_change'
  | 'rejected_change'
  | 'published'

export type SharedTicketSummary = {
  id: string
  itemId?: string
  scope?: TicketScope
  ticketCategory?: TicketCategory
  title: string
  fileType: TicketMeta['fileType']
  storageMode: TicketStorageMode
}

export type SharedItineraryItem = Omit<ItineraryItem, 'contentEnrichment' | 'ticketIds'> & {
  ticketSummaryIds: string[]
}

export type SharedTripProjection = {
  schemaVersion: 1
  publishedAt: string
  trip: Trip
  days: Day[]
  items: SharedItineraryItem[]
  ticketSummaries: SharedTicketSummary[]
  warnings: string[]
}

export type SharedTrip = {
  id: string
  ownerId: string
  tripId: string
  title: string
  projection: SharedTripProjection
  projectionUpdatedAt: string
  createdAt: string
  updatedAt: string
}

export type SharedTripInvite = {
  id: string
  ownerId: string
  sharedTripId: string
  tokenHash: string
  permission: CompanionPermission
  status: CompanionInviteStatus
  expiresAt?: string
  createdAt: string
  updatedAt: string
  revokedAt?: string
}

export type SharedTripMember = {
  ownerId: string
  sharedTripId: string
  userId: string
  displayName?: string
  email?: string
  permission: CompanionPermission
  joinedAt: string
  updatedAt: string
  removedAt?: string
}

export type SharedTripComment = {
  id: string
  sharedTripId: string
  itemId: string
  userId: string
  displayName?: string
  body: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export type SharedTripMeetingConfirmation = {
  sharedTripId: string
  itemId: string
  userId: string
  displayName?: string
  note?: string
  confirmedAt: string
  updatedAt: string
}

export type SharedTripActivity = {
  id: string
  sharedTripId: string
  userId?: string
  displayName?: string
  activityType: CompanionActivityType
  itemId?: string
  body?: string
  createdAt: string
}

export type SharedTripMutationStatus = 'pending' | 'applied' | 'rejected' | 'conflict'
export type SharedTripMutationType =
  | 'update_item'
  | 'create_item'
  | 'delete_item'
  | 'reorder_day_items'
  | 'update_item_execution_state'

export type SharedTripMutation = {
  id: string
  sharedTripId: string
  userId: string
  displayName?: string
  mutationType: SharedTripMutationType
  payload: unknown
  status: SharedTripMutationStatus
  createdAt: string
  updatedAt: string
  appliedAt?: string
  rejectedReason?: string
}

export type SyncObjectType =
  | 'trip'
  | 'day'
  | 'item'
  | 'ticket_meta'
  | 'ledger_settings'
  | 'ledger_participant'
  | 'ledger_budget'
  | 'ledger_expense'
export type SyncOutboxOperation = 'upsert' | 'delete'
export type SyncOutboxStatus = 'pending' | 'syncing' | 'error'
export type SyncObjectPayload =
  | Trip
  | Day
  | ItineraryItem
  | TicketMeta
  | LedgerSettings
  | LedgerParticipant
  | LedgerBudget
  | LedgerExpense

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
export type TravelInboxConnectorKind = 'gmail' | 'imap' | 'local_folder'
export type TravelInboxConnectorStatus = 'active' | 'paused' | 'reauth_required' | 'error'
export type TravelInboxSourceStatus = 'queued' | 'extracting' | 'classifying' | 'needs_assignment' | 'building_preview' | 'preview_ready' | 'error'
export type TravelInboxClassificationConfidence = 'low' | 'medium' | 'high'

export type TravelInboxClassification = {
  targetTripId?: string
  category: TravelInboxEntryCategory
  confidence: TravelInboxClassificationConfidence
  reason: string
}

export type TravelInboxAccountSource = {
  id: string
  cloudSourceId?: string
  connectorId?: string
  connectorKind: TravelInboxConnectorKind
  status: TravelInboxSourceStatus
  sourceKind: TravelInboxSourceKind
  label: string
  fileName?: string
  mimeType?: string
  size?: number
  extractedText?: string
  targetTripId?: string
  classification?: TravelInboxClassification
  warnings: string[]
  error?: string
  receivedAt: number
  createdAt: number
  updatedAt: number
}

export type TravelInboxAccountSourceBlob = {
  sourceId: string
  blob: Blob
}

export type TravelInboxLocalConnector = {
  id: string
  kind: 'local_folder'
  name: string
  status: TravelInboxConnectorStatus
  deviceId: string
  directoryHandle: FileSystemDirectoryHandle
  fileFingerprints: Record<string, string>
  autoAiEnabled: boolean
  lastScannedAt?: number
  createdAt: number
  updatedAt: number
}

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
  cloudSourceId?: string
  entryIds: string[]
  preview: unknown
  checkedDiffIds: string[]
  status: TravelInboxPreviewStatus
  createdAt: number
  updatedAt: number
}

export type TravelerRole = 'self' | 'companion' | 'child' | 'other'
export type TravelDocumentKind =
  | 'passport'
  | 'visa'
  | 'entry_permit'
  | 'residence_permit'
  | 'insurance'
  | 'discount_card'
  | 'loyalty_card'
  | 'other'
export type TravelDocumentFormat = 'paper' | 'electronic' | 'both'
export type TravelDocumentStatus = 'draft' | 'applied' | 'approved' | 'rejected' | 'active' | 'expired' | 'cancelled'
export type TravelDocumentEntryCount = 'single' | 'double' | 'multiple' | 'unlimited' | 'unknown'

export type TravelerProfileData = {
  displayName: string
  role: TravelerRole
  dateOfBirth?: string
  nationality?: string
  passportName?: string
  notes?: string
}

export type TravelDocumentData = {
  title: string
  kind: TravelDocumentKind
  format: TravelDocumentFormat
  status: TravelDocumentStatus
  travelerIds: string[]
  issuingCountry?: string
  destinationCountry?: string
  documentNumber?: string
  applicationNumber?: string
  validFrom?: string
  validUntil?: string
  entryCount?: TravelDocumentEntryCount
  maxStayDays?: number
  physicalLocation?: string
  officialUrl?: string
  notes?: string
  attachmentIds: string[]
}

export type DocumentTripLinkData = {
  documentId: string
  tripId: string
  notes?: string
}

export type BookingSecretData = {
  bookingId: string
  travelerIds: string[]
  pnr?: string
  orderNumber?: string
  ticketNumbers?: string[]
  seatAssignments?: Array<{ segmentId: string; travelerId: string; seat: string }>
  privateLinks?: ExternalAction[]
  notes?: string
}

export type BookingTravelerLinkData = {
  bookingId: string
  travelerId: string
}

export type VaultAttachmentMetadataData = {
  blobId: string
  objectId: string
  fileName: string
  mimeType: string
  size: number
}

export type VaultObjectType = 'traveler' | 'document' | 'document_trip_link' | 'booking_secret' | 'booking_traveler_link' | 'attachment_metadata'
export type VaultObjectPayload =
  | TravelerProfileData
  | TravelDocumentData
  | DocumentTripLinkData
  | BookingSecretData
  | BookingTravelerLinkData
  | VaultAttachmentMetadataData

export type VaultObjectRecord = {
  id: string
  vaultId: string
  objectType: VaultObjectType
  keyVersion: number
  schemaVersion: number
  aadVersion: number
  iv: string
  ciphertext: string
  createdAt: number
  updatedAt: number
}

export type VaultBlobRecord = {
  id: string
  vaultId: string
  objectId: string
  keyVersion: number
  schemaVersion: number
  aadVersion: number
  iv: string
  ciphertext: Blob
  fileName: string
  mimeType: string
  size: number
  createdAt: number
  updatedAt: number
}

export type VaultKeyState = {
  vaultId: string
  ownerId: string
  keyVersion: number
  schemaVersion: number
  salt: string
  wrapIv: string
  wrappedKey: string
  pbkdf2Iterations: number
  createdAt: number
  updatedAt: number
}

export type TransportBookingKind = 'flight' | 'train' | 'cruise' | 'ferry' | 'bus' | 'other'
export type TransportBookingStatus = 'draft' | 'confirmed' | 'changed' | 'cancelled' | 'completed'
export type TransportSegmentStatus = 'scheduled' | 'delayed' | 'cancelled' | 'departed' | 'arrived' | 'unknown'
export type ExternalActionKind = 'official' | 'check_in' | 'manage_booking' | 'railway' | 'hanglv' | 'other'

export type ExternalAction = {
  id: string
  kind: ExternalActionKind
  label: string
  url: string
}

export type TransportBooking = {
  id: string
  tripId: string
  title: string
  kind: TransportBookingKind
  status: TransportBookingStatus
  providerName?: string
  sourceLabel?: string
  secretObjectId?: string
  externalActions: ExternalAction[]
  createdAt: number
  updatedAt: number
}

export type TransportSegment = {
  id: string
  bookingId: string
  tripId: string
  kind: TransportBookingKind
  sortOrder: number
  carrier?: string
  serviceNumber?: string
  departurePlace: string
  arrivalPlace: string
  departureDate: string
  departureTime?: string
  departureTimeZone: string
  arrivalDate: string
  arrivalTime?: string
  arrivalTimeZone: string
  terminal?: string
  gate?: string
  arrivalTerminal?: string
  arrivalGate?: string
  status: TransportSegmentStatus
  createdAt: number
  updatedAt: number
}

export type ReminderKind = 'document_expiry' | 'check_in' | 'departure' | 'transfer'
export type ReminderScheduleStatus = 'pending' | 'sent' | 'cancelled'

export type ReminderSchedule = {
  id: string
  occurrenceId: string
  vaultId?: string
  tripId?: string
  objectType: 'document' | 'transport'
  objectId: string
  kind: ReminderKind
  triggerAt: string
  timeZone: string
  status: ReminderScheduleStatus
  sentAt?: string
  createdAt: number
  updatedAt: number
}

export type TravelCenterSyncState = {
  objectKey: string
  objectType: 'transport_booking' | 'transport_segment' | 'vault_object' | 'vault_blob' | 'vault_key' | 'reminder'
  objectId: string
  syncedLocalUpdatedAt: number
  syncedCloudUpdatedAt: number
  lastSyncedAt: number
}

export type TravelCenterSyncConflict = {
  id: string
  objectKey: string
  objectType: TravelCenterSyncState['objectType']
  objectId: string
  localUpdatedAt: number
  cloudUpdatedAt: number
  remoteRecord: unknown
  status: 'pending' | 'resolved'
  createdAt: number
  updatedAt: number
}

export type TravelCenterTombstone = {
  objectKey: string
  objectType: TravelCenterSyncState['objectType']
  objectId: string
  vaultId?: string
  tripId?: string
  deletedAt: number
}

export type FlightStatusProviderName = 'disabled' | 'mock'
export type FlightStatusSnapshot = {
  provider: FlightStatusProviderName
  status: TransportSegmentStatus
  fetchedAt: string
  expiresAt: string
  departureTime?: string
  arrivalTime?: string
  terminal?: string
  gate?: string
  warnings: string[]
}

export type TicketFile = TicketMeta & {
  blob: Blob
}

export type RouteId =
  | 'home'
  | 'inbox'
  | 'trip'
  | 'day'
  | 'item'
  | 'tickets'
  | 'documents'
  | 'ledger'
  | 'ledger/expense'
  | 'shared-trip'
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
