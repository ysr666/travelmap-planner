import type { SupabaseClient } from '@supabase/supabase-js'
import { requireSupabaseClient } from '../supabaseClient'
import {
  AccountCloudContractError,
  parseAccountObjectMutationResultV1,
  parseAccountObjectMutationV1,
  type AccountObjectMutationResultV1,
  type AccountObjectMutationV1,
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
  client: SupabaseClient = requireSupabaseClient(),
): Promise<AccountObjectMutationResultV1> {
  const mutation = parseAccountObjectMutationV1(input)
  const { data, error } = await client.rpc(APPLY_MUTATION_RPC, {
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

  if (error) throw normalizeRpcError(error)

  let result: AccountObjectMutationResultV1
  try {
    result = parseAccountObjectMutationResultV1(data)
  } catch (error) {
    if (error instanceof AccountCloudContractError) {
      throw new AccountCloudTransportError('invalid_response', false)
    }
    throw error
  }
  assertResultMatchesRequest(mutation, result)
  return result
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
    throw new AccountCloudTransportError('invalid_response', false)
  }
  if (result.status === 'rejected') return

  const object = result.status === 'conflict' ? result.currentObject : result.object
  if (!object) return
  if (
    object.tripId !== mutation.tripId
    || object.objectType !== mutation.objectType
    || object.objectId !== mutation.objectId
  ) {
    throw new AccountCloudTransportError('invalid_response', false)
  }
  if (result.status === 'applied') {
    if (
      result.appliedRevision !== result.currentRevision
      || result.object.revision !== result.currentRevision
      || result.object.mutationId !== mutation.mutationId
    ) {
      throw new AccountCloudTransportError('invalid_response', false)
    }
  }
  if (result.status === 'conflict' && object.revision !== result.currentRevision) {
    throw new AccountCloudTransportError('invalid_response', false)
  }
}

function normalizeRpcError(error: { code?: string; message?: string; status?: number }) {
  const code = error.code ?? ''
  if (error.status === 401 || code === '28000' || code === 'PGRST301') {
    return new AccountCloudTransportError('authentication_required', false)
  }
  if (error.status === 403 || code === '42501') {
    return new AccountCloudTransportError('permission_denied', false)
  }
  if (code === '42883' || code === 'PGRST202') {
    return new AccountCloudTransportError('contract_unavailable', false)
  }
  const retryable = code.startsWith('08') || code === '40001' || code === '40P01' || code === '57014' || code === 'PGRST000'
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
