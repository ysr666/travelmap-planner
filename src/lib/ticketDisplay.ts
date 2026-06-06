import type { TicketMeta } from '../types'
import type { AutoSnapshotBackupEntry } from './autoSnapshotBackup'
import type { TicketBlobSyncState } from '../types'
import { getTicketStorageMode } from './tickets'

export type TicketDisplayIconKind = 'image' | 'pdf' | 'file' | 'reference' | 'external'
export type TicketDisplayToneKey = 'sky' | 'rose' | 'slate' | 'amber' | 'violet'
export type TicketCloudSyncTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export type TicketDisplayMeta = {
  iconKind: TicketDisplayIconKind
  secondaryLine: string
  storageLabel: string
  toneKey: TicketDisplayToneKey
  typeLabel: string
}

export type TicketCloudSyncView = {
  detail: string
  label: string
  tone: TicketCloudSyncTone
}

export type TicketCloudSyncContext = {
  autoSyncEnabled: boolean
  autoSyncEntry?: Pick<AutoSnapshotBackupEntry, 'dirtyAt' | 'lastError' | 'status'> | null
  blobSyncState?: Pick<
    TicketBlobSyncState,
    'cacheStatus' | 'cloudStoragePath' | 'lastError' | 'uploadStatus'
  > | null
  hasOfflineCache?: boolean | null
  isOnline: boolean
  signedIn: boolean
}

export function getTicketDisplayMeta(ticket: TicketMeta): TicketDisplayMeta {
  const storageMode = getTicketStorageMode(ticket)

  if (storageMode === 'external') {
    return {
      iconKind: 'external',
      secondaryLine: ticket.externalUrl?.trim() || ticket.fileName,
      storageLabel: '外部链接',
      toneKey: 'violet',
      typeLabel: '链接',
    }
  }

  if (storageMode === 'reference') {
    return {
      iconKind: 'reference',
      secondaryLine: ticket.referenceLocation?.trim() || ticket.fileName,
      storageLabel: '位置记录',
      toneKey: 'amber',
      typeLabel: '位置',
    }
  }

  if (ticket.fileType === 'image') {
    return {
      iconKind: 'image',
      secondaryLine: ticket.fileName,
      storageLabel: '离线缓存',
      toneKey: 'sky',
      typeLabel: '图片',
    }
  }

  if (ticket.fileType === 'pdf') {
    return {
      iconKind: 'pdf',
      secondaryLine: ticket.fileName,
      storageLabel: '离线缓存',
      toneKey: 'rose',
      typeLabel: 'PDF',
    }
  }

  return {
    iconKind: 'file',
    secondaryLine: ticket.fileName,
    storageLabel: '离线缓存',
    toneKey: 'slate',
    typeLabel: '文件',
  }
}

export function getTicketCloudSyncView(
  ticket: TicketMeta,
  {
    autoSyncEnabled,
    autoSyncEntry,
    blobSyncState,
    hasOfflineCache,
    isOnline,
    signedIn,
  }: TicketCloudSyncContext,
): TicketCloudSyncView {
  const storageMode = getTicketStorageMode(ticket)

  if (storageMode === 'external') {
    return {
      detail: '保存的是外部链接，打开时需要网络，并依赖对应服务可用。',
      label: '外部链接',
      tone: 'neutral',
    }
  }

  if (storageMode === 'reference') {
    return {
      detail: '只记录文件位置，未保存文件内容；请按位置说明在文件 App、网盘或相册中查找。',
      label: '位置记录',
      tone: 'neutral',
    }
  }

  if (blobSyncState?.uploadStatus === 'uploading') {
    return {
      detail: '票据文件正在上传到账号。',
      label: '上传中',
      tone: 'info',
    }
  }

  if (blobSyncState?.uploadStatus === 'pending') {
    return {
      detail: '票据已保存为离线缓存，正在等待自动上传到账号。',
      label: '等待上传',
      tone: 'info',
    }
  }

  if (blobSyncState?.uploadStatus === 'error') {
    return {
      detail: blobSyncState.lastError
        ? `票据文件上传失败：${blobSyncState.lastError}`
        : '票据文件上传失败，可稍后重试。',
      label: '上传失败',
      tone: 'danger',
    }
  }

  if (
    blobSyncState?.uploadStatus === 'synced' &&
    blobSyncState.cloudStoragePath &&
    blobSyncState.cacheStatus !== 'cached'
  ) {
    return {
      detail: '账号中已有这个票据文件，此设备离线缓存已清理，可按需重新同步。',
      label: blobSyncState.cacheStatus === 'cleared' ? '已清理' : '可重新同步',
      tone: 'success',
    }
  }

  if (blobSyncState?.uploadStatus === 'missing') {
    return {
      detail: '此设备没有可上传的票据文件，账号中也没有确认的长期来源。请重新上传票据。',
      label: '需重新上传',
      tone: 'danger',
    }
  }

  if (hasOfflineCache === false) {
    return {
      detail: '离线缓存不可用，可能尚未同步到此设备或已被浏览器清理。请重新同步账号数据或重新上传票据。',
      label: '离线缓存不可用',
      tone: 'danger',
    }
  }

  if (hasOfflineCache == null) {
    return {
      detail: '正在检查此设备上的票据缓存。',
      label: '检查缓存中',
      tone: 'neutral',
    }
  }

  if (!autoSyncEnabled) {
    return {
      detail: signedIn
        ? '已保存在此设备，重新开启云端自动同步后会随旅行进入同步队列。'
        : '已保存在此设备，登录并开启云端自动同步后会随旅行同步。',
      label: '离线可用',
      tone: 'warning',
    }
  }

  if (!signedIn) {
    return {
      detail: '已保存在此设备，登录后会随旅行自动同步到账号。',
      label: '离线可用',
      tone: 'warning',
    }
  }

  if (!isOnline) {
    return {
      detail: '已保存在此设备，网络恢复后会随旅行自动同步。',
      label: '等待联网同步',
      tone: 'warning',
    }
  }

  if (autoSyncEntry?.status === 'uploading') {
    return {
      detail: '正在随旅行同步到账号。',
      label: '同步中',
      tone: 'info',
    }
  }

  if (autoSyncEntry?.status === 'error') {
    return {
      detail: autoSyncEntry.lastError
        ? `上次自动同步失败：${autoSyncEntry.lastError}`
        : '上次自动同步失败，可稍后重试。',
      label: '等待重试',
      tone: 'warning',
    }
  }

  if (autoSyncEntry?.dirtyAt) {
    return {
      detail: '已保存，正在等待后台自动同步到账号。',
      label: '等待自动同步',
      tone: 'info',
    }
  }

  if (autoSyncEntry?.status === 'synced') {
    return {
      detail: '已随旅行同步到账号，此设备保留离线缓存方便查看。',
      label: blobSyncState?.uploadStatus === 'synced' ? '已同步' : '离线缓存可用',
      tone: 'success',
    }
  }

  return {
    detail: '已保存；登录状态下会随旅行自动同步到账号。',
    label: '已保存',
    tone: 'info',
  }
}
