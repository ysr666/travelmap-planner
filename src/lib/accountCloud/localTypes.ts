import type {
  AccountObjectMutationOperation,
  AccountObjectRowV1,
  ClientMutableAccountObjectType,
  JsonObject,
} from './contract'

export type AccountMutationJournalStatus =
  | 'blocked_auth'
  | 'blocked_contract'
  | 'conflict'
  | 'inflight'
  | 'pending'
  | 'retry'

export type AccountMutationLocalErrorCode =
  | 'authentication_required'
  | 'contract_unavailable'
  | 'invalid_response'
  | 'permission_denied'
  | 'request_failed'
  | 'server_rejected'
  | 'server_conflict'
  | 'local_state_changed'

export type AccountMutationOptimisticResolution = 'rolled_back' | 'stale_local'

export type AccountObjectRevisionRecord = {
  objectKey: string
  tripId: string
  objectType: ClientMutableAccountObjectType
  objectId: string
  payload: JsonObject | null
  objectSchemaVersion: number
  revision: number
  mutationId: string
  actorId: string
  deviceId: string
  tombstone: boolean
  deletedAt: string | null
  serverCreatedAt: string
  serverUpdatedAt: string
  acknowledgedAt: number
  updatedAt: number
}

export type AccountMutationJournalEntry = {
  accountHash: string
  mutationId: string
  requestFingerprint: string
  tripId: string
  objectKey: string
  objectType: ClientMutableAccountObjectType
  objectId: string
  operation: AccountObjectMutationOperation
  expectedRevision: number
  objectSchemaVersion: number
  deviceId: string
  payload?: JsonObject
  optimisticAfter?: JsonObject
  optimisticBefore?: JsonObject | null
  optimisticResolution?: AccountMutationOptimisticResolution
  status: AccountMutationJournalStatus
  attempts: number
  leaseExpiresAt?: number
  leaseToken?: string
  retryAt?: number
  lastErrorCode?: AccountMutationLocalErrorCode
  conflictObject?: AccountObjectRowV1 | null
  createdAt: number
  updatedAt: number
}
