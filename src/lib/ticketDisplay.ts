import type { TicketMeta } from '../types'
import { getTicketStorageMode } from './tickets'

export type TicketDisplayIconKind = 'image' | 'pdf' | 'file' | 'reference' | 'external'
export type TicketDisplayToneKey = 'sky' | 'rose' | 'slate' | 'amber' | 'violet'

export type TicketDisplayMeta = {
  iconKind: TicketDisplayIconKind
  secondaryLine: string
  storageLabel: string
  toneKey: TicketDisplayToneKey
  typeLabel: string
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
      storageLabel: '文件位置',
      toneKey: 'amber',
      typeLabel: '位置',
    }
  }

  if (ticket.fileType === 'image') {
    return {
      iconKind: 'image',
      secondaryLine: ticket.fileName,
      storageLabel: '本地副本',
      toneKey: 'sky',
      typeLabel: '图片',
    }
  }

  if (ticket.fileType === 'pdf') {
    return {
      iconKind: 'pdf',
      secondaryLine: ticket.fileName,
      storageLabel: '本地副本',
      toneKey: 'rose',
      typeLabel: 'PDF',
    }
  }

  return {
    iconKind: 'file',
    secondaryLine: ticket.fileName,
    storageLabel: '本地副本',
    toneKey: 'slate',
    typeLabel: '文件',
  }
}
