import { describe, expect, it } from 'vitest'
import {
  buildCloudFilePath,
  buildCloudRestoreRecords,
  buildCloudSnapshotFromRecords,
  buildCloudSnapshotPath,
  buildStableCloudBackupId,
  buildMissingCloudFileRefWarnings,
  parseCloudSnapshot,
  parseCloudSnapshotText,
  validateCloudBackupSnapshotPath,
  validateCloudSnapshotForRestore,
} from './cloudBackup'
import { getSupabaseConfigStatus } from './supabaseClient'
import type { Day, ItineraryItem, LedgerBudget, LedgerExpense, LedgerParticipant, LedgerSettings, TicketMeta, Trip } from '../types'

const trip: Trip = {
  createdAt: 100,
  destination: '东京',
  endDate: '2026-04-03',
  id: 'trip_old',
  notes: '测试',
  startDate: '2026-04-01',
  title: '云端同步测试',
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

const ledgerSettings: LedgerSettings = { createdAt: 100, homeCurrency: 'CNY', id: 'ledger_settings', settlementCurrency: 'CNY', tripCurrency: 'JPY', tripId: trip.id, updatedAt: 100 }
const ledgerParticipant: LedgerParticipant = { createdAt: 100, displayName: '我', id: 'ledger_person', isSelf: true, source: 'manual', tripId: trip.id, updatedAt: 100 }
const ledgerBudget: LedgerBudget = { amountMinor: 10000, createdAt: 100, currency: 'JPY', id: 'ledger_budget', scope: 'trip', tripId: trip.id, updatedAt: 100 }
const ledgerExpense: LedgerExpense = { amountMinor: 1200, category: 'food', createdAt: 100, currency: 'JPY', date: '2026-04-01', id: 'ledger_expense', payerParticipantId: ledgerParticipant.id, source: { kind: 'manual' }, splitMode: 'equal', splitShares: [{ participantId: ledgerParticipant.id, weight: 1 }], status: 'confirmed', title: '晚餐', tripId: trip.id, updatedAt: 100 }

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

  it('builds one stable uuid backup id per user and trip', async () => {
    const first = await buildStableCloudBackupId('user-id', 'trip-id')
    const second = await buildStableCloudBackupId('user-id', 'trip-id')
    const otherTrip = await buildStableCloudBackupId('user-id', 'other-trip')

    expect(first).toBe(second)
    expect(first).not.toBe(otherTrip)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('rejects metadata snapshot paths outside the current user and backup', () => {
    expect(() =>
      validateCloudBackupSnapshotPath('user-id', 'backup-id', 'user-id/other-backup/snapshot.json'),
    ).toThrow('snapshot 路径')
  })

  it('preserves all ids when restoring cloud records', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' })
    const snapshot = buildCloudSnapshotFromRecords({
      appVersion: '0.2.0.2',
      backupId: 'backup-id',
      days,
      exportedAt: '2026-04-01T00:00:00.000Z',
      itineraryItems: items.map((item) => ({ ...item, executionState: { status: 'completed' as const, updatedAt: 123 } })),
      ticketBlobs: [{ blob, ticketId: copyTicket.id }],
      ticketMetas: [copyTicket],
      trip,
      userId: 'user-id',
    }).snapshot
    const records = buildCloudRestoreRecords(snapshot, [{ blob, ticketId: copyTicket.id }])

    expect(records.trip.id).toBe(trip.id)
    expect(records.trip.updatedAt).toBe(trip.updatedAt)
    expect(records.days[0].tripId).toBe(records.trip.id)
    expect(records.days[0].id).toBe(days[0].id)
    expect(records.itineraryItems[0].id).toBe(items[0].id)
    expect(records.itineraryItems[0].dayId).toBe(days[0].id)
    expect(records.ticketMetas[0].id).toBe(copyTicket.id)
    expect(records.ticketMetas[0].itemId).toBe(items[0].id)
    expect(records.itineraryItems[0].ticketIds).toEqual([copyTicket.id])
    expect(records.itineraryItems[0].executionState).toEqual({ status: 'completed', updatedAt: 123 })
    expect(records.ticketBlobs[0].ticketId).toBe(copyTicket.id)
  })

  it('round-trips owner ledger records and still accepts v1 snapshots without them', () => {
    const snapshot = buildCloudSnapshotFromRecords({
      appVersion: '0.3.0', backupId: 'backup-ledger', days, exportedAt: '2026-04-01T00:00:00.000Z', itineraryItems: items.map((item) => ({ ...item, ticketIds: [] })),
      ledgerBudgets: [ledgerBudget], ledgerExpenses: [ledgerExpense], ledgerParticipants: [ledgerParticipant], ledgerSettings: [ledgerSettings], ticketBlobs: [], ticketMetas: [], trip, userId: 'user-id',
    }).snapshot
    const records = buildCloudRestoreRecords(snapshot, [])
    expect(records.ledgerSettings).toEqual([ledgerSettings])
    expect(records.ledgerParticipants).toEqual([ledgerParticipant])
    expect(records.ledgerBudgets).toEqual([ledgerBudget])
    expect(records.ledgerExpenses).toEqual([ledgerExpense])

    const legacy = parseCloudSnapshot({ ...snapshot, ledgerBudgets: undefined, ledgerExpenses: undefined, ledgerParticipants: undefined, ledgerSettings: undefined, schemaVersion: 1 })
    expect(legacy.ledgerSettings).toEqual([])
    expect(legacy.ledgerExpenses).toEqual([])
  })

  it('removes legacy restore lineage metadata when restoring into the same trip identity', async () => {
    const snapshot = buildCloudSnapshotFromRecords({
      appVersion: '0.2.0.2',
      backupId: 'old-backup-id',
      days,
      exportedAt: '2026-04-01T00:00:00.000Z',
      itineraryItems: items.map((item) => ({ ...item, ticketIds: [] })),
      ticketBlobs: [],
      ticketMetas: [],
      trip: {
        ...trip,
        restoredAt: 111,
        restoredFromCloudBackupId: 'stale_backup',
        restoredFromCloudExportedAt: '2026-03-01T00:00:00.000Z',
        restoredFromCloudOriginalTripId: 'stale_trip',
      },
      userId: 'user-id',
    }).snapshot
    const records = buildCloudRestoreRecords(snapshot, [])

    expect(records.trip.title).toBe(trip.title)
    expect(records.trip.id).toBe(trip.id)
    expect(records.trip.restoredAt).toBeUndefined()
    expect(records.trip.restoredFromCloudBackupId).toBeUndefined()
    expect(records.trip.restoredFromCloudOriginalTripId).toBeUndefined()
    expect(records.trip.restoredFromCloudExportedAt).toBeUndefined()
  })

  it('preserves optional restored metadata in cloud snapshots while using the current local trip id', () => {
    const restoredTrip: Trip = {
      ...trip,
      id: 'trip_restored_local',
      restoredAt: 999,
      restoredFromCloudBackupId: 'backup_original',
      restoredFromCloudExportedAt: '2026-04-01T00:00:00.000Z',
      restoredFromCloudOriginalTripId: 'trip_original',
    }
    const result = buildCloudSnapshotFromRecords({
      appVersion: '0.2.0.2',
      backupId: 'backup-id',
      days: days.map((day) => ({ ...day, tripId: restoredTrip.id })),
      exportedAt: '2026-04-02T00:00:00.000Z',
      itineraryItems: items.map((item) => ({ ...item, tripId: restoredTrip.id })),
      ticketBlobs: [],
      ticketMetas: [],
      trip: restoredTrip,
      userId: 'user-id',
    })

    expect(result.snapshot.originalTripId).toBe(restoredTrip.id)
    expect(result.metadata.original_trip_id).toBe(restoredTrip.id)
    expect(result.snapshot.trip.restoredFromCloudBackupId).toBe('backup_original')
    expect(result.snapshot.schemaVersion).toBe(2)
  })

  it('rejects unsupported cloud snapshot schema and broken references', () => {
    expect(() => parseCloudSnapshot({ schemaVersion: 3, type: 'cloud-trip-backup' })).toThrow(
      '不支持的云端同步版本',
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

  it('reports invalid snapshot json with a user-facing error', () => {
    expect(() => parseCloudSnapshotText('{not json')).toThrow('云端同步 snapshot.json 无法解析')
  })

  it('rejects file refs outside the current backup storage prefix', () => {
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

    snapshot.fileRefs[0].path = 'user-id/another-backup/files/ticket_copy/order.pdf'

    expect(() => validateCloudSnapshotForRestore(snapshot, 'user-id', 'backup-id')).toThrow(
      '文件路径不属于当前保存记录',
    )
  })

  it('rejects file refs whose path ticket segment does not match ticketId', () => {
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

    snapshot.fileRefs[0].path = 'user-id/backup-id/files/another-ticket/order.pdf'

    expect(() => validateCloudSnapshotForRestore(snapshot, 'user-id', 'backup-id')).toThrow(
      '文件路径不属于当前保存记录',
    )
  })

  it('creates fresh warnings when copy tickets have no cloud file ref', () => {
    const snapshot = buildCloudSnapshotFromRecords({
      appVersion: '0.2.0.2',
      backupId: 'backup-id',
      days,
      exportedAt: '2026-04-01T00:00:00.000Z',
      itineraryItems: items,
      ticketBlobs: [],
      ticketMetas: [copyTicket],
      trip,
      userId: 'user-id',
    }).snapshot
    snapshot.warnings = []

    expect(buildMissingCloudFileRefWarnings(snapshot)).toEqual([
      '票据「酒店订单」缺少云端文件内容，已仅恢复元数据。',
    ])
    expect(buildCloudRestoreRecords(snapshot, []).ticketBlobs).toHaveLength(0)
  })

  it('rejects file refs for reference or external tickets', () => {
    const snapshot = buildCloudSnapshotFromRecords({
      appVersion: '0.2.0.2',
      backupId: 'backup-id',
      days,
      exportedAt: '2026-04-01T00:00:00.000Z',
      itineraryItems: [{ ...items[0], ticketIds: ['ticket_reference'] }],
      ticketBlobs: [],
      ticketMetas: [{ ...referenceTicket, itemId: 'item_old', scope: 'item' }],
      trip,
      userId: 'user-id',
    }).snapshot

    snapshot.fileRefs = [
      {
        fileName: 'visa.pdf',
        mimeType: 'application/pdf',
        path: 'user-id/backup-id/files/ticket_reference/visa.pdf',
        size: 4,
        ticketId: 'ticket_reference',
      },
    ]

    expect(() => buildCloudRestoreRecords(snapshot, [
      { blob: new Blob(['pdf'], { type: 'application/pdf' }), ticketId: 'ticket_reference' },
    ])).toThrow('文件引用只能绑定 copy 模式票据')
  })

  it('rejects malformed item ticket id lists instead of silently dropping them', () => {
    const snapshot = buildCloudSnapshotFromRecords({
      appVersion: '0.2.0.2',
      backupId: 'backup-id',
      days,
      exportedAt: '2026-04-01T00:00:00.000Z',
      itineraryItems: [
        {
          ...items[0],
          ticketIds: undefined as unknown as string[],
        },
      ],
      ticketBlobs: [],
      ticketMetas: [],
      trip,
      userId: 'user-id',
    }).snapshot

    expect(() => buildCloudRestoreRecords(snapshot, [])).toThrow('票据列表格式不正确')
  })
})
