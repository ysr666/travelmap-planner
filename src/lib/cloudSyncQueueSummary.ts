import { db } from '../db/database'
import {
  listAutoSnapshotBackupEntries,
  type AutoSnapshotBackupEntry,
} from './autoSnapshotBackup'
import type {
  SyncObjectType,
  SyncOutboxStatus,
  TicketBlobUploadStatus,
  TicketMeta,
} from '../types'

export type CloudSyncQueueTicketStatus = 'pending' | 'uploading' | 'error' | 'deleted'

export type CloudSyncQueueTicketItem = {
  fileName: string
  label: string
  status: CloudSyncQueueTicketStatus
  ticketId: string
  title: string
  tripId: string
}

export type CloudSyncQueueSummary = {
  conflictCount: number
  dirtyTripCount: number
  errorObjectCount: number
  lastAttemptAt?: number
  lastSuccessAt?: number
  pendingObjectCount: number
  syncItemCount: number
  syncingObjectCount: number
  ticketErrorCount: number
  ticketDeletedCount: number
  ticketPendingCount: number
  ticketUploadingCount: number
  tickets: CloudSyncQueueTicketItem[]
}

export type CloudLoginOnboardingCopy = {
  detail: string
  title: string
  tone: 'info' | 'success' | 'warning'
}

export async function getCloudSyncQueueSummary(tripId?: string): Promise<CloudSyncQueueSummary> {
  if (typeof indexedDB === 'undefined') {
    return buildEmptyQueueSummary()
  }

  const [
    outboxEntries,
    conflicts,
    ticketStates,
    tickets,
  ] = await Promise.all([
    getOutboxEntries(tripId),
    getPendingConflicts(tripId),
    tripId ? db.ticketBlobSyncStates.where('tripId').equals(tripId).toArray() : db.ticketBlobSyncStates.toArray(),
    tripId ? db.ticketMetas.where('tripId').equals(tripId).toArray() : db.ticketMetas.toArray(),
  ])
  const autoEntries = filterAutoEntries(listAutoSnapshotBackupEntries(), tripId)
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  const visibleTickets = ticketStates
    .filter((state) => isVisibleTicketUploadStatus(state.uploadStatus))
    .map((state) => buildTicketItem(ticketById.get(state.ticketId), state.ticketId, state.uploadStatus))
    .sort(compareTicketItems)

  const pendingObjectCount = outboxEntries.filter((entry) => entry.status === 'pending').length
  const syncingObjectCount = outboxEntries.filter((entry) => entry.status === 'syncing').length
  const errorObjectCount = outboxEntries.filter((entry) => entry.status === 'error').length
  const ticketPendingCount = ticketStates.filter((state) => state.uploadStatus === 'pending').length
  const ticketUploadingCount = ticketStates.filter((state) => state.uploadStatus === 'uploading').length
  const ticketErrorCount = ticketStates.filter((state) => state.uploadStatus === 'error').length
  const ticketDeletedCount = ticketStates.filter((state) => state.uploadStatus === 'deleted').length
  const dirtyTripCount = autoEntries.filter((entry) => entry.status === 'dirty' && entry.dirtyAt).length
  const lastSuccessAt = maxNumber(autoEntries.map((entry) => entry.lastSuccessAt))
  const lastAttemptAt = maxNumber(autoEntries.map((entry) => entry.lastAttemptAt))

  return {
    conflictCount: conflicts.length,
    dirtyTripCount,
    errorObjectCount,
    lastAttemptAt,
    lastSuccessAt,
    pendingObjectCount,
    syncingObjectCount,
    syncItemCount: pendingObjectCount +
      syncingObjectCount +
      errorObjectCount +
      conflicts.length +
      ticketPendingCount +
      ticketUploadingCount +
      ticketErrorCount +
      ticketDeletedCount +
      (pendingObjectCount > 0 ? 0 : dirtyTripCount),
    ticketDeletedCount,
    ticketErrorCount,
    ticketPendingCount,
    ticketUploadingCount,
    tickets: visibleTickets.slice(0, 5),
  }
}

function buildEmptyQueueSummary(): CloudSyncQueueSummary {
  return {
    conflictCount: 0,
    dirtyTripCount: 0,
    errorObjectCount: 0,
    pendingObjectCount: 0,
    syncItemCount: 0,
    syncingObjectCount: 0,
    ticketDeletedCount: 0,
    ticketErrorCount: 0,
    ticketPendingCount: 0,
    ticketUploadingCount: 0,
    tickets: [],
  }
}

