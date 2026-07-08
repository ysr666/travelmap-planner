import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/database'
import { scanTravelInboxLocalFolder } from './travelInboxLocalFolders'
import type { TravelInboxLocalConnector } from '../types'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('travel inbox local folder scanning', () => {
  it('scans supported top-level files incrementally and treats modifications as new versions', async () => {
    let currentFile = new File(['first'], 'booking.txt', { lastModified: 100, type: 'text/plain' })
    const handle = directoryHandle(async function* () {
      yield ['booking.txt', fileHandle(() => currentFile)]
      yield ['nested', { kind: 'directory', name: 'nested' } as FileSystemDirectoryHandle]
      yield ['ignored.exe', fileHandle(() => new File(['ignored'], 'ignored.exe'))]
    })
    const connector = makeConnector(handle)
    const update = vi.spyOn(db.travelInboxLocalConnectors, 'update').mockResolvedValue(1)

    expect(await scanTravelInboxLocalFolder(connector)).toHaveLength(1)
    const firstPatch = update.mock.calls.at(-1)?.[1] as Partial<TravelInboxLocalConnector>
    const updated = { ...connector, ...firstPatch }
    expect(await scanTravelInboxLocalFolder(updated)).toHaveLength(0)

    currentFile = new File(['second'], 'booking.txt', { lastModified: 200, type: 'text/plain' })
    expect(await scanTravelInboxLocalFolder(updated)).toHaveLength(1)
    expect(await db.travelInboxAccountSources.count()).toBe(2)
  })

  it('scans supported files inside nested folders', async () => {
    const nested = directoryHandle(async function* () {
      yield ['hotel.pdf', fileHandle(() => new File(['pdf'], 'hotel.pdf', { type: 'application/pdf' }))]
    })
    const handle = directoryHandle(async function* () {
      yield ['nested', nested]
    })
    const connector = makeConnector(handle)
    vi.spyOn(db.travelInboxLocalConnectors, 'update').mockResolvedValue(1)

    expect(await scanTravelInboxLocalFolder(connector)).toHaveLength(1)
    await expect(db.travelInboxAccountSources.toArray()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        fileName: 'nested/hotel.pdf',
        label: 'nested/hotel.pdf',
        sourceKind: 'pdf',
      }),
    ]))
  })

  it('marks the connector as error when read permission is revoked', async () => {
    const handle = directoryHandle(async function* () {}, 'denied')
    const connector = makeConnector(handle)
    const update = vi.spyOn(db.travelInboxLocalConnectors, 'update').mockResolvedValue(1)

    await expect(scanTravelInboxLocalFolder(connector)).rejects.toThrow('本地文件夹权限已撤销')
    expect(update).toHaveBeenCalledWith(connector.id, expect.objectContaining({ status: 'error' }))
  })
})

function makeConnector(directoryHandle: FileSystemDirectoryHandle): TravelInboxLocalConnector {
  return {
    autoAiEnabled: true,
    createdAt: 1,
    deviceId: 'device-1',
    directoryHandle,
    fileFingerprints: {},
    id: 'local-1',
    kind: 'local_folder',
    name: 'Inbox',
    status: 'active',
    updatedAt: 1,
  }
}

function directoryHandle(entries: () => AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>, permission: PermissionState = 'granted') {
  return {
    entries,
    kind: 'directory',
    name: 'Inbox',
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => permission),
  } as unknown as FileSystemDirectoryHandle
}

function fileHandle(getFile: () => File) {
  return { getFile, kind: 'file', name: getFile().name } as unknown as FileSystemFileHandle
}
