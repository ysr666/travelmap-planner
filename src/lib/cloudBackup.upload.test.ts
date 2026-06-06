import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrip, db } from '../db'
import { uploadTripCloudBackup } from './cloudBackup'

let mockClient: ReturnType<typeof createMockSupabaseClient>

vi.mock('./supabaseClient', () => ({
  getSupabaseConfigStatus: () => ({ configured: true, missing: [] }),
  requireSupabaseClient: () => mockClient,
}))

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('__APP_VERSION__', '0.3.0-test')
  mockClient = createMockSupabaseClient()
  await db.delete()
  await db.open()
})

describe('uploadTripCloudBackup', () => {
  it('upserts the same cloud backup record and storage paths for repeated trip uploads', async () => {
    const trip = await createTrip({
      destination: '日本东京',
      endDate: '2026-04-03',
      startDate: '2026-04-01',
      title: '东京',
    })

    const first = await uploadTripCloudBackup(trip.id)
    const second = await uploadTripCloudBackup(trip.id)

    expect(first.backupId).toBe(second.backupId)
    expect(first.backupId).toMatch(/^[0-9a-f-]{36}$/)
    expect(mockClient.table.upsert).toHaveBeenCalledTimes(2)
    expect(mockClient.table.upsert.mock.calls[0][0]).toMatchObject({
      id: first.backupId,
      original_trip_id: trip.id,
      snapshot_path: `user-id/${first.backupId}/snapshot.json`,
      user_id: 'user-id',
    })
    expect(mockClient.bucket.upload).toHaveBeenCalledWith(
      `user-id/${first.backupId}/snapshot.json`,
      expect.any(Blob),
      expect.objectContaining({ upsert: true }),
    )
  })
})

function createMockSupabaseClient() {
  const table = {
    upsert: vi.fn(async (...args: [unknown, unknown?]) => {
      void args
      return { error: null }
    }),
  }
  const unavailableObjectTable = {
    upsert: vi.fn(async (...args: [unknown, unknown?]) => {
      void args
      return { error: { code: '42P01', message: 'cloud_sync_objects does not exist' } }
    }),
  }
  const bucket = {
    list: vi.fn(async (...args: [string, unknown?]) => {
      void args
      return { data: [], error: null }
    }),
    remove: vi.fn(async (...args: [string[]]) => {
      void args
      return { error: null }
    }),
    upload: vi.fn(async (...args: [string, Blob, unknown?]) => {
      void args
      return { error: null }
    }),
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { email: 'user@example.com', id: 'user-id' } },
        error: null,
      })),
    },
    bucket,
    from: vi.fn((tableName: string) => tableName === 'cloud_trip_backups' ? table : unavailableObjectTable),
    storage: {
      from: vi.fn(() => bucket),
    },
    table,
  }
}
