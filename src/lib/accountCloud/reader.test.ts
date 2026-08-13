import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearActiveAccountStorageScope,
  hashAccountStorageScopeId,
  setActiveAccountStorageScope,
} from '../accountStorageScope'
import {
  readAccountTripObjectsV1,
  readStableAccountTripObjectsV1,
} from './reader'

const OTHER_ACCOUNT_HASH = 'ffffffffffffffffffffffffffffffff'
const AUTH_USER_ID = 'reader-account-user'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-08-11T10:00:00.000Z'
let accountHash = ''

beforeEach(async () => {
  accountHash = await hashAccountStorageScopeId(AUTH_USER_ID)
  setActiveAccountStorageScope(accountHash)
})
afterEach(() => clearActiveAccountStorageScope())

describe('account cloud strict reader', () => {
  it('uses a fixed table, projection, filter, ordering, and bounded pagination', async () => {
    const rows = [
      makeDatabaseRow({ object_id: 'day_a', object_type: 'day', payload: makeDayPayload('day_a') }),
      makeDatabaseRow({ object_id: 'item_a', object_type: 'item', payload: makeItemPayload('item_a') }),
      makeDatabaseRow({ object_id: 'trip_uk', object_type: 'trip', payload: makeTripPayload() }),
    ]
    const transport = makeClient([
      { data: rows.slice(0, 2), error: null },
      { data: rows.slice(2), error: null },
    ])

    const result = await readAccountTripObjectsV1('trip_uk', {
      client: transport.client,
      pageSize: 2,
    })

    expect(result.map((row) => `${row.objectType}:${row.objectId}`)).toEqual([
      'day:day_a',
      'item:item_a',
      'trip:trip_uk',
    ])
    expect(transport.from).toHaveBeenCalledTimes(2)
    expect(transport.from).toHaveBeenNthCalledWith(1, 'tripmap_account_objects')
    expect(transport.select).toHaveBeenCalledWith(expect.not.stringContaining('*'))
    expect(transport.select.mock.calls[0]?.[0]).not.toContain('owner_id')
    expect(transport.eq).toHaveBeenCalledWith('trip_id', 'trip_uk')
    expect(transport.order.mock.calls).toEqual([
      ['object_type', { ascending: true }],
      ['object_id', { ascending: true }],
      ['object_type', { ascending: true }],
      ['object_id', { ascending: true }],
    ])
    expect(transport.range.mock.calls).toEqual([[0, 1], [2, 3]])
  })

  it('rejects owner fields, unknown fields, wrong trip rows, and duplicates', async () => {
    await expect(readWithRows([{ ...makeDatabaseRow(), owner_id: ACTOR_ID }]))
      .rejects.toMatchObject({ code: 'invalid_response' })
    await expect(readWithRows([{ ...makeDatabaseRow(), unexpected: true }]))
      .rejects.toMatchObject({ code: 'invalid_response' })
    await expect(readWithRows([makeDatabaseRow({ trip_id: 'trip_other' })]))
      .rejects.toMatchObject({ code: 'invalid_response' })
    await expect(readWithRows([makeDatabaseRow(), makeDatabaseRow()]))
      .rejects.toMatchObject({ code: 'invalid_response' })
    await expect(readWithRows([
      makeDatabaseRow({ object_id: 'item_z', object_type: 'item', payload: makeItemPayload('item_z') }),
      makeDatabaseRow({ object_id: 'item_a', object_type: 'item', payload: makeItemPayload('item_a') }),
    ])).resolves.toHaveLength(2)
  })

  it('rejects malformed rows and oversized or incomplete bounded reads', async () => {
    await expect(readWithRows([makeDatabaseRow({ revision: Number.MAX_SAFE_INTEGER + 1 })]))
      .rejects.toMatchObject({ code: 'invalid_response' })
    await expect(readAccountTripObjectsV1('trip_uk', {
      client: makeClient([{ data: [makeDatabaseRow(), makeDatabaseRow()], error: null }]).client,
      pageSize: 1,
    })).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(readAccountTripObjectsV1('trip_uk', {
      client: makeClient([{ data: [makeDatabaseRow()], error: null }]).client,
      maxPages: 1,
      pageSize: 1,
    })).rejects.toMatchObject({ code: 'invalid_response', retryable: false })
    await expect(readAccountTripObjectsV1('trip_uk', {
      client: makeClient([]).client,
      pageSize: 501,
    })).rejects.toMatchObject({ code: 'invalid_response', retryable: false })
  })

  it('stops if the active account changes while a page is in flight', async () => {
    const transport = makeClient([{ data: [makeDatabaseRow()], error: null }], () => {
      setActiveAccountStorageScope(OTHER_ACCOUNT_HASH)
    })
    await expect(readAccountTripObjectsV1('trip_uk', { client: transport.client }))
      .rejects.toMatchObject({ code: 'authentication_required', retryable: false })
  })

  it('rejects a Supabase session that does not match the active account database', async () => {
    const transport = makeClient(
      [{ data: [makeDatabaseRow()], error: null }],
      undefined,
      'different-auth-user',
    )
    await expect(readAccountTripObjectsV1('trip_uk', { client: transport.client }))
      .rejects.toMatchObject({ code: 'authentication_required', retryable: false })
    expect(transport.from).not.toHaveBeenCalled()
  })

  it('discards a page if the Supabase session changes before the response is accepted', async () => {
    const transport = makeClient([{ data: [makeDatabaseRow()], error: null }])
    transport.getUser
      .mockResolvedValueOnce({ data: { user: { id: AUTH_USER_ID } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: 'different-auth-user' } }, error: null })
    await expect(readAccountTripObjectsV1('trip_uk', { client: transport.client }))
      .rejects.toMatchObject({ code: 'authentication_required', retryable: false })
  })

  it('normalizes table, auth, permission, and transient errors without raw details', async () => {
    await expect(readWithResponse({ data: null, error: { code: '42P01', message: 'raw table detail' } }))
      .rejects.toMatchObject({
        code: 'contract_unavailable',
        message: 'Account cloud contract is unavailable.',
        retryable: false,
      })
    await expect(readWithResponse({ data: null, error: { code: '42501', message: 'raw policy detail' } }))
      .rejects.toMatchObject({ code: 'permission_denied', retryable: false })
    await expect(readWithResponse({ data: null, error: { code: 'PGRST000', message: 'raw network detail' } }))
      .rejects.toMatchObject({ code: 'request_failed', retryable: true })
  })

  it('requires two identical complete reads before returning a stable snapshot', async () => {
    const first = makeDatabaseRow()
    const changed = makeDatabaseRow({ revision: 2, mutation_id: '33333333-3333-4333-8333-333333333333' })
    await expect(readStableAccountTripObjectsV1('trip_uk', {
      client: makeClient([
        { data: [first], error: null },
        { data: [changed], error: null },
      ]).client,
    })).rejects.toMatchObject({ code: 'invalid_response', retryable: true })

    setActiveAccountStorageScope(accountHash)
    await expect(readStableAccountTripObjectsV1('trip_uk', {
      client: makeClient([
        { data: [first], error: null },
        { data: [first], error: null },
      ]).client,
    })).resolves.toHaveLength(1)
  })
})

