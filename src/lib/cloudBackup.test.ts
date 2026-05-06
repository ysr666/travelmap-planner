import { describe, expect, it } from 'vitest'
import {
  buildCloudFilePath,
  buildCloudRestoreRecords,
  buildCloudSnapshotFromRecords,
  buildCloudSnapshotPath,
  parseCloudSnapshot,
} from './cloudBackup'
import { getSupabaseConfigStatus } from './supabaseClient'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

const trip: Trip = {
  createdAt: 100,
  destination: '东京',
  endDate: '2026-04-03',
  id: 'trip_old',
  notes: '测试',
  startDate: '2026-04-01',
  title: '云端备份测试',
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
    lat: 35.65858,
    lng: 139.70204,
    notes: '观景',
    sortOrder: 1,
    ticketIds: ['ticket_copy'],
    title: 'Shibuya Sky',
    tripId: trip.id,
    updatedAt: 120,
  },
]

const copyTicket: TicketMeta = {
  createdAt: 130,
  fileName: 'hotel/order.pdf',
  fileType: 'pdf',
  id: 'ticket_copy',
  itemId: 'item_old',
  mimeType: 'application/pdf',
  scope: 'item',
  size: 12,
  storageMode: 'copy',
  title: '酒店订单',
  tripId: trip.id,
  updatedAt: 140,
}

const referenceTicket: TicketMeta = {
  createdAt: 131,
  fileName: '签证位置',
  fileType: 'other',
  id: 'ticket_reference',
  mimeType: 'text/plain',
  referenceLocation: 'iCloud Drive/签证.pdf',
  scope: 'unassigned',
  size: 0,
  storageMode: 'reference',
  title: '签证位置',
  tripId: trip.id,
  updatedAt: 141,
}

const externalTicket: TicketMeta = {
  createdAt: 132,
  externalUrl: 'https://example.com/order',
  fileName: '外部链接',
  fileType: 'other',
  id: 'ticket_external',
  mimeType: 'text/uri-list',
  scope: 'trip',
  size: 0,
  storageMode: 'external',
  title: '订单链接',
  tripId: trip.id,
  updatedAt: 142,
}

describe('supabase cloud backup helpers', () => {
  it('reports unconfigured Supabase without throwing', () => {
    expect(getSupabaseConfigStatus({})).toEqual({
      configured: false,
      missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    })
    expect(
      getSupabaseConfigStatus({
        VITE_SUPABASE_ANON_KEY: 'anon',
        VITE_SUPABASE_URL: 'https://example.supabase.co',
      }),
    ).toMatchObject({ configured: true })
  })

  it('builds snapshot without embedding blobs and only creates refs for copy tickets', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' })
    const result = buildCloudSnapshotFromRecords({
      appVersion: '0.2.0.2',
      backupId: 'backup-id',
      days,
      exportedAt: '2026-04-01T00:00:00.000Z',
      itineraryItems: items,
      ticketBlobs: [{ blob, ticketId: copyTicket.id }],
      ticketMetas: [copyTicket, referenceTicket, externalTicket],
      trip,
      userId: 'user-id',
    })

    expect(result.snapshot.fileRefs).toHaveLength(1)
    expect(result.fileUploads).toHaveLength(1)
    expect(result.metadata.files_count).toBe(1)
    expect(result.metadata.total_size_bytes).toBe(blob.size)
    expect(JSON.stringify(result.snapshot)).not.toContain('"blob"')
    expect(result.snapshot.ticketMetas.map((ticket) => ticket.id)).toEqual([
      'ticket_copy',
      'ticket_reference',
      'ticket_external',
    ])
  })

  it('warns for missing copy blobs but not reference or external tickets', () => {
    const result = buildCloudSnapshotFromRecords({
      appVersion: '0.2.0.2',
      backupId: 'backup-id',
      days,
      exportedAt: '2026-04-01T00:00:00.000Z',
      itineraryItems: items,
      ticketBlobs: [],
      ticketMetas: [copyTicket, referenceTicket, externalTicket],
      trip,
      userId: 'user-id',
    })

    expect(result.fileUploads).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('缺少文件内容')
  })

  it('builds safe storage paths', () => {
    expect(buildCloudSnapshotPath('user-id', 'backup-id')).toBe('user-id/backup-id/snapshot.json')
    expect(buildCloudFilePath('user-id', 'backup-id', 'ticket-id', 'a/b\\c.pdf')).toBe(
      'user-id/backup-id/files/ticket-id/a_b_c.pdf',
    )
  })

  it('remaps all ids when restoring records', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' })
    const snapshot = buildCloudSnapshotFromRecords({
      appVersion: '0.2.0.2',
      backupId: 'backup-id',
      days,
      exportedAt: '2026-04-01T00:00:00.000Z',
      itineraryItems: items,
      ticketBlobs: [{ blob, ticketId: copyTicket.id }],
      ticketMetas: [copyTicket],
      trip,
      userId: 'user-id',
    }).snapshot
    let index = 0
    const records = buildCloudRestoreRecords(snapshot, [{ blob, ticketId: copyTicket.id }], {
      createIdFn: (prefix) => `${prefix}_new_${index++}`,
      now: 999,
    })

    expect(records.trip.id).not.toBe(trip.id)
    expect(records.trip.updatedAt).toBe(999)
    expect(records.days[0].tripId).toBe(records.trip.id)
    expect(records.itineraryItems[0].dayId).toBe(records.days[0].id)
    expect(records.ticketMetas[0].itemId).toBe(records.itineraryItems[0].id)
    expect(records.itineraryItems[0].ticketIds).toEqual([records.ticketMetas[0].id])
    expect(records.ticketBlobs[0].ticketId).toBe(records.ticketMetas[0].id)
  })

  it('rejects unsupported cloud snapshot schema and broken references', () => {
    expect(() => parseCloudSnapshot({ schemaVersion: 2, type: 'cloud-trip-backup' })).toThrow(
      '不支持的云端备份版本',
    )

    const snapshot = buildCloudSnapshotFromRecords({
      appVersion: '0.2.0.2',
      backupId: 'backup-id',
      days,
      exportedAt: '2026-04-01T00:00:00.000Z',
      itineraryItems: [{ ...items[0], dayId: 'missing_day' }],
      ticketBlobs: [],
      ticketMetas: [],
      trip,
      userId: 'user-id',
    }).snapshot

    expect(() => buildCloudRestoreRecords(snapshot, [])).toThrow('行程点引用不正确')
  })
})
