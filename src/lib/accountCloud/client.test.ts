import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearActiveAccountStorageScope,
  setActiveAccountStorageScope,
} from '../accountStorageScope'
import {
  AccountCloudTransportError,
  commitAccountObjectMutationV1,
  createAccountObjectMutationId,
} from './client'
import type { AccountObjectMutationV1 } from './contract'

const MUTATION_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_HASH = '0123456789abcdef0123456789abcdef'
const NOW = '2026-08-11T09:30:00.000Z'

beforeEach(() => setActiveAccountStorageScope(ACCOUNT_HASH))
afterEach(() => clearActiveAccountStorageScope())

describe('account cloud client', () => {
  it('sends only the registered RPC arguments and never sends owner or actor IDs', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: makeAppliedResult(), error: null })
    const result = await commitAccountObjectMutationV1(makeMutation(), makeClient(rpc))

    expect(result.status).toBe('applied')
    expect(rpc).toHaveBeenCalledWith('account_apply_object_mutation_v1', {
      target_account_hash: ACCOUNT_HASH,
      target_device_id: 'device_primary',
      target_expected_revision: 0,
      target_mutation_id: MUTATION_ID,
      target_object_id: 'item_first',
      target_object_schema_version: 1,
      target_object_type: 'item',
      target_operation: 'upsert',
      target_payload: makePayload(),
      target_schema_version: 1,
      target_trip_id: 'trip_uk',
    })
    const sent = rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(sent).not.toHaveProperty('owner_id')
    expect(sent).not.toHaveProperty('actor_id')
    expect(sent).not.toHaveProperty('function_name')
    expect(sent).not.toHaveProperty('route')
  })

  it('replays one mutation 100 times without producing a second modeled write', async () => {
    let writes = 0
    let receipt: string | null = null
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      const serialized = JSON.stringify(args)
      if (receipt === null) {
        receipt = serialized
        writes += 1
        return { data: makeAppliedResult(), error: null }
      }
      expect(serialized).toBe(receipt)
      return {
        data: { ...makeAppliedResult(), status: 'idempotent' },
        error: null,
      }
    })
    const client = makeClient(rpc)

    const results = []
    for (let attempt = 0; attempt < 100; attempt += 1) {
      results.push(await commitAccountObjectMutationV1(makeMutation(), client))
    }

    expect(writes).toBe(1)
    expect(rpc).toHaveBeenCalledTimes(100)
    expect(results.filter((result) => result.status === 'applied')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'idempotent')).toHaveLength(99)
  })

  it('rejects response substitution across trips or objects', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: makeAppliedResult({ object: makeRow({ objectId: 'item_other' }) }),
      error: null,
    })
    await expect(commitAccountObjectMutationV1(makeMutation(), makeClient(rpc))).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: true,
    })
  })

  it('rejects an inconsistent idempotent replay revision', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...makeAppliedResult(),
        currentRevision: 2,
        status: 'idempotent',
      },
      error: null,
    })
    await expect(commitAccountObjectMutationV1(makeMutation(), makeClient(rpc))).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: true,
    })
  })

  it('normalizes permission, unavailable, and transient errors without exposing raw messages', async () => {
    await expect(commitWithError({ code: '42501', message: 'raw policy detail' })).rejects.toMatchObject({
      code: 'permission_denied',
      message: 'Account cloud permission was denied.',
      retryable: false,
    })
    await expect(commitWithError({ code: 'PGRST202', message: 'raw function detail' })).rejects.toMatchObject({
      code: 'contract_unavailable',
      retryable: false,
    })
    await expect(commitWithError({ code: '40001', message: 'raw serialization detail' })).rejects.toMatchObject({
      code: 'request_failed',
      retryable: true,
    })
  })

  it('keeps malformed post-commit data replayable with the same mutation ID', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { mutationId: MUTATION_ID, status: 'ran_arbitrary_function' },
      error: null,
    })
    await expect(commitAccountObjectMutationV1(makeMutation(), makeClient(rpc))).rejects.toEqual(
      new AccountCloudTransportError('invalid_response', true),
    )
  })

  it('treats thrown fetch failures and unknown server errors as replayable', async () => {
    const thrownRpc = vi.fn().mockRejectedValue(new TypeError('network detail'))
    await expect(commitAccountObjectMutationV1(makeMutation(), makeClient(thrownRpc)))
      .rejects.toEqual(new AccountCloudTransportError('request_failed', true))
    await expect(commitWithError({ code: '', message: 'gateway detail', status: 503 }))
      .rejects.toEqual(new AccountCloudTransportError('request_failed', true))
  })

  it('creates only UUID mutation IDs', () => {
    expect(createAccountObjectMutationId(() => MUTATION_ID)).toBe(MUTATION_ID)
    expect(() => createAccountObjectMutationId(() => 'not-a-uuid')).toThrow()
  })
})

function makeMutation(): AccountObjectMutationV1 {
  return {
    deviceId: 'device_primary',
    expectedRevision: 0,
    mutationId: MUTATION_ID,
    objectId: 'item_first',
    objectSchemaVersion: 1,
    objectType: 'item',
    operation: 'upsert',
    payload: makePayload(),
    schemaVersion: 1,
    tripId: 'trip_uk',
  }
}

function makePayload() {
  return {
    createdAt: 1,
    dayId: 'day_first',
    id: 'item_first',
    sortOrder: 0,
    ticketIds: [],
    title: 'Arrival',
    tripId: 'trip_uk',
    updatedAt: 1,
  }
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    actorId: ACTOR_ID,
    createdAt: NOW,
    deletedAt: null,
    deviceId: 'device_primary',
    mutationId: MUTATION_ID,
    objectId: 'item_first',
    objectSchemaVersion: 1,
    objectType: 'item',
    payload: makePayload(),
    revision: 1,
    schemaVersion: 1,
    tombstone: false,
    tripId: 'trip_uk',
    updatedAt: NOW,
    ...overrides,
  }
}

function makeAppliedResult(overrides: Record<string, unknown> = {}) {
  return {
    appliedRevision: 1,
    currentRevision: 1,
    mutationId: MUTATION_ID,
    object: makeRow(),
    schemaVersion: 1,
    status: 'applied',
    ...overrides,
  }
}

function makeClient(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient
}

function commitWithError(error: { code: string; message: string; status?: number }) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error })
  return commitAccountObjectMutationV1(makeMutation(), makeClient(rpc))
}
