import type { AccountMutationLocalErrorCode } from './localTypes'
import type {
  AccountWorkflowConflictV1,
  AccountWorkflowId,
  AccountWorkflowRequestV1,
} from './workflowContract'
import type {
  ClientMutableAccountObjectType,
  JsonObject,
} from './contract'

export type AccountWorkflowJournalStatus =
  | 'blocked_auth'
  | 'blocked_contract'
  | 'conflict'
  | 'inflight'
  | 'pending'
  | 'retry'

export type AccountWorkflowOptimisticResolution = 'rolled_back' | 'stale_local'

export type AccountWorkflowLocalSnapshotV1 = {
  stepId: string
  objectKey: string
  objectType: ClientMutableAccountObjectType
  objectId: string
  before: JsonObject | null
}

export type AccountWorkflowJournalEntry = {
  accountHash: string
  attempts: number
  batchMutationId: string
  conflicts?: AccountWorkflowConflictV1[]
  createdAt: number
  deviceId: string
  lastErrorCode?: AccountMutationLocalErrorCode
  leaseExpiresAt?: number
  leaseToken?: string
  objectKeys: string[]
  optimisticResolution?: AccountWorkflowOptimisticResolution
  request: AccountWorkflowRequestV1
  requestFingerprint: string
  retryAt?: number
  serverAcknowledgedAt?: number
  snapshots: AccountWorkflowLocalSnapshotV1[]
  status: AccountWorkflowJournalStatus
  tripId: string
  updatedAt: number
  workflowId: AccountWorkflowId
}
