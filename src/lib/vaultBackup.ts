import JSZip from 'jszip'
import { db } from '../db/database'
import type { VaultBlobRecord, VaultKeyState, VaultObjectRecord } from '../types'

type VaultBackupManifest = {
  format: 'tripmap-encrypted-vault'
  schemaVersion: 1
  exportedAt: string
  vaultId: string
  objectCount: number
  blobCount: number
}

export async function exportEncryptedVaultBackup() {
  const state = await db.vaultKeyState.orderBy('updatedAt').last()
  if (!state) throw new Error('尚未建立旅行资料库。')
  const [objects, blobs] = await Promise.all([
    db.vaultObjects.where('vaultId').equals(state.vaultId).toArray(),
    db.vaultBlobs.where('vaultId').equals(state.vaultId).toArray(),
  ])
  const zip = new JSZip()
  const manifest: VaultBackupManifest = {
    blobCount: blobs.length,
    exportedAt: new Date().toISOString(),
    format: 'tripmap-encrypted-vault',
    objectCount: objects.length,
    schemaVersion: 1,
    vaultId: state.vaultId,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('encrypted/key-envelope.json', JSON.stringify(state))
  zip.file('encrypted/objects.json', JSON.stringify(objects))
  for (const blob of blobs) {
    zip.file(`encrypted/blobs/${blob.id}.bin`, blob.ciphertext)
    zip.file(`encrypted/blobs/${blob.id}.json`, JSON.stringify({ ...blob, ciphertext: undefined, fileName: 'encrypted-file', mimeType: 'application/octet-stream' }))
  }
  return zip.generateAsync({ type: 'blob' })
}

export async function importEncryptedVaultBackup(file: File) {
  if (await db.vaultKeyState.count()) throw new Error('当前设备已有旅行资料库，不能直接覆盖。')
  const zip = await JSZip.loadAsync(file)
  const manifest = await readJson<VaultBackupManifest>(zip, 'manifest.json')
  if (manifest.format !== 'tripmap-encrypted-vault' || manifest.schemaVersion !== 1) throw new Error('不是受支持的加密资料库备份。')
  const state = await readJson<VaultKeyState>(zip, 'encrypted/key-envelope.json')
  const objects = await readJson<VaultObjectRecord[]>(zip, 'encrypted/objects.json')
  const blobs: VaultBlobRecord[] = []
  for (const entry of Object.values(zip.files)) {
    if (!entry.name.startsWith('encrypted/blobs/') || !entry.name.endsWith('.json')) continue
    const meta = JSON.parse(await entry.async('string')) as Omit<VaultBlobRecord, 'ciphertext'>
    const ciphertext = zip.file(`encrypted/blobs/${meta.id}.bin`)
    if (!ciphertext) throw new Error(`加密附件 ${meta.id} 缺少密文。`)
    blobs.push({ ...meta, ciphertext: await ciphertext.async('blob') })
  }
  if (
    state.vaultId !== manifest.vaultId ||
    objects.some((object) => object.vaultId !== state.vaultId) ||
    blobs.some((blob) => blob.vaultId !== state.vaultId)
  ) throw new Error('备份中的资料库归属不一致。')
  if (objects.length !== manifest.objectCount || blobs.length !== manifest.blobCount) throw new Error('加密资料库备份不完整。')
  await db.transaction('rw', db.vaultKeyState, db.vaultObjects, db.vaultBlobs, async () => {
    await db.vaultKeyState.add(state)
    if (objects.length) await db.vaultObjects.bulkAdd(objects)
    if (blobs.length) await db.vaultBlobs.bulkAdd(blobs)
  })
  return { blobCount: blobs.length, objectCount: objects.length, vaultId: state.vaultId }
}

async function readJson<T>(zip: JSZip, path: string) {
  const entry = zip.file(path)
  if (!entry) throw new Error(`加密资料库备份缺少 ${path}。`)
  return JSON.parse(await entry.async('string')) as T
}
