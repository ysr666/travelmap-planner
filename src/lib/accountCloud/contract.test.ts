import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_OBJECT_TYPES,
  AccountCloudContractError,
  parseAccountObjectMutationResultV1,
  parseAccountObjectMutationV1,
} from './contract'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-08-11T09:30:00.000Z'

describe('account cloud mutation contract', () => {
  it('accepts a strict client-mutable upsert envelope', () => {
    expect(parseAccountObjectMutationV1(makeMutation())).toEqual(makeMutation())
  })

  it('returns a canonical payload copy that cannot be changed through the input reference', () => {
    const input = makeMutation()
    const parsed = parseAccountObjectMutationV1(input)
    const inputPayload = input.payload as Record<string, unknown>
    inputPayload.title = 'Changed after validation'
    expect(parsed.payload?.title).toBe('Arrival')
  })

  it('accepts delete without a payload', () => {
    const mutation = makeMutation({ operation: 'delete' })
    delete (mutation as { payload?: unknown }).payload
    expect(parseAccountObjectMutationV1(mutation)).toEqual(mutation)
  })

  it.each(['media_asset', 'realtime_fact', 'ai_job'] as const)(
    'rejects client writes to server-managed %s objects',
    (objectType) => {
      expectContractError(() => parseAccountObjectMutationV1(makeMutation({ objectType })), 'server_managed_object')
    },
  )

  it('rejects unknown envelope fields and object types', () => {
    expectContractError(
      () => parseAccountObjectMutationV1({ ...makeMutation(), ownerId: UUID_A }),
      'unknown_field',
    )
    expectContractError(
      () => parseAccountObjectMutationV1({ ...makeMutation(), objectType: 'run_any_function' }),
      'unknown_object_type',
    )
  })

  it.each(['ownerId', 'actorId', 'mutationId', 'revision', 'tombstone', 'deletedAt'])(
    'rejects payload attempts to forge the %s envelope field',
    (field) => {
      expectContractError(
        () => parseAccountObjectMutationV1(makeMutation({ payload: { ...makePayload(), [field]: 'forged' } })),
        'sensitive_payload',
      )
    },
  )

  it.each([
    ['accessToken', 'token-value'],
    ['provider_key', 'provider-value'],
    ['ocrText', 'private document body'],
    ['passport_number', 'private number'],
    ['rawProviderPayload', { upstream: true }],
  ])('rejects nested sensitive field %s', (field, value) => {
    expectContractError(
      () => parseAccountObjectMutationV1(makeMutation({
        payload: { ...makePayload(), nested: { safe: { [field]: value } } },
      })),
      'sensitive_payload',
    )
  })

  it('rejects mismatched object and trip identities', () => {
    expectContractError(
      () => parseAccountObjectMutationV1(makeMutation({ payload: { ...makePayload(), id: 'item_other' } })),
      'invalid_payload',
    )
    expectContractError(
      () => parseAccountObjectMutationV1(makeMutation({ payload: { ...makePayload(), tripId: 'trip_other' } })),
      'invalid_payload',
    )
  })

  it('rejects invalid item day, order, and ticket relationship fields', () => {
    for (const payload of [
      { ...makePayload(), dayId: 'invalid day' },
      { ...makePayload(), sortOrder: -1 },
      { ...makePayload(), sortOrder: 1.5 },
      { ...makePayload(), ticketIds: ['ticket_a', 'ticket_a'] },
      { ...makePayload(), ticketIds: ['invalid ticket'] },
    ]) {
      expectContractError(
        () => parseAccountObjectMutationV1(makeMutation({ payload })),
        'sensitive_payload',
      )
    }
  })

  it('accepts only bounded redacted Ticket metadata with a consistent item scope', () => {
    const valid = makeMutation({
      objectId: 'ticket_first',
      objectType: 'ticket_meta',
      payload: makeTicketPayload(),
    })
    expect(parseAccountObjectMutationV1(valid)).toEqual(valid)

    const ticketWithoutItem = makeTicketPayload()
    Reflect.deleteProperty(ticketWithoutItem, 'itemId')
    for (const payload of [
      ticketWithoutItem,
      { ...makeTicketPayload(), scope: 'trip' },
      { ...makeTicketPayload(), fileType: 'html' },
      { ...makeTicketPayload(), mimeType: 'application/pdf\nsecret' },
      { ...makeTicketPayload(), size: -1 },
      { ...makeTicketPayload(), updatedAt: 0 },
      { ...makeTicketPayload(), storageMode: 'indexeddb' },
      { ...makeTicketPayload(), ticketCategory: 'attraction' },
      { ...makeTicketPayload(), sharedVisibility: { mode: 'assigned', memberIds: ['member_a', 'member_a'] } },
      { ...makeTicketPayload(), sharedVisibility: { mode: 'all', memberIds: [] } },
      { ...makeTicketPayload(), sharedVisibility: {} },
    ]) {
      expectContractError(
        () => parseAccountObjectMutationV1(makeMutation({
          objectId: 'ticket_first',
          objectType: 'ticket_meta',
          payload,
        })),
        'sensitive_payload',
      )
    }
  })

  it('rejects non-JSON, cyclic, and oversized payloads', () => {
    expectContractError(
      () => parseAccountObjectMutationV1(makeMutation({ payload: { ...makePayload(), invalid: new Date() } })),
      'invalid_payload',
    )

    const cyclic = makePayload() as Record<string, unknown>
    cyclic.loop = cyclic
    expectContractError(
      () => parseAccountObjectMutationV1(makeMutation({ payload: cyclic })),
      'invalid_payload',
    )

    expectContractError(
      () => parseAccountObjectMutationV1(makeMutation({
        payload: { ...makePayload(), notes: 'x'.repeat(512 * 1024) },
      })),
      'invalid_payload',
    )
  })

  it('keeps the TypeScript registry aligned and unique', () => {
    expect(new Set(ACCOUNT_OBJECT_TYPES).size).toBe(22)
  })
})

