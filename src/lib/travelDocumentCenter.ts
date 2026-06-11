import { db } from '../db/database'
import { createId } from '../db/ids'
import type {
  BookingSecretData,
  DocumentTripLinkData,
  ExternalAction,
  TransportBooking,
  TransportSegment,
  TravelDocumentData,
  TravelerProfileData,
  VaultAttachmentMetadataData,
  VaultBlobRecord,
  VaultObjectPayload,
  VaultObjectRecord,
  VaultObjectType,
} from '../types'
import {
  createVaultKeyState,
  decryptVaultBlob,
  decryptVaultObject,
  encryptVaultBlob,
  encryptVaultObject,
  isVaultUnlocked,
  lockVault,
  unlockVaultKey,
} from './vaultCrypto'
import { cancelRemindersForObject } from './travelReminders'

export type DecryptedVaultObject<T extends VaultObjectPayload> = {
  id: string
  data: T
  createdAt: number
  updatedAt: number
}

export async function getTravelVaultState() {
  return db.vaultKeyState.orderBy('updatedAt').last()
}

export async function initializeTravelVault(passphrase: string, ownerId = getLocalVaultOwnerId()) {
  const existing = await getTravelVaultState()
  if (existing) throw new Error('旅行资料库已经建立，请直接解锁。')
  const state = await createVaultKeyState({ ownerId, passphrase, vaultId: createId('vault') })
  await db.vaultKeyState.add(state)
  return state
}

export async function unlockTravelVault(passphrase: string) {
  const state = await getRequiredVaultState()
  await unlockVaultKey(state, passphrase)
  return state
}

export async function lockTravelVault() {
  const state = await getTravelVaultState()
  if (state) lockVault(state.vaultId)
}

export async function getTravelVaultStatus() {
  const state = await getTravelVaultState()
  return { exists: Boolean(state), unlocked: Boolean(state && isVaultUnlocked(state.vaultId)), vaultId: state?.vaultId }
}

export async function createTravelerProfile(data: TravelerProfileData) {
  validateTraveler(data)
  return createEncryptedObject('traveler', data, 'traveler')
}

export async function listTravelerProfiles() {
  return listEncryptedObjects<TravelerProfileData>('traveler')
}

export async function createTravelDocument(data: TravelDocumentData) {
  validateDocument(data)
  return createEncryptedObject('document', data, 'document')
}

export async function updateTravelDocument(id: string, data: TravelDocumentData) {
  validateDocument(data)
  return updateEncryptedObject(id, 'document', data)
}

export async function listTravelDocuments() {
  return listEncryptedObjects<TravelDocumentData>('document')
}

export async function deleteTravelDocument(id: string) {
  const state = await getRequiredUnlockedVaultState()
  const blobs = await db.vaultBlobs.where('objectId').equals(id).toArray()
  const blobIds = blobs.map((item) => item.id)
  const attachmentMetadata = await listEncryptedObjects<VaultAttachmentMetadataData>('attachment_metadata')
  const attachmentMetadataIds = attachmentMetadata.filter((item) => blobIds.includes(item.data.blobId)).map((item) => item.id)
  const links = await listEncryptedObjects<DocumentTripLinkData>('document_trip_link')
  const linkIds = links.filter((link) => link.data.documentId === id).map((link) => link.id)
  const deletedAt = Date.now()
  await db.transaction('rw', db.vaultObjects, db.vaultBlobs, db.travelCenterTombstones, async () => {
    await db.vaultObjects.bulkDelete([id, ...linkIds, ...attachmentMetadataIds])
    if (blobIds.length > 0) await db.vaultBlobs.bulkDelete(blobIds)
    await db.travelCenterTombstones.bulkPut([
      makeTombstone('vault_object', id, deletedAt, { vaultId: state.vaultId }),
      ...linkIds.map((linkId) => makeTombstone('vault_object', linkId, deletedAt, { vaultId: state.vaultId })),
      ...attachmentMetadataIds.map((metadataId) => makeTombstone('vault_object', metadataId, deletedAt, { vaultId: state.vaultId })),
      ...blobIds.map((blobId) => makeTombstone('vault_blob', blobId, deletedAt, { vaultId: state.vaultId })),
    ])
  })
  await cancelRemindersForObject(id)
}

export function linkDocumentToTrip(documentId: string, tripId: string, notes?: string) {
  return createEncryptedObject('document_trip_link', { documentId, notes, tripId }, 'document_link')
}

export async function listDocumentTripLinks() {
  return listEncryptedObjects<DocumentTripLinkData>('document_trip_link')
}

export async function addDocumentAttachment(documentId: string, file: File) {
  const state = await getRequiredUnlockedVaultState()
  const id = createId('vault_file')
  const record = await encryptVaultBlob({
    blob: file,
    id,
    objectId: documentId,
    state,
  })
  const metadata = await encryptVaultObject({
    id: createId('attachment_metadata'),
    objectType: 'attachment_metadata',
    payload: { blobId: id, fileName: file.name, mimeType: file.type || 'application/octet-stream', objectId: documentId, size: file.size },
    state,
  })
  await db.transaction('rw', db.vaultBlobs, db.vaultObjects, async () => {
    await db.vaultBlobs.add(record)
    await db.vaultObjects.add(metadata)
  })
  return record
}

