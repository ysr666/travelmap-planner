import type { Table } from 'dexie'
import type { TicketMeta } from '../../types'
import type { TravelConsoleDatabase } from '../../db/database'
import {
  parseAccountObjectMutationV1,
  type ClientMutableAccountObjectType,
  type JsonObject,
} from './contract'
import { redactTicketMetaForAccountCloud } from './mutationBuilder'

export const ACCOUNT_WORKFLOW_LOCAL_OBJECT_TYPES = [
  'trip',
  'day',
  'item',
  'ticket_meta',
  'ledger_settings',
  'ledger_participant',
  'ledger_budget',
  'ledger_expense',
  'replan_event',
  'replan_record',
  'trip_intelligence_applied_change',
  'trip_intelligence_suggestion_state',
] as const satisfies readonly ClientMutableAccountObjectType[]

export type AccountWorkflowLocalObjectType = typeof ACCOUNT_WORKFLOW_LOCAL_OBJECT_TYPES[number]

export class AccountWorkflowLocalCodecError extends Error {
  readonly code: 'invalid_object' | 'missing_ticket_base' | 'unsupported_object'

  constructor(code: AccountWorkflowLocalCodecError['code']) {
    super(code)
    this.name = 'AccountWorkflowLocalCodecError'
    this.code = code
  }
}

const LOCAL_OBJECT_TYPE_SET = new Set<string>(ACCOUNT_WORKFLOW_LOCAL_OBJECT_TYPES)
const VALIDATION_MUTATION_ID = '00000000-0000-4000-8000-000000000001'
const TICKET_CLOUD_FIELDS = [
  'bookingId',
  'createdAt',
  'fileType',
  'id',
  'itemId',
  'mimeType',
  'scope',
  'sharedVisibility',
  'size',
  'storageMode',
  'ticketCategory',
  'title',
  'tripId',
  'updatedAt',
] as const

export function isAccountWorkflowLocalObjectType(
  objectType: ClientMutableAccountObjectType,
): objectType is AccountWorkflowLocalObjectType {
  return LOCAL_OBJECT_TYPE_SET.has(objectType)
}

export function getAccountWorkflowLocalObjectTable(
  objectType: ClientMutableAccountObjectType,
  database: TravelConsoleDatabase,
): Table<unknown, string> {
  switch (objectType) {
    case 'trip': return database.trips as Table<unknown, string>
    case 'day': return database.days as Table<unknown, string>
    case 'item': return database.itineraryItems as Table<unknown, string>
    case 'ticket_meta': return database.ticketMetas as Table<unknown, string>
    case 'ledger_settings': return database.ledgerSettings as Table<unknown, string>
    case 'ledger_participant': return database.ledgerParticipants as Table<unknown, string>
    case 'ledger_budget': return database.ledgerBudgets as Table<unknown, string>
    case 'ledger_expense': return database.ledgerExpenses as Table<unknown, string>
    case 'replan_event': return database.tripReplanEvents as Table<unknown, string>
    case 'replan_record': return database.tripReplanRecords as Table<unknown, string>
    case 'trip_intelligence_applied_change': return database.tripIntelligenceAppliedChanges as Table<unknown, string>
    case 'trip_intelligence_suggestion_state': return database.tripIntelligenceSuggestionStates as Table<unknown, string>
    default: throw new AccountWorkflowLocalCodecError('unsupported_object')
  }
}

export function getAccountWorkflowLocalObjectTables(
  objectTypes: Iterable<ClientMutableAccountObjectType>,
  database: TravelConsoleDatabase,
) {
  const tables = new Map<string, Table<unknown, string>>()
  for (const objectType of objectTypes) {
    const table = getAccountWorkflowLocalObjectTable(objectType, database)
    tables.set(table.name, table)
  }
  return [...tables.values()]
}

export async function readAccountWorkflowLocalPayload(
  objectType: ClientMutableAccountObjectType,
  objectId: string,
  tripId: string,
  database: TravelConsoleDatabase,
): Promise<JsonObject | null> {
  const value = await getAccountWorkflowLocalObjectTable(objectType, database).get(objectId)
  if (value === undefined) return null
  return encodeAccountWorkflowLocalPayload(objectType, objectId, tripId, value)
}

export function encodeAccountWorkflowLocalPayload(
  objectType: ClientMutableAccountObjectType,
  objectId: string,
  tripId: string,
  value: unknown,
): JsonObject {
  if (!isAccountWorkflowLocalObjectType(objectType) || !value || typeof value !== 'object') {
    throw new AccountWorkflowLocalCodecError('unsupported_object')
  }
  const bounded = objectType === 'ticket_meta'
    ? redactTicketMetaForAccountCloud(value as TicketMeta)
    : value
  try {
    const mutation = parseAccountObjectMutationV1({
      deviceId: 'workflow_local_codec',
      expectedRevision: 0,
      mutationId: VALIDATION_MUTATION_ID,
      objectId,
      objectSchemaVersion: 1,
      objectType,
      operation: 'upsert',
      payload: toPlainJsonObject(bounded),
      schemaVersion: 1,
      tripId,
    })
    return mutation.payload as JsonObject
  } catch {
    throw new AccountWorkflowLocalCodecError('invalid_object')
  }
}

export async function writeAccountWorkflowLocalPayload(
  objectType: ClientMutableAccountObjectType,
  objectId: string,
  tripId: string,
  payload: JsonObject | null,
  database: TravelConsoleDatabase,
) {
  const table = getAccountWorkflowLocalObjectTable(objectType, database)
  if (payload === null) {
    await table.delete(objectId)
    return
  }
  const canonical = encodeAccountWorkflowLocalPayload(objectType, objectId, tripId, payload)
  if (objectType !== 'ticket_meta') {
    await table.put(canonical, objectId)
    return
  }

  const existing = await table.get(objectId)
  if (!existing || typeof existing !== 'object') {
    throw new AccountWorkflowLocalCodecError('missing_ticket_base')
  }
  const merged = { ...(existing as Record<string, unknown>) }
  for (const field of TICKET_CLOUD_FIELDS) {
    if (Object.hasOwn(canonical, field)) merged[field] = canonical[field]
    else delete merged[field]
  }
  await table.put(merged, objectId)
}

function toPlainJsonObject(value: unknown): JsonObject {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new AccountWorkflowLocalCodecError('invalid_object')
  }
  if (!serialized) throw new AccountWorkflowLocalCodecError('invalid_object')
  const parsed = JSON.parse(serialized) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AccountWorkflowLocalCodecError('invalid_object')
  }
  return parsed as JsonObject
}