describe('account cloud result contract', () => {
  it('parses applied and later idempotent results', () => {
    const applied = parseAccountObjectMutationResultV1({
      appliedRevision: 1,
      currentRevision: 1,
      mutationId: UUID_A,
      object: makeRow(),
      schemaVersion: 1,
      status: 'applied',
    })
    expect(applied.status).toBe('applied')

    const idempotent = parseAccountObjectMutationResultV1({
      appliedRevision: 1,
      currentRevision: 2,
      mutationId: UUID_A,
      object: makeRow({ mutationId: UUID_B, revision: 2 }),
      schemaVersion: 1,
      status: 'idempotent',
    })
    expect(idempotent.status).toBe('idempotent')
    if (idempotent.status === 'idempotent') {
      expect(idempotent.currentRevision).toBe(2)
    }
  })

  it('parses conflicts for existing and absent objects', () => {
    expect(parseAccountObjectMutationResultV1({
      currentObject: makeRow(),
      currentRevision: 1,
      mutationId: UUID_A,
      reason: 'revision_mismatch',
      schemaVersion: 1,
      status: 'conflict',
    }).status).toBe('conflict')

    expect(parseAccountObjectMutationResultV1({
      currentObject: null,
      currentRevision: 0,
      mutationId: UUID_A,
      reason: 'revision_mismatch',
      schemaVersion: 1,
      status: 'conflict',
    }).status).toBe('conflict')
  })

  it('parses the registered-workflow-required rejection without exposing server detail', () => {
    expect(parseAccountObjectMutationResultV1({
      mutationId: UUID_A,
      reason: 'workflow_required',
      schemaVersion: 1,
      status: 'rejected',
    })).toEqual({
      mutationId: UUID_A,
      reason: 'workflow_required',
      schemaVersion: 1,
      status: 'rejected',
    })
  })

  it('rejects unknown fields, statuses, and inconsistent tombstones', () => {
    expectContractError(
      () => parseAccountObjectMutationResultV1({
        appliedRevision: 1,
        currentRevision: 1,
        mutationId: UUID_A,
        object: makeRow(),
        providerOutput: 'not allowed',
        schemaVersion: 1,
        status: 'applied',
      }),
      'invalid_response',
    )
    expectContractError(
      () => parseAccountObjectMutationResultV1({
        mutationId: UUID_A,
        schemaVersion: 1,
        status: 'executed_arbitrary_function',
      }),
      'invalid_response',
    )
    expectContractError(
      () => parseAccountObjectMutationResultV1({
        appliedRevision: 1,
        currentRevision: 1,
        mutationId: UUID_A,
        object: makeRow({ deletedAt: NOW, tombstone: true }),
        schemaVersion: 1,
        status: 'applied',
      }),
      'invalid_response',
    )
  })
})

function makeMutation(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 'device_primary',
    expectedRevision: 0,
    mutationId: UUID_A,
    objectId: 'item_first',
    objectSchemaVersion: 1,
    objectType: 'item',
    operation: 'upsert',
    payload: makePayload(),
    schemaVersion: 1,
    tripId: 'trip_uk',
    ...overrides,
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

function makeTicketPayload() {
  return {
    createdAt: 1,
    fileType: 'pdf',
    id: 'ticket_first',
    itemId: 'item_first',
    mimeType: 'application/pdf',
    scope: 'item',
    sharedVisibility: { memberIds: ['member_a'], mode: 'assigned' },
    size: 1024,
    storageMode: 'copy',
    ticketCategory: 'admission_ticket',
    title: 'London admission',
    tripId: 'trip_uk',
    updatedAt: 2,
  }
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    actorId: UUID_A,
    createdAt: NOW,
    deletedAt: null,
    deviceId: 'device_primary',
    mutationId: UUID_A,
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

function expectContractError(run: () => unknown, code: AccountCloudContractError['code']) {
  expect(run).toThrowError(AccountCloudContractError)
  try {
    run()
  } catch (error) {
    expect(error).toMatchObject({ code })
  }
}