export function getCloudLoginOnboardingCopy({
  accountTripCount,
  localTripCount,
  pendingQueueCount = 0,
}: {
  accountTripCount: number
  localTripCount: number
  pendingQueueCount?: number
}): CloudLoginOnboardingCopy {
  if (localTripCount > 0 && accountTripCount === 0) {
    return {
      detail: pendingQueueCount > 0
        ? `此设备已有 ${localTripCount} 个旅行，${pendingQueueCount} 项修改会进入同步队列。`
        : `此设备已有 ${localTripCount} 个旅行，正在同步到账号。`,
      title: '正在同步到账号',
      tone: 'info',
    }
  }

  if (localTripCount === 0 && accountTripCount > 0) {
    return {
      detail: `账号中已有 ${accountTripCount} 个旅行，正在同步到此设备。`,
      title: '正在同步到此设备',
      tone: 'info',
    }
  }

  if (localTripCount > 0 && accountTripCount > 0) {
    return {
      detail: '正在比对此设备和账号数据；需要选择方向或字段时会先提示，不会静默覆盖。',
      title: '正在检查账号数据',
      tone: 'warning',
    }
  }

  return {
    detail: '之后创建或导入的旅行会先保存到此设备，登录状态下自动跟随账号同步。',
    title: '账号同步已准备好',
    tone: 'success',
  }
}

export function getObjectTypeSyncLabel(type: SyncObjectType) {
  if (type === 'trip') return '旅行'
  if (type === 'day') return '日期'
  if (type === 'item') return '行程点'
  return '票据'
}

export function getSyncOutboxStatusLabel(status: SyncOutboxStatus) {
  if (status === 'pending') return '等待同步'
  if (status === 'syncing') return '同步中'
  return '同步失败'
}

function buildTicketItem(
  ticket: TicketMeta | undefined,
  ticketId: string,
  status: TicketBlobUploadStatus,
): CloudSyncQueueTicketItem {
  const itemStatus = normalizeTicketUploadStatus(status)
  return {
    fileName: ticket?.fileName ?? ticketId,
    label: getTicketUploadStatusLabel(itemStatus),
    status: itemStatus,
    ticketId,
    title: ticket?.title || ticket?.fileName || ticketId,
    tripId: ticket?.tripId ?? '',
  }
}

function normalizeTicketUploadStatus(status: TicketBlobUploadStatus): CloudSyncQueueTicketStatus {
  if (status === 'uploading') return 'uploading'
  if (status === 'error') return 'error'
  if (status === 'deleted') return 'deleted'
  return 'pending'
}

function getTicketUploadStatusLabel(status: CloudSyncQueueTicketStatus) {
  if (status === 'uploading') return '上传中'
  if (status === 'error') return '上传失败'
  if (status === 'deleted') return '等待删除云端引用'
  return '等待上传'
}

function isVisibleTicketUploadStatus(status: TicketBlobUploadStatus) {
  return status === 'pending' || status === 'uploading' || status === 'error' || status === 'deleted'
}

function compareTicketItems(first: CloudSyncQueueTicketItem, second: CloudSyncQueueTicketItem) {
  const priority: Record<CloudSyncQueueTicketStatus, number> = {
    error: 0,
    uploading: 1,
    pending: 2,
    deleted: 3,
  }
  return priority[first.status] - priority[second.status] || first.title.localeCompare(second.title, 'zh-CN')
}

async function getOutboxEntries(tripId?: string) {
  if (tripId) {
    return db.syncOutbox.where('tripId').equals(tripId).toArray()
  }
  return db.syncOutbox.toArray()
}

async function getPendingConflicts(tripId?: string) {
  if (tripId) {
    return db.objectSyncConflicts.where('[tripId+status]').equals([tripId, 'pending']).toArray()
  }
  return db.objectSyncConflicts.where('status').equals('pending').toArray()
}

function filterAutoEntries(entries: AutoSnapshotBackupEntry[], tripId?: string) {
  return tripId ? entries.filter((entry) => entry.tripId === tripId) : entries
}

function maxNumber(values: Array<number | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return numbers.length > 0 ? Math.max(...numbers) : undefined
}
