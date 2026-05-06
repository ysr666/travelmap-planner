import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCloudSnapshotFromRecords, deleteCloudBackup } from './cloudBackup'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

let mockClient: ReturnType<typeof createMockSupabaseClient>

vi.mock('./supabaseClient', () => ({
  getSupabaseConfigStatus: () => ({ configured: true, missing: [] }),
  requireSupabaseClient: () => mockClient,
}))

const trip: Trip = {
  createdAt: 100,
  destination: '东京',
  endDate: '2026-04-03',
  id: 'trip_old',
  startDate: '2026-04-01',
  title: '云端删除测试',
  updatedAt: 200,
}

const days: Day[] = [
  {
    date: '2026-04-01',
    id: 'day_old',
    sortOrder: 1,
    title: '第 1 天',
    tripId: trip.id,
  },
]

const items: ItineraryItem[] = [
  {
    createdAt: 110,
    dayId: 'day_old',
    id: 'item_old',
    sortOrder: 1,
    ticketIds: ['ticket_copy'],
    title: '酒店入住',
    tripId: trip.id,
    updatedAt: 120,
  },
]

const copyTicket: TicketMeta = {
  createdAt: 130,
  fileName: 'order.pdf',
  fileType: 'pdf',
  id: 'ticket_copy',
  itemId: 'item_old',
  mimeType: 'application/pdf',
  scope: 'item',
  size: 3,
  storageMode: 'copy',
  title: '酒店订单',
  tripId: trip.id,
  updatedAt: 140,
}

const snapshotResult = buildCloudSnapshotFromRecords({
  appVersion: '0.2.0.2',
  backupId: 'backup-id',
  days,
  exportedAt: '2026-04-01T00:00:00.000Z',
  itineraryItems: items,
  ticketBlobs: [{ blob: new Blob(['pdf'], { type: 'application/pdf' }), ticketId: copyTicket.id }],
  ticketMetas: [copyTicket],
  trip,
  userId: 'user-id',
})

describe('deleteCloudBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not delete metadata when storage listing fails', async () => {
    mockClient = createMockSupabaseClient({
      listByPath: {
        'user-id/backup-id': new Error('list failed'),
      },
    })

    await expect(deleteCloudBackup('backup-id')).rejects.toThrow('无法确认附件是否全部可清理')
    expect(mockClient.bucket.remove).not.toHaveBeenCalled()
    expect(mockClient.table.delete).not.toHaveBeenCalled()
  })

  it('does not delete metadata when storage remove fails', async () => {
    mockClient = createMockSupabaseClient({
      listByPath: defaultListByPath(),
      removeError: 'remove failed',
    })

    await expect(deleteCloudBackup('backup-id')).rejects.toThrow('云端文件删除失败')
    expect(mockClient.bucket.remove).toHaveBeenCalled()
    expect(mockClient.table.delete).not.toHaveBeenCalled()
  })

  it('merges listed objects and snapshot file refs before deleting metadata', async () => {
    mockClient = createMockSupabaseClient({
      listByPath: defaultListByPath(),
    })

    await expect(deleteCloudBackup('backup-id')).resolves.toEqual({ warnings: [] })

    expect(mockClient.bucket.remove).toHaveBeenCalledWith(
      expect.arrayContaining([
        'user-id/backup-id/snapshot.json',
        'user-id/backup-id/files/ticket_copy/order.pdf',
      ]),
    )
    expect(mockClient.table.delete).toHaveBeenCalledOnce()
  })

  it('uses prefix listing and keeps a warning when snapshot cannot be read', async () => {
    mockClient = createMockSupabaseClient({
      downloadError: 'download failed',
      listByPath: defaultListByPath(),
    })

    await expect(deleteCloudBackup('backup-id')).resolves.toEqual({
      warnings: ['云端 snapshot 无法读取，已按当前备份路径清理可枚举文件。'],
    })
    expect(mockClient.bucket.remove).toHaveBeenCalledWith(
      expect.arrayContaining([
        'user-id/backup-id/snapshot.json',
        'user-id/backup-id/files/ticket_copy/order.pdf',
      ]),
    )
    expect(mockClient.table.delete).toHaveBeenCalledOnce()
  })
})

function defaultListByPath() {
  return {
    'user-id/backup-id': [{ name: 'snapshot.json' }, { name: 'files' }],
    'user-id/backup-id/files': [{ name: 'ticket_copy' }],
    'user-id/backup-id/files/ticket_copy': [{ name: 'order.pdf' }],
  }
}

function createMockSupabaseClient({
  downloadError,
  listByPath = {},
  removeError,
}: {
  downloadError?: string
  listByPath?: Record<string, Array<{ name: string }> | Error>
  removeError?: string
}) {
  const table = createMockTable()
  const bucket = {
    download: vi.fn(async () => ({
      data: downloadError
        ? null
        : new Blob([JSON.stringify(snapshotResult.snapshot)], { type: 'application/json' }),
      error: downloadError ? { message: downloadError } : null,
    })),
    list: vi.fn(async (path: string) => {
      const result = listByPath[path] ?? []
      if (result instanceof Error) {
        return { data: null, error: { message: result.message } }
      }
      return { data: result, error: null }
    }),
    remove: vi.fn(async () => ({ error: removeError ? { message: removeError } : null })),
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { email: 'user@example.com', id: 'user-id' } },
        error: null,
      })),
    },
    bucket,
    from: vi.fn(() => table),
    storage: {
      from: vi.fn(() => bucket),
    },
    table,
  }
}

function createMockTable() {
  const selectBuilder = {
    eq: vi.fn(() => selectBuilder),
    single: vi.fn(async () => ({
      data: {
        ...snapshotResult.metadata,
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      },
      error: null,
    })),
  }
  const deleteBuilder = {
    error: null,
    eq: vi.fn(() => deleteBuilder),
  }

  return {
    delete: vi.fn(() => deleteBuilder),
    select: vi.fn(() => selectBuilder),
  }
}
