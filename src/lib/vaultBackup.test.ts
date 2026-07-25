import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import type { VaultKeyState, VaultObjectRecord } from '../types'
import { exportEncryptedVaultBackup, importEncryptedVaultBackup } from './vaultBackup'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('encrypted vault backup', () => {
  it('round-trips encrypted records while loading the archive runtime on demand', async () => {
    const now = Date.parse('2026-07-26T00:00:00.000Z')
    const keyState: VaultKeyState = {
      createdAt: now,
      keyVersion: 1,
      ownerId: 'owner_1',
      pbkdf2Iterations: 210_000,
      salt: 'salt',
      schemaVersion: 1,
      updatedAt: now,
      vaultId: 'vault_1',
      wrapIv: 'wrap-iv',
      wrappedKey: 'wrapped-key',
    }
    const object: VaultObjectRecord = {
      aadVersion: 1,
      ciphertext: 'encrypted-object',
      createdAt: now,
      id: 'object_1',
      iv: 'object-iv',
      keyVersion: 1,
      objectType: 'document',
      schemaVersion: 1,
      updatedAt: now,
      vaultId: keyState.vaultId,
    }
    await db.vaultKeyState.add(keyState)
    await db.vaultObjects.add(object)

    const backup = await exportEncryptedVaultBackup()
    await db.delete()
    await db.open()
    const result = await importEncryptedVaultBackup(
      await backup.arrayBuffer() as unknown as File,
    )

    expect(result).toEqual({ blobCount: 0, objectCount: 1, vaultId: keyState.vaultId })
    await expect(db.vaultKeyState.get(keyState.vaultId)).resolves.toEqual(keyState)
    await expect(db.vaultObjects.get(object.id)).resolves.toEqual(object)
    await expect(db.vaultBlobs.count()).resolves.toBe(0)
  })
})
