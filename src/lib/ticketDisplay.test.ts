import { describe, expect, it } from 'vitest'
import {
  getTicketCloudSyncView,
  getTicketDisplayMeta,
  type TicketCloudSyncContext,
} from './ticketDisplay'
import type { TicketMeta } from '../types'

function makeTicket(overrides: Partial<TicketMeta> = {}): TicketMeta {
  return {
    createdAt: Date.now(),
    fileName: 'boarding-pass.pdf',
    fileType: 'pdf',
    id: 'ticket-1',
    mimeType: 'application/pdf',
    size: 1024,
    tripId: 'trip-1',
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('getTicketDisplayMeta', () => {
  it('maps copy image tickets', () => {
    expect(getTicketDisplayMeta(makeTicket({
      fileName: 'qr.png',
      fileType: 'image',
      storageMode: 'copy',
    }))).toMatchObject({
      iconKind: 'image',
      secondaryLine: '其他票据 · qr.png',
      storageLabel: '离线缓存',
      toneKey: 'sky',
      typeLabel: '图片',
    })
  })

  it('maps copy pdf tickets', () => {
    expect(getTicketDisplayMeta(makeTicket({ storageMode: 'copy', ticketCategory: 'flight_ticket' }))).toMatchObject({
      iconKind: 'pdf',
      secondaryLine: '机票 · boarding-pass.pdf',
      storageLabel: '离线缓存',
      toneKey: 'rose',
      typeLabel: 'PDF',
    })
  })

  it('maps copy other tickets', () => {
    expect(getTicketDisplayMeta(makeTicket({
      fileName: 'order.zip',
      fileType: 'other',
      storageMode: 'copy',
    }))).toMatchObject({
      iconKind: 'file',
      secondaryLine: '其他票据 · order.zip',
      storageLabel: '离线缓存',
      toneKey: 'slate',
      typeLabel: '文件',
    })
  })

  it('maps reference tickets', () => {
    expect(getTicketDisplayMeta(makeTicket({
      referenceLocation: 'iCloud Drive/TravelMap/hotel.pdf',
      storageMode: 'reference',
    }))).toMatchObject({
      iconKind: 'reference',
      secondaryLine: '其他票据 · iCloud Drive/TravelMap/hotel.pdf',
      storageLabel: '位置记录',
      toneKey: 'amber',
      typeLabel: '位置',
    })
  })

  it('maps external tickets', () => {
    expect(getTicketDisplayMeta(makeTicket({
      externalUrl: 'https://example.com/order',
      storageMode: 'external',
    }))).toMatchObject({
      iconKind: 'external',
      secondaryLine: '其他票据 · https://example.com/order',
      storageLabel: '外部链接',
      toneKey: 'violet',
      typeLabel: '链接',
    })
  })
})

describe('getTicketCloudSyncView', () => {
  const baseContext: TicketCloudSyncContext = {
    autoSyncEnabled: true,
    autoSyncEntry: null,
    hasOfflineCache: true,
    isOnline: true,
    signedIn: true,
  }

  it('describes reference tickets without implying a cached file', () => {
    expect(getTicketCloudSyncView(makeTicket({ storageMode: 'reference' }), baseContext)).toMatchObject({
      detail: expect.stringContaining('未保存文件内容'),
      label: '位置记录',
      tone: 'neutral',
    })
  })

  it('describes external tickets as external links', () => {
    expect(getTicketCloudSyncView(makeTicket({ storageMode: 'external' }), baseContext)).toMatchObject({
      label: '外部链接',
      tone: 'neutral',
    })
  })

  it('flags copy tickets when the offline cache is missing', () => {
    expect(getTicketCloudSyncView(makeTicket({ storageMode: 'copy' }), {
      ...baseContext,
      hasOfflineCache: false,
    })).toMatchObject({
      detail: expect.stringContaining('离线缓存不可用'),
      label: '离线缓存不可用',
      tone: 'danger',
    })
  })

  it('shows copy tickets as waiting for login before sync', () => {
    expect(getTicketCloudSyncView(makeTicket({ storageMode: 'copy' }), {
      ...baseContext,
      signedIn: false,
    })).toMatchObject({
      detail: expect.stringContaining('登录后会随旅行自动同步到账号'),
      label: '离线可用',
      tone: 'warning',
    })
  })

  it('shows copy tickets as waiting when auto sync is disabled', () => {
    expect(getTicketCloudSyncView(makeTicket({ storageMode: 'copy' }), {
      ...baseContext,
      autoSyncEnabled: false,
    })).toMatchObject({
      detail: expect.stringContaining('重新开启云端自动同步'),
      label: '离线可用',
      tone: 'warning',
    })
  })

  it('shows queued copy tickets from the trip dirty status', () => {
    expect(getTicketCloudSyncView(makeTicket({ storageMode: 'copy' }), {
      ...baseContext,
      autoSyncEntry: {
        dirtyAt: 123,
        status: 'dirty',
      },
    })).toMatchObject({
      label: '等待自动同步',
      tone: 'info',
    })
  })

  it('shows copy tickets waiting for independent blob upload', () => {
    expect(getTicketCloudSyncView(makeTicket({ storageMode: 'copy' }), {
      ...baseContext,
      blobSyncState: {
        cacheStatus: 'cached',
        uploadStatus: 'pending',
      },
    })).toMatchObject({
      label: '等待上传',
      tone: 'info',
    })
  })

  it('shows synced copy tickets with cleared cache as recoverable', () => {
    expect(getTicketCloudSyncView(makeTicket({ storageMode: 'copy' }), {
      ...baseContext,
      blobSyncState: {
        cacheStatus: 'cleared',
        cloudStoragePath: 'user/objects/trip/tickets/ticket/hash-order.pdf',
        uploadStatus: 'synced',
      },
      hasOfflineCache: false,
    })).toMatchObject({
      detail: expect.stringContaining('可按需重新同步'),
      label: '已清理',
      tone: 'success',
    })
  })

  it('shows missing copy tickets without cloud refs as needing reupload', () => {
    expect(getTicketCloudSyncView(makeTicket({ storageMode: 'copy' }), {
      ...baseContext,
      blobSyncState: {
        cacheStatus: 'missing',
        uploadStatus: 'missing',
      },
      hasOfflineCache: false,
    })).toMatchObject({
      label: '需重新上传',
      tone: 'danger',
    })
  })

  it('shows synced copy tickets when the trip sync entry is clean', () => {
    expect(getTicketCloudSyncView(makeTicket({ storageMode: 'copy' }), {
      ...baseContext,
      autoSyncEntry: {
        status: 'synced',
      },
      blobSyncState: {
        cacheStatus: 'cached',
        cloudStoragePath: 'user/objects/trip/tickets/ticket/hash-order.pdf',
        uploadStatus: 'synced',
      },
    })).toMatchObject({
      detail: expect.stringContaining('此设备保留离线缓存'),
      label: '已同步',
      tone: 'success',
    })
  })

  it('shows offline copy tickets as waiting for network', () => {
    expect(getTicketCloudSyncView(makeTicket({ storageMode: 'copy' }), {
      ...baseContext,
      isOnline: false,
    })).toMatchObject({
      label: '等待联网同步',
      tone: 'warning',
    })
  })
})
