import { describe, expect, it } from 'vitest'
import type { TravelDocumentData } from '../types'
import {
  createVaultKeyState,
  decryptVaultBlob,
  decryptVaultObject,
  encryptVaultBlob,
  encryptVaultObject,
  lockVault,
  unlockVaultKey,
  VaultCryptoError,
} from './vaultCrypto'

const document: TravelDocumentData = {
  attachmentIds: [],
  documentNumber: 'SECRET-PASSPORT-123',
  format: 'paper',
  kind: 'passport',
  status: 'active',
  title: 'My passport',
  travelerIds: ['traveler-1'],
}

describe('travel vault crypto', () => {
  it('encrypts sensitive JSON with unique IVs and decrypts it after unlock', async () => {
    const state = await createVaultKeyState({ iterations: 1_000, ownerId: 'owner-1', passphrase: 'correct horse battery', vaultId: 'vault-1' })
    const first = await encryptVaultObject({ id: 'document-1', objectType: 'document', payload: document, state })
    const second = await encryptVaultObject({ id: 'document-2', objectType: 'document', payload: document, state })

    expect(first.ciphertext).not.toContain(document.documentNumber!)
    expect(first.iv).not.toBe(second.iv)
    await expect(decryptVaultObject(first, state)).resolves.toEqual(document)

    lockVault(state.vaultId)
    await expect(unlockVaultKey(state, 'correct horse battery')).resolves.toBe(true)
    await expect(decryptVaultObject(first, state)).resolves.toEqual(document)
  })

  it('rejects a wrong passphrase and ciphertext tampering', async () => {
    const state = await createVaultKeyState({ iterations: 1_000, ownerId: 'owner-2', passphrase: 'long recovery phrase', vaultId: 'vault-2' })
    const record = await encryptVaultObject({ id: 'document-1', objectType: 'document', payload: document, state })
    lockVault(state.vaultId)
    await expect(unlockVaultKey(state, 'wrong passphrase value')).rejects.toMatchObject({ code: 'invalid_passphrase' })
    await unlockVaultKey(state, 'long recovery phrase')
    const last = record.ciphertext.at(-1) ?? 'A'
    const tampered = { ...record, ciphertext: `${record.ciphertext.slice(0, -1)}${last === 'A' ? 'B' : 'A'}` }
    await expect(decryptVaultObject(tampered, state)).rejects.toMatchObject({ code: 'invalid_record' })
  })

  it('encrypts attachments and enforces the 20MB boundary', async () => {
    const state = await createVaultKeyState({ iterations: 1_000, ownerId: 'owner-3', passphrase: 'another recovery phrase', vaultId: 'vault-3' })
    const encrypted = await encryptVaultBlob({ blob: new Blob(['visa image']), id: 'blob-1', objectId: 'document-1', state })
    const decrypted = await decryptVaultBlob(encrypted, state)
    expect(await decrypted.text()).toBe('visa image')
    await expect(encryptVaultBlob({ blob: new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]), id: 'blob-2', objectId: 'document-1', state })).rejects.toBeInstanceOf(VaultCryptoError)
  })
})
