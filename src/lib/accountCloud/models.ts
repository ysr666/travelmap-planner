import type {
  Day,
  ItineraryItem,
  LedgerBudget,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
  TicketMeta,
  TransportBooking,
  TransportSegment,
  Trip,
  TripDisruptionEvent,
  TripIntelligenceAppliedChangeRecord,
  TripIntelligenceSuggestionStateRecord,
  TripReplanRecord,
} from '../../types'
import type { TravelMediaAssetV1 } from '../media/travelMedia'
import type { RealtimeFactV1 } from '../realtime/realtimeFact'
import type { InsurancePolicyV1, LodgingReservationV1 } from '../travelObjects/contracts'
import type { AccountObjectType } from './contract'

export type RedactedDocumentIndexV1 = {
  schemaVersion: 1
  id: string
  tripId: string
  vaultDocumentId: string
  title: string
  kind: 'discount_card' | 'entry_permit' | 'insurance' | 'other' | 'passport' | 'residence_permit' | 'visa'
  format: 'both' | 'electronic' | 'paper'
  status: 'active' | 'applied' | 'approved' | 'cancelled' | 'draft' | 'expired' | 'rejected'
  travelerCount: number
  attachmentCount: number
  issuingCountry?: string
  destinationCountry?: string
  validFrom?: string
  validUntil?: string
  createdAt: number
  updatedAt: number
}

export type AccountDocumentTripLinkV1 = {
  schemaVersion: 1
  id: string
  tripId: string
  documentIndexId: string
  targetType: 'booking' | 'day' | 'insurance' | 'item' | 'lodging' | 'ticket' | 'trip'
  targetId: string
  status: 'confirmed' | 'conflict' | 'suggested'
  confidence: number
  sourceId: string
  createdAt: number
  updatedAt: number
}

export type SharedTaskV1 = {
  schemaVersion: 1
  id: string
  tripId: string
  title: string
  status: 'cancelled' | 'completed' | 'open'
  assigneeMemberIds: string[]
  relatedObjectType?: 'booking' | 'day' | 'document' | 'item' | 'ticket' | 'trip'
  relatedObjectId?: string
  dueAt?: string
  completedAt?: string
  createdByMemberId?: string
  createdAt: number
  updatedAt: number
}

export type AiJobStatus =
  | 'awaiting_confirmation'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'needs_input'
  | 'partial'
  | 'queued'
  | 'running'

export type AiJobV1 = {
  schemaVersion: 1
  id: string
  tripId: string
  actionPlanId: string
  status: AiJobStatus
  summary: string
  progress: {
    completedSteps: number
    totalSteps: number
  }
  affectedObjectIds: string[]
  errorCategory?: 'conflict' | 'invalid_target' | 'permission' | 'provider' | 'stale_plan' | 'unavailable'
  createdAt: number
  updatedAt: number
  expiresAt: string
}

export type RedactedTicketMetaV1 = Pick<
  TicketMeta,
  | 'bookingId'
  | 'createdAt'
  | 'fileType'
  | 'id'
  | 'itemId'
  | 'mimeType'
  | 'scope'
  | 'sharedVisibility'
  | 'size'
  | 'storageMode'
  | 'ticketCategory'
  | 'title'
  | 'tripId'
  | 'updatedAt'
>

export type AccountObjectPayloadByType = {
  trip: Trip
  day: Day
  item: ItineraryItem
  ticket_meta: RedactedTicketMetaV1
  document_index: RedactedDocumentIndexV1
  document_trip_link: AccountDocumentTripLinkV1
  transport_booking: TransportBooking
  transport_segment: TransportSegment
  lodging: LodgingReservationV1
  insurance: InsurancePolicyV1
  media_asset: TravelMediaAssetV1
  realtime_fact: RealtimeFactV1
  ledger_settings: LedgerSettings
  ledger_participant: LedgerParticipant
  ledger_budget: LedgerBudget
  ledger_expense: LedgerExpense
  trip_intelligence_applied_change: TripIntelligenceAppliedChangeRecord
  trip_intelligence_suggestion_state: TripIntelligenceSuggestionStateRecord
  shared_task: SharedTaskV1
  ai_job: AiJobV1
  replan_event: TripDisruptionEvent
  replan_record: TripReplanRecord
}

export type AccountObjectPayload<T extends AccountObjectType> = AccountObjectPayloadByType[T]
