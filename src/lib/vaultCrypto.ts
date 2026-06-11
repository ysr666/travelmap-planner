import type {
  VaultBlobRecord,
  VaultKeyState,
  VaultObjectPayload,
  VaultObjectRecord,
  VaultObjectType,
} from '../types'

const AES_KEY_BITS = 256
const AES_GCM_IV_BYTES = 12
const DEFAULT_PBKDF2_ITERATIONS = 310_000
const MAX_VAULT_BLOB_BYTES = 20 * 1024 * 1024
const SCHEMA_VERSION = 1
const AAD_VERSION = 1

const unlockedKeys = new Map<string, CryptoKey>()

export class VaultCryptoError extends Error {
  readonly code: 'locked' | 'invalid_passphrase' | 'invalid_record' | 'file_too_large'

  constructor(message: string, code: 'locked' | 'invalid_passphrase' | 'invalid_record' | 'file_too_large') {
    super(message)
    this.name = 'VaultCryptoError'
    this.code = code
  }
}

export async function createVaultKeyState({
  vaultId,
  ownerId,
  passphrase,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
}: {
  vaultId: string
  ownerId: string
  passphrase: string
  iterations?: number
}): Promise<VaultKeyState> {
  assertPassphrase(passphrase)
  const rawMasterKey = crypto.getRandomValues(new Uint8Array(AES_KEY_BITS / 8))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const wrapIv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES))
  const wrappingKey = await deriveWrappingKey(passphrase, salt, iterations)
  const wrappedKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: wrapIv, additionalData: encodeText(buildKeyAad(vaultId, ownerId)) },
    wrappingKey,
    rawMasterKey,
  )
  const masterKey = await importMasterKey(rawMasterKey)
  unlockedKeys.set(vaultId, masterKey)
  rawMasterKey.fill(0)
  const now = Date.now()
  return {
    createdAt: now,
    keyVersion: 1,
    ownerId,
    pbkdf2Iterations: iterations,
    salt: encodeBase64(salt),
    schemaVersion: SCHEMA_VERSION,
    updatedAt: now,
    vaultId,
    wrapIv: encodeBase64(wrapIv),
    wrappedKey: encodeBase64(new Uint8Array(wrappedKey)),
  }
}

export async function unlockVaultKey(state: VaultKeyState, passphrase: string) {
  assertPassphrase(passphrase)
  try {
    const wrappingKey = await deriveWrappingKey(passphrase, decodeBase64(state.salt), state.pbkdf2Iterations)
    const rawMasterKey = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decodeBase64(state.wrapIv),
        additionalData: encodeText(buildKeyAad(state.vaultId, state.ownerId)),
      },
      wrappingKey,
      decodeBase64(state.wrappedKey),
    )
    const imported = await importMasterKey(new Uint8Array(rawMasterKey))
    unlockedKeys.set(state.vaultId, imported)
    return true
  } catch {
    throw new VaultCryptoError('恢复口令不正确，无法解锁旅行资料库。', 'invalid_passphrase')
  }
}

export function lockVault(vaultId: string) {
  unlockedKeys.delete(vaultId)
}

export function isVaultUnlocked(vaultId: string) {
  return unlockedKeys.has(vaultId)
}

export async function encryptVaultObject({
  id,
  objectType,
  payload,
  state,
  createdAt = Date.now(),
}: {
  id: string
  objectType: VaultObjectType
  payload: VaultObjectPayload
  state: VaultKeyState
  createdAt?: number
}): Promise<VaultObjectRecord> {
  const key = requireUnlockedKey(state.vaultId)
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES))
  const updatedAt = Date.now()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: buildObjectAad(state, id, objectType) },
    key,
    encodeText(JSON.stringify(payload)),
  )
  return {
    aadVersion: AAD_VERSION,
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    createdAt,
    id,
    iv: encodeBase64(iv),
    keyVersion: state.keyVersion,
    objectType,
    schemaVersion: SCHEMA_VERSION,
    updatedAt,
    vaultId: state.vaultId,
  }
}

