import Dexie, { type Table } from 'dexie'
import type {
  Day,
  ItineraryItem,
  ExchangeRateCache,
  LedgerBudget,
  LedgerArchiveQueueEntry,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
  ObjectSyncBase,
  ObjectSyncConflict,
  ObjectSyncState,
  SyncOutboxEntry,
  TicketBlob,
  TicketBlobSyncState,
  TicketMeta,
  TransportBooking,
  TransportSegment,
  Trip,
  TravelInboxBlob,
  TravelInboxAccountSource,
  TravelInboxAccountSourceBlob,
  TravelInboxEntry,
  TravelInboxLocalConnector,
  TravelInboxPreviewRecord,
  ReminderSchedule,
  TravelCenterSyncConflict,
  TravelCenterSyncState,
  TravelCenterTombstone,
  VaultBlobRecord,
  VaultKeyState,
  VaultObjectRecord,
} from '../types'

class TravelConsoleDatabase extends Dexie {
  trips!: Table<Trip, string>
  days!: Table<Day, string>
  itineraryItems!: Table<ItineraryItem, string>
  ticketMetas!: Table<TicketMeta, string>
  ticketBlobs!: Table<TicketBlob, string>
  syncOutbox!: Table<SyncOutboxEntry, string>
  objectSyncBases!: Table<ObjectSyncBase, string>
  objectSyncConflicts!: Table<ObjectSyncConflict, string>
  objectSyncStates!: Table<ObjectSyncState, string>
  ticketBlobSyncStates!: Table<TicketBlobSyncState, string>
  travelInboxBlobs!: Table<TravelInboxBlob, string>
  travelInboxAccountSourceBlobs!: Table<TravelInboxAccountSourceBlob, string>
  travelInboxAccountSources!: Table<TravelInboxAccountSource, string>
  travelInboxEntries!: Table<TravelInboxEntry, string>
  travelInboxLocalConnectors!: Table<TravelInboxLocalConnector, string>
  travelInboxPreviews!: Table<TravelInboxPreviewRecord, string>
  transportBookings!: Table<TransportBooking, string>
  transportSegments!: Table<TransportSegment, string>
  vaultObjects!: Table<VaultObjectRecord, string>
  vaultBlobs!: Table<VaultBlobRecord, string>
  vaultKeyState!: Table<VaultKeyState, string>
  reminderSchedules!: Table<ReminderSchedule, string>
  travelCenterSyncStates!: Table<TravelCenterSyncState, string>
  travelCenterSyncConflicts!: Table<TravelCenterSyncConflict, string>
  travelCenterTombstones!: Table<TravelCenterTombstone, string>
  ledgerSettings!: Table<LedgerSettings, string>
  ledgerParticipants!: Table<LedgerParticipant, string>
  ledgerBudgets!: Table<LedgerBudget, string>
  ledgerExpenses!: Table<LedgerExpense, string>
  exchangeRateCache!: Table<ExchangeRateCache, string>
  ledgerArchiveQueue!: Table<LedgerArchiveQueueEntry, string>