export async function listDocumentAttachments(documentId: string) {
  return db.vaultBlobs.where('objectId').equals(documentId).toArray()
}

export async function openDocumentAttachment(id: string) {
  const [record, state] = await Promise.all([db.vaultBlobs.get(id), getRequiredUnlockedVaultState()])
  if (!record) throw new Error('没有找到这个加密附件。')
  const metadata = (await listEncryptedObjects<VaultAttachmentMetadataData>('attachment_metadata')).find((item) => item.data.blobId === id)
  return decryptVaultBlob(metadata ? { ...record, fileName: metadata.data.fileName, mimeType: metadata.data.mimeType, size: metadata.data.size } : record, state)
}

export async function createTransportBooking({
  booking,
  segments,
  secret,
}: {
  booking: Omit<TransportBooking, 'id' | 'createdAt' | 'updatedAt' | 'secretObjectId'>
  segments: Array<Omit<TransportSegment, 'id' | 'bookingId' | 'tripId' | 'sortOrder' | 'createdAt' | 'updatedAt'>>
  secret?: Omit<BookingSecretData, 'bookingId'>
}) {
  if (!booking.title.trim()) throw new Error('请填写交通订单名称。')
  if (segments.length === 0) throw new Error('交通订单至少需要一个行程段。')
  const now = Date.now()
  const bookingId = createId('booking')
  let secretRecord: VaultObjectRecord | undefined
  if (secret) {
    const state = await getRequiredUnlockedVaultState()
    secretRecord = await encryptVaultObject({
      id: createId('booking_secret'),
      objectType: 'booking_secret',
      payload: { ...secret, bookingId },
      state,
    })
  }
  const nextBooking: TransportBooking = {
    ...booking,
    createdAt: now,
    id: bookingId,
    secretObjectId: secretRecord?.id,
    updatedAt: now,
  }
  const nextSegments: TransportSegment[] = segments.map((segment, index) => ({
    ...segment,
    bookingId,
    createdAt: now,
    id: createId('segment'),
    sortOrder: index,
    tripId: booking.tripId,
    updatedAt: now,
  }))
  await db.transaction('rw', db.transportBookings, db.transportSegments, db.vaultObjects, async () => {
    await db.transportBookings.add(nextBooking)
    await db.transportSegments.bulkAdd(nextSegments)
    if (secretRecord) await db.vaultObjects.add(secretRecord)
  })
  return { booking: nextBooking, segments: nextSegments }
}

export async function listTransportBookings(tripId?: string) {
  const bookings = tripId
    ? await db.transportBookings.where('tripId').equals(tripId).toArray()
    : await db.transportBookings.toArray()
  return bookings.sort((left, right) => right.updatedAt - left.updatedAt)
}

export function listTransportSegments(bookingId: string) {
  return db.transportSegments.where('[bookingId+sortOrder]').between([bookingId, -Infinity], [bookingId, Infinity]).toArray()
}

export async function getBookingSecret(booking: TransportBooking) {
  if (!booking.secretObjectId) return undefined
  const object = await getDecryptedObject<BookingSecretData>(booking.secretObjectId, 'booking_secret')
  return object?.data
}

export async function deleteTransportBooking(bookingId: string) {
  const booking = await db.transportBookings.get(bookingId)
  const segmentIds = (await db.transportSegments.where('bookingId').equals(bookingId).toArray()).map((item) => item.id)
  const ticketIds = (await db.ticketMetas.where('bookingId').equals(bookingId).toArray()).map((item) => item.id)
  const deletedAt = Date.now()
  await db.transaction('rw', [db.transportBookings, db.transportSegments, db.vaultObjects, db.ticketMetas, db.travelCenterTombstones], async () => {
    await db.transportBookings.delete(bookingId)
    if (segmentIds.length > 0) await db.transportSegments.bulkDelete(segmentIds)
    if (booking?.secretObjectId) await db.vaultObjects.delete(booking.secretObjectId)
    await Promise.all(ticketIds.map((ticketId) => db.ticketMetas.update(ticketId, { bookingId: undefined })))
    await db.travelCenterTombstones.bulkPut([
      makeTombstone('transport_booking', bookingId, deletedAt, { tripId: booking?.tripId }),
      ...segmentIds.map((segmentId) => makeTombstone('transport_segment', segmentId, deletedAt, { tripId: booking?.tripId })),
      ...(booking?.secretObjectId ? [makeTombstone('vault_object', booking.secretObjectId, deletedAt)] : []),
    ])
  })
  await cancelRemindersForObject(bookingId)
}

