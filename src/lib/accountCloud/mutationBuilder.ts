import {
  ACCOUNT_CLOUD_SCHEMA_VERSION,
  parseAccountObjectMutationV1,
  type AccountObjectMutationV1,
  type ClientMutableAccountObjectType,
  type JsonObject,
} from './contract'
import type { AccountObjectPayload } from './models'
import type { TicketMeta } from '../../types'
import { redactTicketMetaForAccountCloud } from './ticketMetadata'

export { redactTicketMetaForAccountCloud } from './ticketMetadata'

type BuildMutationOptions = {
  deviceId: string
  expectedRevision: number
  mutationId: string
  objectSchemaVersion?: number
  tripId: string
}

export function buildAccountObjectUpsertMutation<
  T extends ClientMutableAccountObjectType,
>(
  objectType: T,
  payload: AccountObjectPayload<T>,
  options: BuildMutationOptions,
): AccountObjectMutationV1 {
  const boundedPayload = objectType === 'ticket_meta'
    ? redactTicketMetaForAccountCloud(payload as TicketMeta)
    : payload
  return parseAccountObjectMutationV1({
    deviceId: options.deviceId,
    expectedRevision: options.expectedRevision,
    mutationId: options.mutationId,
    objectId: boundedPayload.id,
    objectSchemaVersion: options.objectSchemaVersion ?? 1,
    objectType,
    operation: 'upsert',
    payload: toPlainJsonObject(boundedPayload),
    schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
    tripId: options.tripId,
  })
}

export function buildAccountObjectDeleteMutation(
  objectType: ClientMutableAccountObjectType,
  objectId: string,
  options: BuildMutationOptions,
): AccountObjectMutationV1 {
  return parseAccountObjectMutationV1({
    deviceId: options.deviceId,
    expectedRevision: options.expectedRevision,
    mutationId: options.mutationId,
    objectId,
    objectSchemaVersion: options.objectSchemaVersion ?? 1,
    objectType,
    operation: 'delete',
    schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
    tripId: options.tripId,
  })
}

function toPlainJsonObject(value: object): JsonObject {
  const serialized = JSON.stringify(value)
  if (!serialized) throw new TypeError('Account object is not JSON serializable.')
  return JSON.parse(serialized) as JsonObject
}
