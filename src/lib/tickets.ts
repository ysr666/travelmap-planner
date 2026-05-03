import type { TicketMeta, TicketScope } from '../types'

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

export function getTicketScope(ticket: TicketMeta): TicketScope {
  if (ticket.scope) {
    return ticket.scope
  }

  if (ticket.itemId) {
    return 'item'
  }

  return 'unassigned'
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

export function formatFileSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }

  return `${Math.max(1, Math.round(size / 1024))} KB`
}

export function formatTicketCreatedAt(createdAt: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(createdAt))
}
