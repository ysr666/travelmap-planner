import type { TicketMeta, TicketScope, TicketStorageMode } from '../types'

export const ticketScopeLabels: Record<TicketScope, string> = {
  trip: '绑定到整个旅行',
  item: '绑定到行程点',
  unassigned: '未绑定',
}

export const ticketFileTypeLabels: Record<TicketMeta['fileType'], string> = {
  image: '图片',
  pdf: 'PDF',
  other: '其他',
}

export const ticketStorageModeLabels: Record<TicketStorageMode, string> = {
  copy: '保存票据文件',
  reference: '仅记录文件位置',
  external: '外部链接',
}

export function getTicketScope(ticket: TicketMeta): TicketScope {
  if (ticket.scope) {
    return ticket.scope
  }

  if (ticket.itemId) {
    return 'item'
  }

  return 'unassigned'
}

export function getTicketStorageMode(ticket: TicketMeta): TicketStorageMode {
  return ticket.storageMode ?? 'copy'
}

export function shouldExpectTicketBlob(ticket: TicketMeta) {
  return getTicketStorageMode(ticket) === 'copy'
}

export function getTicketDisplayTitle(ticket: TicketMeta) {
  return (
    normalizeDisplayText(ticket.title) ||
    normalizeDisplayText(ticket.note) ||
    normalizeDisplayText(ticket.fileName) ||
    normalizeDisplayText(ticket.referenceLocation) ||
    normalizeDisplayText(ticket.externalUrl) ||
    '未命名票据'
  )
}

export function normalizeTicketFileName(fileName: string | undefined, fallback: string | undefined) {
  return normalizeDisplayText(fileName) || normalizeDisplayText(fallback) || '未命名票据'
}

export function getTicketFileType(file: File): TicketMeta['fileType'] {
  if (file.type.startsWith('image/')) {
    return 'image'
  }

  if (file.type === 'application/pdf') {
    return 'pdf'
  }

  return 'other'
}

export function isValidExternalUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function formatFileSize(size: number) {
  if (size <= 0) {
    return '0 KB'
  }

  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }

  return `${Math.ceil(size / 1024)} KB`
}

export function describeTicketStorage(ticket: TicketMeta) {
  const storageMode = getTicketStorageMode(ticket)

  if (storageMode === 'reference') {
    return '仅记录位置'
  }

  if (storageMode === 'external') {
    return '外部链接'
  }

  return `保存票据文件 · 离线缓存 · ${formatFileSize(ticket.size)}`
}

export function describeTicketMetaLine(ticket: TicketMeta) {
  return `${ticketFileTypeLabels[ticket.fileType]} · ${describeTicketStorage(ticket)}`
}

function normalizeDisplayText(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function formatTicketCreatedAt(createdAt: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(createdAt))
}
