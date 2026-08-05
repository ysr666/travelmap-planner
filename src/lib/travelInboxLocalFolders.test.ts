import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/database'
import { importTravelInboxFiles, scanTravelInboxLocalFolder } from './travelInboxLocalFolders'
import type { TravelInboxLocalConnector } from '../types'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('travel inbox local folder scanning', () => {
  it('imports files directly without requiring the directory picker', async () => {
    const files = [
      new File(['ticket'], 'museum.pdf', { lastModified: 100, type: 'application/pdf' }),
      new File(['plan'], 'plan.xlsx', { lastModified: 200, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    ]

    await expect(importTravelInboxFiles(files)).resolves.toMatchObject({
      created: [
        expect.objectContaining({ fileName: 'museum.pdf', sourceKind: 'pdf', status: 'queued' }),
        expect.objectContaining({ fileName: 'plan.xlsx', sourceKind: 'spreadsheet', status: 'queued' }),
      ],
      warnings: [],
    })
    await expect(db.travelInboxAccountSourceBlobs.count()).resolves.toBe(2)
  })

  it('skips duplicate, unsupported, and oversized manual files', async () => {
    const duplicate = new File(['same'], 'copy.pdf', { type: 'application/pdf' })
    const oversized = {
      lastModified: 200,
      name: 'album.pdf',
      size: 20 * 1024 * 1024 + 1,
      type: 'application/pdf',
    } as File
    const result = await importTravelInboxFiles([
      new File(['same'], 'ticket.pdf', { type: 'application/pdf' }),
      duplicate,
      new File(['nope'], 'script.exe'),
      oversized,
    ])

    expect(result.created).toHaveLength(1)
    expect(result.warnings).toEqual([
      'script.exe 暂不支持。',
      'album.pdf 超过 20MB，未处理。',
    ])
  })

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

  it('stores one source when the same file appears in multiple folders', async () => {
    const first = new File(['same ticket'], 'ticket.pdf', { lastModified: 100, type: 'application/pdf' })
    const duplicate = new File(['same ticket'], 'ticket-copy.pdf', { lastModified: 200, type: 'application/pdf' })
    const nested = directoryHandle(async function* () {
      yield ['ticket-copy.pdf', fileHandle(() => duplicate)]
    })
    const handle = directoryHandle(async function* () {
      yield ['ticket.pdf', fileHandle(() => first)]
      yield ['nested', nested]
    })
    const connector = makeConnector(handle)
    const update = vi.spyOn(db.travelInboxLocalConnectors, 'update').mockResolvedValue(1)

    await expect(scanTravelInboxLocalFolder(connector)).resolves.toHaveLength(1)
    await expect(db.travelInboxAccountSources.count()).resolves.toBe(1)
    const patch = update.mock.calls.at(-1)?.[1] as Partial<TravelInboxLocalConnector>
    expect(Object.keys(patch.fileFingerprints ?? {})).toEqual(['ticket.pdf', 'nested/ticket-copy.pdf'])
  })

  it('queues Markdown and reports oversized supported files without storing them', async () => {
    const markdown = new File(['# Notes'], 'README.md', { lastModified: 100, type: 'text/markdown' })
    const oversized = {
      lastModified: 200,
      name: 'album.pdf',
      size: 20 * 1024 * 1024 + 1,
      type: 'application/pdf',
    } as File
    const handle = directoryHandle(async function* () {
      yield ['README.md', fileHandle(() => markdown)]
      yield ['album.pdf', fileHandle(() => oversized)]
    })
    const connector = makeConnector(handle)
    const update = vi.spyOn(db.travelInboxLocalConnectors, 'update').mockResolvedValue(1)

    await expect(scanTravelInboxLocalFolder(connector)).resolves.toHaveLength(1)
    await expect(db.travelInboxAccountSources.toArray()).resolves.toEqual([
      expect.objectContaining({ fileName: 'README.md', sourceKind: 'text_file' }),
    ])
    const patch = update.mock.calls.at(-1)?.[1] as Partial<TravelInboxLocalConnector>
    expect(patch).toMatchObject({
      lastScanSkippedCount: 1,
      lastScanWarnings: ['album.pdf 超过 20MB，未处理。'],
    })
    expect(patch.fileFingerprints?.['album.pdf']).toBe(`${oversized.size}:200:oversize`)
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
