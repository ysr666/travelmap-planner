import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearActiveAccountStorageScope,
  setActiveAccountStorageScope,
} from '../accountStorageScope'
import { AccountCloudTransportError } from './client'
import { commitAccountWorkflowV1 } from './workflowClient'
import type { AccountWorkflowRequestV1 } from './workflowContract'

const ACCOUNT_HASH = '0123456789abcdef0123456789abcdef'
const OTHER_ACCOUNT_HASH = 'ffffffffffffffffffffffffffffffff'
const BATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MUTATION_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-08-11T12:00:00.000Z'

beforeEach(() => setActiveAccountStorageScope(ACCOUNT_HASH))
afterEach(() => clearActiveAccountStorageScope())

describe('account workflow client', () => {
  it('calls only the fixed registered RPC and excludes owner, actor, function, SQL, and route fields', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: makeSuccess(), error: null })
    await expect(commitAccountWorkflowV1(makeRequest(), makeClient(rpc))).resolves.toMatchObject({
      status: 'applied',
    })

    expect(rpc).toHaveBeenCalledWith('account_apply_workflow_v1', {
      target_account_hash: ACCOUNT_HASH,
      target_batch_mutation_id: BATCH_ID,
      target_device_id: 'device_primary',
      target_schema_version: 1,
      target_steps: makeRequest().steps,
      target_trip_id: 'trip_uk',
      target_workflow_id: 'trip.repair.apply@1',
    })
    const sent = rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(sent).not.toHaveProperty('owner_id')
    expect(sent).not.toHaveProperty('actor_id')
    expect(sent).not.toHaveProperty('function_name')
    expect(sent).not.toHaveProperty('sql')
    expect(sent).not.toHaveProperty('route')
  })

  it('models 100 identical retries as one applied workflow and 99 idempotent receipts', async () => {
    let writes = 0
    let firstRequest = ''
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      const serialized = JSON.stringify(args)
      if (writes === 0) {
        writes += 1
        firstRequest = serialized
        return { data: makeSuccess(), error: null }
      }
      expect(serialized).toBe(firstRequest)
      return { data: { ...makeSuccess(), status: 'idempotent' }, error: null }
    })
    const client = makeClient(rpc)
    const results = []
    for (let attempt = 0; attempt < 100; attempt += 1) {
      results.push(await commitAccountWorkflowV1(makeRequest(), client))
    }
    expect(writes).toBe(1)
    expect(results.filter((result) => result.status === 'applied')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'idempotent')).toHaveLength(99)
  })

  it('rejects response substitution, missing steps, and advanced idempotent receipts', async () => {
    await expect(commitWithResult({ ...makeSuccess(), tripId: 'trip_other' }))
      .rejects.toEqual(new AccountCloudTransportError('invalid_response', true))
    await expect(commitWithResult({ ...makeSuccess(), steps: [] }))
      .rejects.toEqual(new AccountCloudTransportError('invalid_response', true))
    await expect(commitWithResult({
      ...makeSuccess(),
      status: 'idempotent',
      steps: makeSuccess().steps.map((step) => ({
        ...step,
        currentRevision: 3,
        object: { ...step.object, revision: 3 },
      })),
    })).rejects.toEqual(new AccountCloudTransportError('invalid_response', true))
  })

  it('discards a response when the active account changes while the workflow is in flight', async () => {
    const rpc = vi.fn(async () => {
      setActiveAccountStorageScope(OTHER_ACCOUNT_HASH)
      return { data: makeSuccess(), error: null }
    })
    await expect(commitAccountWorkflowV1(makeRequest(), makeClient(rpc)))
      .rejects.toEqual(new AccountCloudTransportError('authentication_required', false))
  })

  it('normalizes auth, permission, missing-contract, transient, and thrown transport errors', async () => {
    await expect(commitWithError({ status: 401 })).rejects.toMatchObject({
      code: 'authentication_required',
      retryable: false,
    })
    await expect(commitWithError({ code: '42501' })).rejects.toMatchObject({
      code: 'permission_denied',
      retryable: false,
    })
    await expect(commitWithError({ code: 'PGRST202' })).rejects.toMatchObject({
      code: 'contract_unavailable',
      retryable: false,
    })
    await expect(commitWithError({ status: 503 })).rejects.toMatchObject({
      code: 'request_failed',
      retryable: true,
    })
    const thrown = vi.fn().mockRejectedValue(new TypeError('raw network detail'))
    await expect(commitAccountWorkflowV1(makeRequest(), makeClient(thrown)))
      .rejects.toEqual(new AccountCloudTransportError('request_failed', true))
  })
})

function commitWithResult(data: unknown) {
  setActiveAccountStorageScope(ACCOUNT_HASH)
  return commitAccountWorkflowV1(
    makeRequest(),
    makeClient(vi.fn().mockResolvedValue({ data, error: null })),
  )
}

function commitWithError(error: { code?: string; status?: number }) {
  setActiveAccountStorageScope(ACCOUNT_HASH)
  return commitAccountWorkflowV1(
    makeRequest(),
    makeClient(vi.fn().mockResolvedValue({ data: null, error })),
  )
}

function makeClient(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient
}

function makeRequest(): AccountWorkflowRequestV1 {
  return {
    batchMutationId: BATCH_ID,
    deviceId: 'device_primary',
    schemaVersion: 1,
    steps: [{
      expectedRevision: 1,
      mutationId: MUTATION_ID,
      objectId: 'item_a',
      objectSchemaVersion: 1,
      objectType: 'item',
      operation: 'upsert',
      payload: makePayload(),
      stepId: 'repair_item',
    }],
    tripId: 'trip_uk',
    workflowId: 'trip.repair.apply@1',
  }
}

function makeSuccess() {
  return {
    batchMutationId: BATCH_ID,
    schemaVersion: 1,
    status: 'applied',
    steps: [{
      appliedRevision: 2,
      currentRevision: 2,
      mutationId: MUTATION_ID,
      object: {
        actorId: ACTOR_ID,
        createdAt: NOW,
        deletedAt: null,
        deviceId: 'device_primary',
        mutationId: MUTATION_ID,
        objectId: 'item_a',
        objectSchemaVersion: 1,
        objectType: 'item',
        payload: makePayload(),
        revision: 2,
        schemaVersion: 1,
        tombstone: false,
        tripId: 'trip_uk',
        updatedAt: NOW,
      },
      stepId: 'repair_item',
    }],
    tripId: 'trip_uk',
    workflowId: 'trip.repair.apply@1',
  }
}

function makePayload() {
  return {
    address: 'London Heathrow Airport',
    createdAt: 1,
    dayId: 'day_a',
    id: 'item_a',
    latitude: 51.47,
    longitude: -0.4543,
    sortOrder: 0,
    ticketIds: [],
    title: 'Arrival',
    tripId: 'trip_uk',
    updatedAt: 2,
  }
}
