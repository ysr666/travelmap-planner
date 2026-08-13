import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveAccountHash } from '../accountStorageScope'
import {
  AccountCloudTransportError,
  normalizeAccountCloudError,
  requireAccountCloudClient,
} from './client'
import {
  assertAccountWorkflowResultMatchesRequest,
  parseAccountWorkflowRequestV1,
  parseAccountWorkflowRunResultV1,
  type AccountWorkflowRequestV1,
  type AccountWorkflowRunResultV1,
} from './workflowContract'

const APPLY_WORKFLOW_RPC = 'account_apply_workflow_v1'
const ACCOUNT_HASH = /^[a-f0-9]{32}$/

export async function commitAccountWorkflowV1(
  input: AccountWorkflowRequestV1,
  client?: SupabaseClient,
  expectedAccountHash: string | null = getActiveAccountHash(),
): Promise<AccountWorkflowRunResultV1> {
  const request = parseAccountWorkflowRequestV1(input)
  assertAccountContext(expectedAccountHash)
  const transport = client ?? requireAccountCloudClient()
  let response: Awaited<ReturnType<SupabaseClient['rpc']>>
  try {
    response = await transport.rpc(APPLY_WORKFLOW_RPC, {
      target_account_hash: expectedAccountHash,
      target_batch_mutation_id: request.batchMutationId,
      target_device_id: request.deviceId,
      target_schema_version: request.schemaVersion,
      target_steps: request.steps,
      target_trip_id: request.tripId,
      target_workflow_id: request.workflowId,
    })
  } catch {
    throw new AccountCloudTransportError('request_failed', true)
  }
  assertAccountContext(expectedAccountHash)
  if (response.error) throw normalizeAccountCloudError(response.error)

  try {
    const result = parseAccountWorkflowRunResultV1(response.data)
    return assertAccountWorkflowResultMatchesRequest(result, request)
  } catch {
    throw new AccountCloudTransportError('invalid_response', true)
  }
}

function assertAccountContext(accountHash: string | null): asserts accountHash is string {
  if (!accountHash || !ACCOUNT_HASH.test(accountHash) || getActiveAccountHash() !== accountHash) {
    throw new AccountCloudTransportError('authentication_required', false)
  }
}