export function isDuplicateTransportBooking(
  candidate: Pick<TransportSegment, 'carrier' | 'serviceNumber' | 'departureDate' | 'departurePlace' | 'arrivalPlace'>,
  existing: TransportSegment[],
) {
  const normalize = (value: string | undefined) => value?.trim().toLocaleLowerCase() ?? ''
  return existing.some((segment) =>
    normalize(segment.carrier) === normalize(candidate.carrier) &&
    normalize(segment.serviceNumber) === normalize(candidate.serviceNumber) &&
    segment.departureDate === candidate.departureDate &&
    normalize(segment.departurePlace) === normalize(candidate.departurePlace) &&
    normalize(segment.arrivalPlace) === normalize(candidate.arrivalPlace),
  )
}

export function isSafeExternalAction(action: Pick<ExternalAction, 'url'>) {
  try {
    return new URL(action.url).protocol === 'https:'
  } catch {
    return false
  }
}

export async function encryptExistingTicketAsDocument({
  document,
  ticketId,
}: {
  document: Omit<TravelDocumentData, 'attachmentIds'>
  ticketId: string
}) {
  const ticket = await db.ticketMetas.get(ticketId)
  if (!ticket) throw new Error('没有找到待迁移票据。')
  const blobRecord = await db.ticketBlobs.get(ticketId)
  const object = await createTravelDocument({ ...document, attachmentIds: [] })
  let attachment: VaultBlobRecord | undefined
  if (blobRecord) {
    attachment = await addDocumentAttachment(object.id, new File([blobRecord.blob], ticket.fileName, { type: ticket.mimeType }))
    await updateTravelDocument(object.id, { ...object.data, attachmentIds: [attachment.id] })
  }
  return { attachment, documentId: object.id, sourceTicket: ticket }
}

async function createEncryptedObject<T extends VaultObjectPayload>(objectType: VaultObjectType, payload: T, prefix: string) {
  const state = await getRequiredUnlockedVaultState()
  const record = await encryptVaultObject({ id: createId(prefix), objectType, payload, state })
  await db.vaultObjects.add(record)
  return { createdAt: record.createdAt, data: payload, id: record.id, updatedAt: record.updatedAt }
}

async function updateEncryptedObject<T extends VaultObjectPayload>(id: string, objectType: VaultObjectType, payload: T) {
  const [existing, state] = await Promise.all([db.vaultObjects.get(id), getRequiredUnlockedVaultState()])
  if (!existing || existing.objectType !== objectType) throw new Error('没有找到要更新的加密资料。')
  const record = await encryptVaultObject({ createdAt: existing.createdAt, id, objectType, payload, state })
  await db.vaultObjects.put(record)
  return { createdAt: record.createdAt, data: payload, id, updatedAt: record.updatedAt }
}

async function listEncryptedObjects<T extends VaultObjectPayload>(objectType: VaultObjectType) {
  const state = await getRequiredUnlockedVaultState()
  const records = await db.vaultObjects.where('[vaultId+objectType]').equals([state.vaultId, objectType]).toArray()
  return Promise.all(records.map(async (record) => ({
    createdAt: record.createdAt,
    data: await decryptVaultObject<T>(record, state),
    id: record.id,
    updatedAt: record.updatedAt,
  })))
}

async function getDecryptedObject<T extends VaultObjectPayload>(id: string, objectType: VaultObjectType) {
  const [record, state] = await Promise.all([db.vaultObjects.get(id), getRequiredUnlockedVaultState()])
  if (!record || record.objectType !== objectType) return undefined
  return { createdAt: record.createdAt, data: await decryptVaultObject<T>(record, state), id, updatedAt: record.updatedAt }
}

async function getRequiredVaultState() {
  const state = await getTravelVaultState()
  if (!state) throw new Error('请先建立旅行资料库。')
  return state
}

async function getRequiredUnlockedVaultState() {
  const state = await getRequiredVaultState()
  if (!isVaultUnlocked(state.vaultId)) throw new Error('请先解锁旅行资料库。')
  return state
}

function validateTraveler(data: TravelerProfileData) {
  if (!data.displayName.trim()) throw new Error('请填写旅客显示名称。')
}

function validateDocument(data: TravelDocumentData) {
  if (!data.title.trim()) throw new Error('请填写证件名称。')
  if (data.maxStayDays !== undefined && (!Number.isInteger(data.maxStayDays) || data.maxStayDays <= 0)) {
    throw new Error('最长停留天数必须是正整数。')
  }
  if (data.officialUrl && !isSafeExternalAction({ url: data.officialUrl })) throw new Error('官方链接必须使用 HTTPS。')
}

function getLocalVaultOwnerId() {
  const key = 'tripmap:vault-owner-id'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const next = createId('owner')
  localStorage.setItem(key, next)
  return next
}

function makeTombstone(
  objectType: 'transport_booking' | 'transport_segment' | 'vault_object' | 'vault_blob',
  objectId: string,
  deletedAt: number,
  context: { tripId?: string; vaultId?: string } = {},
) {
  return {
    ...context,
    deletedAt,
    objectId,
    objectKey: `${objectType}:${objectId}`,
    objectType,
  } as const
}
