import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getActiveAccountHash,
  hashAccountStorageScopeId,
} from '../accountStorageScope'
import {
  AccountCloudTransportError,
  normalizeAccountCloudError,
  requireAccountCloudClient,
} from './client'
import {
  AccountCloudContractError,
  parseAccountObjectRowV1,
  type AccountObjectRowV1,
} from './contract'

const ACCOUNT_OBJECTS_TABLE = 'tripmap_account_objects'
const ACCOUNT_OBJECT_SELECT = [
  'trip_id',
  'object_type',
  'object_id',
  'payload',
  'schema_version',
  'revision',
  'mutation_id',
  'actor_id',
  'device_id',
  'tombstone',
  'deleted_at',
  'created_at',
  'updated_at',
].join(',')
const ACCOUNT_OBJECT_ROW_FIELDS = new Set(ACCOUNT_OBJECT_SELECT.split(','))
const CONTROLLED_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const ACCOUNT_HASH = /^[a-f0-9]{32}$/
const DEFAULT_PAGE_SIZE = 200
const MAX_PAGE_SIZE = 500
const DEFAULT_MAX_PAGES = 20
const MAX_PAGE_COUNT = 40

type AccountObjectReadResponse = {
  data: unknown
  error: { code?: string; message?: string; status?: number } | null
}

export type AccountTripObjectReadOptions = {
  client?: SupabaseClient
  expectedAccountHash?: string | null
  maxPages?: number
  pageSize?: number
}

export async function readAccountTripObjectsV1(
  tripId: string,
  options: AccountTripObjectReadOptions = {},
): Promise<AccountObjectRowV1[]> {
  if (!CONTROLLED_ID.test(tripId)) {
    throw new AccountCloudTransportError('invalid_response', false)
  }
  const expectedAccountHash = options.expectedAccountHash ?? getActiveAccountHash()
  assertAccountContext(expectedAccountHash)
  const pageSize = readBoundedOption(options.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
  const maxPages = readBoundedOption(options.maxPages, DEFAULT_MAX_PAGES, 1, MAX_PAGE_COUNT)
  const client = options.client ?? requireAccountCloudClient()
  const rows: AccountObjectRowV1[] = []
  const seenKeys = new Set<string>()

  await assertAuthenticatedAccount(client, expectedAccountHash)

  for (let page = 0; page < maxPages; page += 1) {
    assertAccountContext(expectedAccountHash)
    let response: AccountObjectReadResponse
    try {
      response = await client
        .from(ACCOUNT_OBJECTS_TABLE)
        .select(ACCOUNT_OBJECT_SELECT)
        .eq('trip_id', tripId)
        .order('object_type', { ascending: true })
        .order('object_id', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1) as AccountObjectReadResponse
    } catch {
      throw new AccountCloudTransportError('request_failed', true)
    }
    assertAccountContext(expectedAccountHash)
    await assertAuthenticatedAccount(client, expectedAccountHash)

    if (response.error) throw normalizeAccountCloudError(response.error)
    if (!Array.isArray(response.data) || response.data.length > pageSize) {
      throw new AccountCloudTransportError('invalid_response', true)
    }

    for (const rawRow of response.data) {
      const row = decodeAccountObjectDatabaseRow(rawRow)
      if (row.tripId !== tripId) {
        throw new AccountCloudTransportError('invalid_response', true)
      }
      const key = `${row.objectType}:${row.objectId}`
      if (seenKeys.has(key)) {
        throw new AccountCloudTransportError('invalid_response', true)
      }
      seenKeys.add(key)
      rows.push(row)
    }

    if (response.data.length < pageSize) {
      assertAccountContext(expectedAccountHash)
      return rows
    }
  }

  throw new AccountCloudTransportError('invalid_response', false)
}

export async function readStableAccountTripObjectsV1(
  tripId: string,
  options: AccountTripObjectReadOptions = {},
) {
  const expectedAccountHash = options.expectedAccountHash ?? getActiveAccountHash()
  const first = await readAccountTripObjectsV1(tripId, {
    ...options,
    expectedAccountHash,
  })
  const second = await readAccountTripObjectsV1(tripId, {
    ...options,
    expectedAccountHash,
  })
  if (stableStringify(first) !== stableStringify(second)) {
    throw new AccountCloudTransportError('invalid_response', true)
  }
  return second
}

function decodeAccountObjectDatabaseRow(input: unknown) {
  try {
    const row = readStrictDatabaseRow(input)
    return parseAccountObjectRowV1({
      actorId: row.actor_id,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      deviceId: row.device_id,
      mutationId: row.mutation_id,
      objectId: row.object_id,
      objectSchemaVersion: row.schema_version,
      objectType: row.object_type,
      payload: row.payload,
      revision: row.revision,
      schemaVersion: 1,
      tombstone: row.tombstone,
      tripId: row.trip_id,
      updatedAt: row.updated_at,
    })
  } catch (error) {
    if (error instanceof AccountCloudContractError || error instanceof TypeError) {
      throw new AccountCloudTransportError('invalid_response', true)
    }
    throw error
  }
}

function readStrictDatabaseRow(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid account object database row.')
  }
  const row = input as Record<string, unknown>
  const fields = Object.keys(row)
  if (
    fields.length !== ACCOUNT_OBJECT_ROW_FIELDS.size
    || fields.some((field) => !ACCOUNT_OBJECT_ROW_FIELDS.has(field))
    || [...ACCOUNT_OBJECT_ROW_FIELDS].some((field) => !Object.hasOwn(row, field))
  ) {
    throw new TypeError('Unexpected account object database fields.')
  }
  return row
}

function assertAccountContext(expectedAccountHash: string | null): asserts expectedAccountHash is string {
  if (
    !expectedAccountHash
    || !ACCOUNT_HASH.test(expectedAccountHash)
    || getActiveAccountHash() !== expectedAccountHash
  ) {
    throw new AccountCloudTransportError('authentication_required', false)
  }
}

async function assertAuthenticatedAccount(
  client: SupabaseClient,
  expectedAccountHash: string,
) {
  let response: Awaited<ReturnType<SupabaseClient['auth']['getUser']>>
  try {
    response = await client.auth.getUser()
  } catch {
    throw new AccountCloudTransportError('request_failed', true)
  }
  if (response.error) {
    const status = response.error.status ?? 0
    if (status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429) {
      throw new AccountCloudTransportError('authentication_required', false)
    }
    throw normalizeAccountCloudError(response.error)
  }
  const userId = response.data.user?.id
  let authenticatedAccountHash: string
  try {
    authenticatedAccountHash = userId ? await hashAccountStorageScopeId(userId) : ''
  } catch {
    throw new AccountCloudTransportError('authentication_required', false)
  }
  if (authenticatedAccountHash !== expectedAccountHash) {
    throw new AccountCloudTransportError('authentication_required', false)
  }
  assertAccountContext(expectedAccountHash)
}

function readBoundedOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new AccountCloudTransportError('invalid_response', false)
  }
  return resolved
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}