  constructor() {
    super('TravelConsoleDB')

    this.version(1).stores({
      trips: 'id, updatedAt',
      days: 'id, tripId, [tripId+sortOrder], date',
      itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
      ticketMetas: 'id, tripId, itemId, createdAt',
      ticketBlobs: 'ticketId',
    })

    this.version(2).stores({
      trips: 'id, updatedAt',
      days: 'id, tripId, [tripId+sortOrder], date',
      itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
      ticketMetas: 'id, tripId, itemId, createdAt',
      ticketBlobs: 'ticketId',
      syncOutbox: 'id, tripId, objectKey, [tripId+status], [objectType+objectId], updatedAt',
      objectSyncStates: 'objectKey, tripId, [objectType+objectId], conflictAt',
      ticketBlobSyncStates: 'ticketId, tripId, [tripId+uploadStatus], [tripId+cacheStatus], updatedAt',
    }).upgrade(async (transaction) => {
      const ticketMetas = transaction.table<TicketMeta, string>('ticketMetas')
      const ticketBlobs = transaction.table<TicketBlob, string>('ticketBlobs')
      const ticketBlobSyncStates = transaction.table<TicketBlobSyncState, string>('ticketBlobSyncStates')
      const now = Date.now()
      const tickets = await ticketMetas.toArray()
      const copyTickets = tickets.filter((ticket) => (ticket.storageMode ?? 'copy') === 'copy')
      if (copyTickets.length === 0) {
        return
      }

      const states = await Promise.all(copyTickets.map(async (ticket) => {
        const blob = await ticketBlobs.get(ticket.id)
        return {
          cacheStatus: blob ? 'cached' : 'missing',
          fileName: ticket.fileName,
          lastCacheCheckedAt: now,
          mimeType: ticket.mimeType,
          size: blob?.blob.size ?? ticket.size,
          ticketId: ticket.id,
          tripId: ticket.tripId,
          updatedAt: now,
          uploadStatus: blob ? 'pending' : 'missing',
        } satisfies TicketBlobSyncState
      }))
      await ticketBlobSyncStates.bulkPut(states)
    })

    this.version(3).stores({
      trips: 'id, updatedAt',
      days: 'id, tripId, [tripId+sortOrder], date',
      itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
      ticketMetas: 'id, tripId, itemId, createdAt',
      ticketBlobs: 'ticketId',
      syncOutbox: 'id, tripId, objectKey, [tripId+status], [objectType+objectId], updatedAt',
      objectSyncBases: 'objectKey, tripId, [objectType+objectId], cloudUpdatedAtMs, updatedAt',
      objectSyncConflicts: 'id, tripId, objectKey, status, [tripId+status], [objectType+objectId], createdAt',
      objectSyncStates: 'objectKey, tripId, [objectType+objectId], conflictAt',
      ticketBlobSyncStates: 'ticketId, tripId, [tripId+uploadStatus], [tripId+cacheStatus], updatedAt',
    }).upgrade(async (transaction) => {
      const trips = transaction.table<Trip, string>('trips')
      const days = transaction.table<Day, string>('days')
      const itineraryItems = transaction.table<ItineraryItem, string>('itineraryItems')
      const ticketMetas = transaction.table<TicketMeta, string>('ticketMetas')
      const objectSyncStates = transaction.table<ObjectSyncState, string>('objectSyncStates')
      const objectSyncBases = transaction.table<ObjectSyncBase, string>('objectSyncBases')
      const now = Date.now()
      const existingBaseKeys = new Set((await objectSyncBases.toArray()).map((base) => base.objectKey))
      const states = new Map((await objectSyncStates.toArray()).map((state) => [state.objectKey, state]))
      const bases: ObjectSyncBase[] = []

      const pushBase = (input: Omit<ObjectSyncBase, 'cloudUpdatedAtMs' | 'updatedAt'> & { fallbackUpdatedAt?: number }) => {
        if (existingBaseKeys.has(input.objectKey)) return
        const state = states.get(input.objectKey)
        bases.push({
          ...input,
          cloudUpdatedAtMs: state?.cloudUpdatedAtMs ?? state?.lastSyncedAt ?? state?.localUpdatedAtMs ?? input.fallbackUpdatedAt ?? now,
          updatedAt: now,
        })
      }

      for (const trip of await trips.toArray()) {
        pushBase({
          fallbackUpdatedAt: trip.updatedAt,
          objectId: trip.id,
          objectKey: `trip:${trip.id}`,
          objectType: 'trip',
          payload: trip,
          tripId: trip.id,
        })
      }
      for (const day of await days.toArray()) {
        pushBase({
          fallbackUpdatedAt: now,
          objectId: day.id,
          objectKey: `day:${day.id}`,
          objectType: 'day',
          payload: day,
          tripId: day.tripId,
        })
      }
      for (const item of await itineraryItems.toArray()) {
        pushBase({
          fallbackUpdatedAt: item.updatedAt,
          objectId: item.id,
          objectKey: `item:${item.id}`,
          objectType: 'item',
          payload: item,
          tripId: item.tripId,
        })
      }
      for (const ticket of await ticketMetas.toArray()) {
        pushBase({
          fallbackUpdatedAt: ticket.updatedAt,
          objectId: ticket.id,
          objectKey: `ticket_meta:${ticket.id}`,
          objectType: 'ticket_meta',
          payload: ticket,
          tripId: ticket.tripId,
        })
      }

      if (bases.length > 0) {
        await objectSyncBases.bulkPut(bases)
      }
    })

    this.version(4).stores({
      trips: 'id, updatedAt',
      days: 'id, tripId, [tripId+sortOrder], date',
      itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
      ticketMetas: 'id, tripId, itemId, createdAt',
      ticketBlobs: 'ticketId',
      syncOutbox: 'id, tripId, objectKey, [tripId+status], [objectType+objectId], updatedAt',
      objectSyncBases: 'objectKey, tripId, [objectType+objectId], cloudUpdatedAtMs, updatedAt',
      objectSyncConflicts: 'id, tripId, objectKey, status, [tripId+status], [objectType+objectId], createdAt',
      objectSyncStates: 'objectKey, tripId, [objectType+objectId], conflictAt',
      ticketBlobSyncStates: 'ticketId, tripId, [tripId+uploadStatus], [tripId+cacheStatus], updatedAt',
      travelInboxBlobs: 'entryId',
      travelInboxEntries: 'id, tripId, [tripId+status], sourceKind, category, createdAt',
      travelInboxPreviews: 'id, tripId, status, createdAt',
    })

    this.version(5).stores({
      trips: 'id, updatedAt',
      days: 'id, tripId, [tripId+sortOrder], date',
      itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
      ticketMetas: 'id, tripId, itemId, createdAt',
      ticketBlobs: 'ticketId',
      syncOutbox: 'id, tripId, objectKey, [tripId+status], [objectType+objectId], updatedAt',
      objectSyncBases: 'objectKey, tripId, [objectType+objectId], cloudUpdatedAtMs, updatedAt',
      objectSyncConflicts: 'id, tripId, objectKey, status, [tripId+status], [objectType+objectId], createdAt',
      objectSyncStates: 'objectKey, tripId, [objectType+objectId], conflictAt',
      ticketBlobSyncStates: 'ticketId, tripId, [tripId+uploadStatus], [tripId+cacheStatus], updatedAt',
      travelInboxBlobs: 'entryId',
      travelInboxEntries: 'id, tripId, [tripId+status], sourceKind, category, createdAt',
      travelInboxPreviews: 'id, tripId, cloudSourceId, status, createdAt',
      travelInboxAccountSourceBlobs: 'sourceId',
      travelInboxAccountSources: 'id, cloudSourceId, connectorId, status, targetTripId, receivedAt',
      travelInboxLocalConnectors: 'id, status, updatedAt',
    })

    this.version(6).stores({
      trips: 'id, updatedAt',
      days: 'id, tripId, [tripId+sortOrder], date',
      itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
      ticketMetas: 'id, tripId, itemId, bookingId, createdAt',
      ticketBlobs: 'ticketId',
      syncOutbox: 'id, tripId, objectKey, [tripId+status], [objectType+objectId], updatedAt',
      objectSyncBases: 'objectKey, tripId, [objectType+objectId], cloudUpdatedAtMs, updatedAt',
      objectSyncConflicts: 'id, tripId, objectKey, status, [tripId+status], [objectType+objectId], createdAt',
      objectSyncStates: 'objectKey, tripId, [objectType+objectId], conflictAt',
      ticketBlobSyncStates: 'ticketId, tripId, [tripId+uploadStatus], [tripId+cacheStatus], updatedAt',
      travelInboxBlobs: 'entryId',
      travelInboxEntries: 'id, tripId, [tripId+status], sourceKind, category, createdAt',
      travelInboxPreviews: 'id, tripId, cloudSourceId, status, createdAt',
      travelInboxAccountSourceBlobs: 'sourceId',
      travelInboxAccountSources: 'id, cloudSourceId, connectorId, status, targetTripId, receivedAt',
      travelInboxLocalConnectors: 'id, status, updatedAt',
      transportBookings: 'id, tripId, kind, status, updatedAt',
      transportSegments: 'id, bookingId, tripId, [bookingId+sortOrder], departureDate',
      vaultObjects: 'id, vaultId, objectType, [vaultId+objectType], updatedAt',
      vaultBlobs: 'id, vaultId, objectId, [vaultId+objectId], updatedAt',
      vaultKeyState: 'vaultId, ownerId, updatedAt',
      reminderSchedules: 'id, occurrenceId, status, triggerAt, objectId, [status+triggerAt]',
      travelCenterSyncStates: 'objectKey, objectType, objectId, lastSyncedAt',
      travelCenterSyncConflicts: 'id, objectKey, status, objectType, createdAt',
      travelCenterTombstones: 'objectKey, objectType, objectId, deletedAt',
    })

    this.version(7).stores({
      trips: 'id, updatedAt',
      days: 'id, tripId, [tripId+sortOrder], date',
      itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
      ticketMetas: 'id, tripId, itemId, bookingId, createdAt',
      ticketBlobs: 'ticketId',
      syncOutbox: 'id, tripId, objectKey, [tripId+status], [objectType+objectId], updatedAt',
      objectSyncBases: 'objectKey, tripId, [objectType+objectId], cloudUpdatedAtMs, updatedAt',
      objectSyncConflicts: 'id, tripId, objectKey, status, [tripId+status], [objectType+objectId], createdAt',
      objectSyncStates: 'objectKey, tripId, [objectType+objectId], conflictAt',
      ticketBlobSyncStates: 'ticketId, tripId, [tripId+uploadStatus], [tripId+cacheStatus], updatedAt',
      travelInboxBlobs: 'entryId',
      travelInboxEntries: 'id, tripId, [tripId+status], sourceKind, category, createdAt',
      travelInboxPreviews: 'id, tripId, cloudSourceId, status, createdAt',
      travelInboxAccountSourceBlobs: 'sourceId',
      travelInboxAccountSources: 'id, cloudSourceId, connectorId, status, targetTripId, receivedAt',
      travelInboxLocalConnectors: 'id, status, updatedAt',
      transportBookings: 'id, tripId, kind, status, updatedAt',
      transportSegments: 'id, bookingId, tripId, [bookingId+sortOrder], departureDate',
      vaultObjects: 'id, vaultId, objectType, [vaultId+objectType], updatedAt',
      vaultBlobs: 'id, vaultId, objectId, [vaultId+objectId], updatedAt',
      vaultKeyState: 'vaultId, ownerId, updatedAt',
      reminderSchedules: 'id, occurrenceId, status, triggerAt, objectId, [status+triggerAt]',
      travelCenterSyncStates: 'objectKey, objectType, objectId, lastSyncedAt',
      travelCenterSyncConflicts: 'id, objectKey, status, objectType, createdAt',
      travelCenterTombstones: 'objectKey, objectType, objectId, deletedAt',
      ledgerSettings: 'id, &tripId, updatedAt',
      ledgerParticipants: 'id, tripId, [tripId+updatedAt], sourceId',
      ledgerBudgets: 'id, tripId, scope, [tripId+scope], updatedAt',
      ledgerExpenses: 'id, tripId, status, date, category, [tripId+date], [tripId+status], updatedAt',
      exchangeRateCache: 'id, requestedDate, [baseCurrency+quoteCurrency], updatedAt',
    })

    this.version(8).stores({
      trips: 'id, updatedAt',
      days: 'id, tripId, [tripId+sortOrder], date',
      itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
      ticketMetas: 'id, tripId, itemId, bookingId, createdAt',
      ticketBlobs: 'ticketId',
      syncOutbox: 'id, tripId, objectKey, [tripId+status], [objectType+objectId], updatedAt',
      objectSyncBases: 'objectKey, tripId, [objectType+objectId], cloudUpdatedAtMs, updatedAt',
      objectSyncConflicts: 'id, tripId, objectKey, status, [tripId+status], [objectType+objectId], createdAt',
      objectSyncStates: 'objectKey, tripId, [objectType+objectId], conflictAt',
      ticketBlobSyncStates: 'ticketId, tripId, [tripId+uploadStatus], [tripId+cacheStatus], updatedAt',
      travelInboxBlobs: 'entryId',
      travelInboxEntries: 'id, tripId, [tripId+status], sourceKind, category, createdAt',
      travelInboxPreviews: 'id, tripId, cloudSourceId, status, createdAt',
      travelInboxAccountSourceBlobs: 'sourceId',
      travelInboxAccountSources: 'id, cloudSourceId, connectorId, status, targetTripId, receivedAt',
      travelInboxLocalConnectors: 'id, status, updatedAt',
      transportBookings: 'id, tripId, kind, status, updatedAt',
      transportSegments: 'id, bookingId, tripId, [bookingId+sortOrder], departureDate',
      vaultObjects: 'id, vaultId, objectType, [vaultId+objectType], updatedAt',
      vaultBlobs: 'id, vaultId, objectId, [vaultId+objectId], updatedAt',
      vaultKeyState: 'vaultId, ownerId, updatedAt',
      reminderSchedules: 'id, occurrenceId, status, triggerAt, objectId, [status+triggerAt]',
      travelCenterSyncStates: 'objectKey, objectType, objectId, lastSyncedAt',
      travelCenterSyncConflicts: 'id, objectKey, status, objectType, createdAt',
      travelCenterTombstones: 'objectKey, objectType, objectId, deletedAt',
      ledgerSettings: 'id, &tripId, updatedAt',
      ledgerParticipants: 'id, tripId, [tripId+updatedAt], sourceId',
      ledgerBudgets: 'id, tripId, scope, [tripId+scope], updatedAt',
      ledgerExpenses: 'id, tripId, status, date, category, orderNumber, merchant, [tripId+date], [tripId+status], updatedAt',
      exchangeRateCache: 'id, requestedDate, [baseCurrency+quoteCurrency], updatedAt',
      ledgerArchiveQueue: 'id, tripId, sourceKey, status, [tripId+status], nextAttemptAt, updatedAt',
    }).upgrade(async (transaction) => {
      const ledgerExpenses = transaction.table<LedgerExpense, string>('ledgerExpenses')
      await ledgerExpenses.toCollection().modify((expense) => {
        expense.sourceLinks ??= [{
          available: true,
          id: `legacy:${expense.source.kind}:${expense.source.sourceId ?? expense.id}`,
          role: 'other',
          ...expense.source,
        }]
        expense.itemIds ??= []
        expense.lineItems ??= []
        expense.orderStatus ??= expense.status === 'void' ? 'cancelled' : 'active'
        expense.paymentStatus ??= expense.status === 'confirmed' ? 'paid' : 'unknown'
        expense.reviewStatus ??= expense.status === 'confirmed' ? 'reviewed' : 'unreviewed'
      })
    })
  }
}

export const db = new TravelConsoleDatabase()