export async function decryptVaultObject<T extends VaultObjectPayload>(record: VaultObjectRecord, state: VaultKeyState): Promise<T> {
  validateObjectRecord(record, state)
  const key = requireUnlockedKey(state.vaultId)
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeBase64(record.iv), additionalData: buildObjectAad(state, record.id, record.objectType) },
      key,
      decodeBase64(record.ciphertext),
    )
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    throw new VaultCryptoError('加密资料校验失败，内容可能已损坏或被篡改。', 'invalid_record')
  }
}

export async function encryptVaultBlob({
  blob,
  id,
  objectId,
  state,
}: {
  blob: Blob
  id: string
  objectId: string
  state: VaultKeyState
}): Promise<VaultBlobRecord> {
  if (blob.size > MAX_VAULT_BLOB_BYTES) {
    throw new VaultCryptoError('加密附件单个不能超过 20MB。', 'file_too_large')
  }
  const key = requireUnlockedKey(state.vaultId)
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES))
  const now = Date.now()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: buildBlobAad(state, id, objectId) },
    key,
    await blob.arrayBuffer(),
  )
  return {
    aadVersion: AAD_VERSION,
    ciphertext: new Blob([ciphertext], { type: 'application/octet-stream' }),
    createdAt: now,
    fileName: 'encrypted-file',
    id,
    iv: encodeBase64(iv),
    keyVersion: state.keyVersion,
    mimeType: 'application/octet-stream',
    objectId,
    schemaVersion: SCHEMA_VERSION,
    size: blob.size,
    updatedAt: now,
    vaultId: state.vaultId,
  }
}

export async function decryptVaultBlob(record: VaultBlobRecord, state: VaultKeyState) {
  if (record.vaultId !== state.vaultId || record.keyVersion !== state.keyVersion) {
    throw new VaultCryptoError('加密附件不属于当前资料库。', 'invalid_record')
  }
  const key = requireUnlockedKey(state.vaultId)
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeBase64(record.iv), additionalData: buildBlobAad(state, record.id, record.objectId) },
      key,
      await record.ciphertext.arrayBuffer(),
    )
    return new File([plaintext], record.fileName, { type: record.mimeType })
  } catch {
    throw new VaultCryptoError('加密附件校验失败，内容可能已损坏或被篡改。', 'invalid_record')
  }
}

export const VAULT_MAX_FILE_BYTES = MAX_VAULT_BLOB_BYTES

function requireUnlockedKey(vaultId: string) {
  const key = unlockedKeys.get(vaultId)
  if (!key) throw new VaultCryptoError('旅行资料库已锁定。', 'locked')
  return key
}

function validateObjectRecord(record: VaultObjectRecord, state: VaultKeyState) {
  if (
    record.vaultId !== state.vaultId ||
    record.keyVersion !== state.keyVersion ||
    record.schemaVersion !== SCHEMA_VERSION ||
    record.aadVersion !== AAD_VERSION
  ) {
    throw new VaultCryptoError('加密资料版本或归属无效。', 'invalid_record')
  }
}

async function deriveWrappingKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey('raw', encodeText(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: copyArrayBuffer(salt) },
    material,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}

function importMasterKey(raw: Uint8Array) {
  return crypto.subtle.importKey('raw', copyArrayBuffer(raw), { name: 'AES-GCM', length: AES_KEY_BITS }, false, ['encrypt', 'decrypt'])
}

function buildKeyAad(vaultId: string, ownerId: string) {
  return `tripmap:vault-key:${SCHEMA_VERSION}:${vaultId}:${ownerId}`
}

function buildObjectAad(state: VaultKeyState, id: string, objectType: VaultObjectType) {
  return encodeText(`tripmap:vault-object:${AAD_VERSION}:${state.ownerId}:${state.vaultId}:${state.keyVersion}:${objectType}:${id}`)
}

function buildBlobAad(state: VaultKeyState, id: string, objectId: string) {
  return encodeText(`tripmap:vault-blob:${AAD_VERSION}:${state.ownerId}:${state.vaultId}:${state.keyVersion}:${objectId}:${id}`)
}

function assertPassphrase(passphrase: string) {
  if (passphrase.trim().length < 10) throw new Error('恢复口令至少需要 10 个字符。')
}

function encodeText(value: string) {
  return new TextEncoder().encode(value)
}

export function encodeBase64(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function copyArrayBuffer(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}
