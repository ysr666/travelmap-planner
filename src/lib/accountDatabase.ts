import Dexie from 'dexie'
import {
  LEGACY_TRAVEL_DATABASE_NAME,
  TravelConsoleDatabase,
  getActiveTravelDatabase,
  setActiveTravelDatabase,
  activateLegacyTravelDatabase,
} from '../db/database'
import { enqueueObjectUpsert, markTicketBlobPendingUpload } from './objectSyncLocal'
import type {
  Day,
  ItineraryItem,
  LedgerBudget,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
  TicketMeta,
  Trip,
  TripDisruptionEvent,
  TripIntelligenceAppliedChangeRecord,
  TripIntelligenceSuggestionStateRecord,
  TripReplanRecord,
} from '../types'
import {
  configureRouteCacheDatabase,
  getLegacyRouteCacheDatabaseName,
  resetRouteCacheDatabase,
} from './routeCache'
import {
  clearActiveAccountStorageScope,
  setActiveAccountStorageScope,
} from './accountStorageScope'

export { getAccountScopedStorageKey, getActiveAccountHash } from './accountStorageScope'

const ACCOUNT_DB_PREFIX = `${LEGACY_TRAVEL_DATABASE_NAME}:account:`
const ACCOUNT_MIGRATION_KEY_PREFIX = 'tripmap:account-db:migration:'

const MIGRATED_TABLES = [
  'trips',
  'days',
  'itineraryItems',
  'ticketMetas',
  'ticketBlobs',
  'travelInboxBlobs',
  'travelInboxEntries',
  'travelInboxPreviews',
  'transportBookings',
  'transportSegments',
  'vaultObjects',
  'vaultBlobs',
  'vaultKeyState',
  'reminderSchedules',
  'ledgerSettings',
  'ledgerParticipants',
  'ledgerBudgets',
  'ledgerExpenses',
  'exchangeRateCache',
  'ledgerArchiveQueue',
  'tripReplanEvents',
  'tripReplanRecords',
  'tripIntelligenceAppliedChanges',
  'tripIntelligenceSuggestionStates',
] as const

export type AccountDatabaseSummary = {
  databaseName: string
  materialCount: number
  tripCount: number
}

export type LegacyDatabaseMigrationResult = AccountDatabaseSummary & {
  copiedTables: number
  queuedObjects: number
}

