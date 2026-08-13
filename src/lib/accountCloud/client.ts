import type { SupabaseClient } from '@supabase/supabase-js'
import { requireSupabaseClient } from '../supabaseClient'
import { getActiveAccountHash } from '../accountStorageScope'
import {
  AccountCloudContractError,
  parseAccountObjectMutationResultV1,
  parseAccountObjectMutationV1,
  type AccountObjectMutationResultV1,
  type AccountObjectMutationV1,
  type AccountObjectRowV1,
} from './contract'

const APPLY_MUTATION_RPC = 'account_apply_object_mutation_v1'

export type AccountCloudTransportErrorCode =
  | 'authentication_required'
  | 'contract_unavailable'
  | 'invalid_response'
  | 'permission_denied'
  | 'request_failed'

export class AccountCloudTransportError extends Error {
  readonly code: AccountCloudTransportErrorCode
  readonly retryable: boolean

  constructor(code: AccountCloudTransportErrorCode, retryable: boolean) {
    super(messageForTransportError(code))
    this.name = 'AccountCloudTransportError'
    this.code = code
    this.retryable = retryable
  }
}

export async function commitAccountObjectMutationV1(
  input: AccountObjectMutationV1,
  client?: SupabaseClient,
  expectedAccountHash: string | null = getActiveAccountHash(),
): Promise<AccountObjectMutationResultV1> {
  const mutation = parseAccountObjectMutationV1(input)
  if (!expectedAccountHash || !/^[a-f0-9]{32}$/.test(expectedAccountHash)) {
    throw new AccountCloudTransportError('authentication_required', false)
  }
  const transport = client ?? requireAccountCloudClient()
  let response: Awaited<ReturnType<SupabaseClient['rpc']>>
  try {
    response = await transport.rpc(APPLY_MUTATION_RPC, {
      target_account_hash: expectedAccountHash,
      target_device_id: mutation.deviceId,
      target_expected_revision: mutation.expectedRevision,
      target_mutation_id: mutation.mutationId,
      target_object_id: mutation.objectId,
      target_object_schema_version: mutation.objectSchemaVersion,
      target_object_type: mutation.objectType,
      target_operation: mutation.operation,
      target_payload: mutation.payload ?? null,
      target_schema_version: mutation.schemaVersion,
      target_trip_id: mutation.tripId,
    })
  } catch {
    throw new AccountCloudTransportError('request_failed', true)
  }
  const { data, error } = response

  if (error) throw normalizeAccountCloudError(error)

  let result: AccountObjectMutationResultV1
  try {
    result = parseAccountObjectMutationResultV1(data)
  } catch (error) {
    if (error instanceof AccountCloudContractError) {
      throw new AccountCloudTransportError('invalid_response', true)
    }
    throw error
  }
  assertResultMatchesRequest(mutation, result)
  return result
}

export function requireAccountCloudClient() {
  try {
    return requireSupabaseClient()
  } catch {
    throw new AccountCloudTransportError('contract_unavailable', false)
  }
}

export function createAccountObjectMutationId(randomUuid: () => string = defaultRandomUuid) {
  const mutationId = randomUuid()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mutationId)) {
    throw new AccountCloudContractError('invalid_identifier', 'Mutation ID source returned an invalid UUID.')
  }
  return mutationId
}

function assertResultMatchesRequest(
  mutation: AccountObjectMutationV1,
  result: AccountObjectMutationResultV1,
) {
  if (result.mutationId !== mutation.mutationId) {
    throw new AccountCloudTransportError('invalid_response', true)
  }
  if (result.status === 'rejected') return

  const object = result.status === 'conflict' ? result.currentObject : result.object
  if (!object) return
  if (
    object.tripId !== mutation.tripId
    || object.objectType !== mutation.objectType
    || object.objectId !== mutation.objectId
  ) {
    throw new AccountCloudTransportError('invalid_response', true)
  }
  if (result.status === 'applied') {
    if (
      result.appliedRevision !== result.currentRevision
      || result.object.revision !== result.currentRevision
      || result.object.mutationId !== mutation.mutationId
      || !matchesAppliedPayload(mutation, result.object)
    ) {
      throw new AccountCloudTransportError('invalid_response', true)
    }
  }
  if (result.status === 'idempotent' && (
    result.object.revision !== result.currentRevision
    || result.appliedRevision > result.currentRevision
    || (
      result.appliedRevision === result.currentRevision
      && (
        result.object.mutationId !== mutation.mutationId
        || !matchesAppliedPayload(mutation, result.object)
      )
    )
  )) {
    throw new AccountCloudTransportError('invalid_response', true)
  }
  if (result.status === 'conflict' && object.revision !== result.currentRevision) {
    throw new AccountCloudTransportError('invalid_response', true)
  }
}

function matchesAppliedPayload(
  mutation: AccountObjectMutationV1,
  object: AccountObjectRowV1,
) {
  const deleting = mutation.operation === 'delete'
  return object.tombstone === deleting
    && stableStringify(object.payload) === stableStringify(deleting ? null : mutation.payload)
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

export function normalizeAccountCloudError(error: { code?: string; message?: string; status?: number }) {
  const code = error.code ?? ''
  if (error.status === 401 || code === '28000' || code === 'PGRST301') {
    return new AccountCloudTransportError('authentication_required', false)
  }
  if (error.status === 403 || code === '42501') {
    return new AccountCloudTransportError('permission_denied', false)
  }
  if (code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205') {
    return new AccountCloudTransportError('contract_unavailable', false)
  }
  const status = error.status ?? 0
  const retryable = status === 0
    || status === 408
    || status === 425
    || status === 429
    || status >= 500
    || code.startsWith('08')
    || code === '40001'
    || code === '40P01'
    || code === '57014'
    || code === 'PGRST000'
  return new AccountCloudTransportError('request_failed', retryable)
}

function messageForTransportError(code: AccountCloudTransportErrorCode) {
  switch (code) {
    case 'authentication_required':
      return 'Account sign-in is required.'
    case 'contract_unavailable':
      return 'Account cloud contract is unavailable.'
    case 'invalid_response':
      return 'Account cloud returned an invalid response.'
    case 'permission_denied':
      return 'Account cloud permission was denied.'
    case 'request_failed':
      return 'Account cloud request failed.'
  }
}

function defaultRandomUuid() {
  return crypto.randomUUID()
}