function readWithRows(rows: unknown[]) {
  return readWithResponse({ data: rows, error: null })
}

function readWithResponse(response: QueryResponse) {
  setActiveAccountStorageScope(accountHash)
  return readAccountTripObjectsV1('trip_uk', { client: makeClient([response]).client })
}

type QueryResponse = {
  data: unknown
  error: { code?: string; message?: string; status?: number } | null
}

function makeClient(
  responses: QueryResponse[],
  beforeResolve?: () => void,
  authUserId = AUTH_USER_ID,
) {
  let responseIndex = 0
  const from = vi.fn()
  const select = vi.fn()
  const eq = vi.fn()
  const order = vi.fn()
  const range = vi.fn(async () => {
    beforeResolve?.()
    return responses[responseIndex++] ?? { data: [], error: null }
  })
  const builder = { eq, order, range, select }
  from.mockReturnValue(builder)
  select.mockReturnValue(builder)
  eq.mockReturnValue(builder)
  order.mockReturnValue(builder)
  const getUser = vi.fn().mockResolvedValue({
    data: { user: { id: authUserId } },
    error: null,
  })
  return {
    client: { auth: { getUser }, from } as unknown as SupabaseClient,
    eq,
    from,
    getUser,
    order,
    range,
    select,
  }
}

function makeDatabaseRow(overrides: Record<string, unknown> = {}) {
  return {
    actor_id: ACTOR_ID,
    created_at: NOW,
    deleted_at: null,
    device_id: 'device_primary',
    mutation_id: '11111111-1111-4111-8111-111111111111',
    object_id: 'trip_uk',
    object_type: 'trip',
    payload: makeTripPayload(),
    revision: 1,
    schema_version: 1,
    tombstone: false,
    trip_id: 'trip_uk',
    updated_at: NOW,
    ...overrides,
  }
}

function makeTripPayload() {
  return {
    createdAt: 1,
    destination: 'London',
    endDate: '2026-07-21',
    id: 'trip_uk',
    startDate: '2026-07-10',
    title: 'UK',
    updatedAt: 1,
  }
}

function makeDayPayload(id: string) {
  return { date: '2026-07-10', id, sortOrder: 0, tripId: 'trip_uk' }
}

function makeItemPayload(id: string) {
  return {
    createdAt: 1,
    dayId: 'day_a',
    id,
    sortOrder: 0,
    ticketIds: [],
    title: 'Arrival',
    tripId: 'trip_uk',
    updatedAt: 1,
  }
}