export async function hashAccountId(userId: string) {
  const normalized = userId.trim()
  if (!normalized) throw new Error('账号标识无效。')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

export function buildAccountTravelDatabaseName(accountHash: string) {
  return `${ACCOUNT_DB_PREFIX}${accountHash}`
}

export async function activateAccountDatabase(userId: string) {
  const accountHash = await hashAccountId(userId)
  const databaseName = buildAccountTravelDatabaseName(accountHash)
  if (getActiveTravelDatabase().name !== databaseName) {
    setActiveTravelDatabase(new TravelConsoleDatabase(databaseName))
  }
  setActiveAccountStorageScope(accountHash)
  configureRouteCacheDatabase(accountHash)
  return { accountHash, databaseName }
}

export function deactivateAccountDatabase() {
  getActiveTravelDatabase().close()
  clearActiveAccountStorageScope()
  activateLegacyTravelDatabase().close()
  resetRouteCacheDatabase()
}

export function activateLegacyDatabaseForTests() {
  clearActiveAccountStorageScope()
  resetRouteCacheDatabase()
  return activateLegacyTravelDatabase()
}

export async function hasCompletedLegacyDatabaseDecision(userId: string) {
  const accountHash = await hashAccountId(userId)
  return readStorage(`${ACCOUNT_MIGRATION_KEY_PREFIX}${accountHash}`) !== null
}

export async function markLegacyDatabaseDecision(userId: string, decision: 'takeover' | 'cloud_only' | 'not_needed') {
  const accountHash = await hashAccountId(userId)
  writeStorage(`${ACCOUNT_MIGRATION_KEY_PREFIX}${accountHash}`, JSON.stringify({ decision, decidedAt: Date.now() }))
}

export async function summarizeLegacyDatabase(): Promise<AccountDatabaseSummary> {
  return summarizeDatabase(LEGACY_TRAVEL_DATABASE_NAME)
}

export async function summarizeAccountDatabase(userId: string): Promise<AccountDatabaseSummary> {
  const accountHash = await hashAccountId(userId)
  return summarizeDatabase(buildAccountTravelDatabaseName(accountHash))
}

export async function migrateLegacyDatabaseToAccount(userId: string): Promise<LegacyDatabaseMigrationResult> {
  const accountHash = await hashAccountId(userId)
  const destinationName = buildAccountTravelDatabaseName(accountHash)
  const sourceExists = await Dexie.exists(LEGACY_TRAVEL_DATABASE_NAME)
  if (!sourceExists) {
    await activateAccountDatabase(userId)
    await markLegacyDatabaseDecision(userId, 'not_needed')
    return { databaseName: destinationName, materialCount: 0, tripCount: 0, copiedTables: 0, queuedObjects: 0 }
  }

  const source = new TravelConsoleDatabase(LEGACY_TRAVEL_DATABASE_NAME)
  const destination = new TravelConsoleDatabase(destinationName)
  let copiedTables = 0
  try {
    await Promise.all([source.open(), destination.open()])
    for (const tableName of MIGRATED_TABLES) {
      const records = await source.table(tableName).toArray()
      if (records.length === 0) continue
      await destination.table(tableName).bulkPut(records)
      copiedTables += 1
    }
  } finally {
    source.close()
    destination.close()
  }

  await activateAccountDatabase(userId)
  const queuedObjects = await rebuildAccountSyncState()
  await markLegacyDatabaseDecision(userId, 'takeover')
  const summary = await summarizeAccountDatabase(userId)
  return { ...summary, copiedTables, queuedObjects }
}

async function summarizeDatabase(databaseName: string): Promise<AccountDatabaseSummary> {
  if (!await Dexie.exists(databaseName)) {
    return { databaseName, materialCount: 0, tripCount: 0 }
  }
  const database = new TravelConsoleDatabase(databaseName)
  try {
    await database.open()
    const [tripCount, ...materialCounts] = await Promise.all([
      database.trips.count(),
      database.days.count(),
      database.itineraryItems.count(),
      database.ticketMetas.count(),
      database.ledgerExpenses.count(),
      database.vaultObjects.count(),
      database.travelInboxEntries.count(),
    ])
    return {
      databaseName,
      materialCount: materialCounts.reduce((sum, value) => sum + value, 0),
      tripCount,
    }
  } finally {
    database.close()
  }
}

async function rebuildAccountSyncState() {
  const database = getActiveTravelDatabase()
  await database.transaction(
    'rw',
    [database.syncOutbox, database.objectSyncBases, database.objectSyncConflicts, database.objectSyncStates, database.ticketBlobSyncStates],
    async () => {
      await Promise.all([
        database.syncOutbox.clear(),
        database.objectSyncBases.clear(),
        database.objectSyncConflicts.clear(),
        database.objectSyncStates.clear(),
        database.ticketBlobSyncStates.clear(),
      ])
    },
  )

  let queuedObjects = 0
  const enqueueAll = async <T>(records: T[], objectType: Parameters<typeof enqueueObjectUpsert>[0]['objectType']) => {
    for (const object of records) {
      await enqueueObjectUpsert({ object, objectType } as Parameters<typeof enqueueObjectUpsert>[0])
      queuedObjects += 1
    }
  }

  await enqueueAll(await database.trips.toArray() as Trip[], 'trip')
  await enqueueAll(await database.days.toArray() as Day[], 'day')
  await enqueueAll(await database.itineraryItems.toArray() as ItineraryItem[], 'item')
  await enqueueAll(await database.ticketMetas.toArray() as TicketMeta[], 'ticket_meta')
  await enqueueAll(await database.ledgerSettings.toArray() as LedgerSettings[], 'ledger_settings')
  await enqueueAll(await database.ledgerParticipants.toArray() as LedgerParticipant[], 'ledger_participant')
  await enqueueAll(await database.ledgerBudgets.toArray() as LedgerBudget[], 'ledger_budget')
  await enqueueAll(await database.ledgerExpenses.toArray() as LedgerExpense[], 'ledger_expense')
  await enqueueAll(await database.tripReplanEvents.toArray() as TripDisruptionEvent[], 'replan_event')
  await enqueueAll(await database.tripReplanRecords.toArray() as TripReplanRecord[], 'replan_record')
  await enqueueAll(await database.tripIntelligenceAppliedChanges.toArray() as TripIntelligenceAppliedChangeRecord[], 'trip_intelligence_applied_change')
  await enqueueAll(await database.tripIntelligenceSuggestionStates.toArray() as TripIntelligenceSuggestionStateRecord[], 'trip_intelligence_suggestion_state')

  const tickets = await database.ticketMetas.toArray()
  for (const ticket of tickets) {
    const blobRecord = await database.ticketBlobs.get(ticket.id)
    if (blobRecord?.blob) await markTicketBlobPendingUpload({ blob: blobRecord.blob, ticket })
  }
  return queuedObjects
}

export function getLegacyAccountMigrationRouteCacheName() {
  return getLegacyRouteCacheDatabaseName()
}

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    throw new Error('无法记录账号数据接管状态，请检查浏览器存储权限。')
  }
}
