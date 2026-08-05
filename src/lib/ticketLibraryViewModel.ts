import type {
  ItineraryItem,
  TicketBlobSyncState,
  TicketCategory,
  TicketMeta,
  TicketScope,
  TicketStorageMode,
} from '../types'
import {
  describeTicketMetaLine,
  getTicketDisplayTitle,
  getTicketFileType,
  getTicketScope,
  getTicketStorageMode,
  normalizeTicketFileName,
  ticketCategoryOptions,
  ticketScopeLabels,
} from './tickets'

export type TicketFilter =
  | 'all'
  | TicketMeta['fileType']
  | TicketStorageMode
  | 'item-bound'
  | 'offline-ready'
  | 'trip-level'
  | 'unassigned'

export type TicketSort = 'newest' | 'oldest' | 'title'
export type BindingTarget = TicketScope | `item:${string}`

export type TicketEditDraft = {
  bindingTarget: BindingTarget
  note: string
  ticketCategory: TicketCategory
  title: string
}

export type TicketBlobPresenceState = Record<string, boolean | undefined>
export type TicketBlobSyncStateMap = Record<string, TicketBlobSyncState | undefined>

export type TicketLibraryStats = {
  cachedCopyCount: number
  copyCount: number
  externalCount: number
  itemBoundCount: number
  referenceCount: number
  tripLevelCount: number
  totalCount: number
  unassignedCount: number
}

export const ticketFilterOptions: Array<{ value: TicketFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'item-bound', label: '行程点' },
  { value: 'trip-level', label: '旅行级' },
  { value: 'unassigned', label: '未绑定' },
  { value: 'image', label: '图片' },
  { value: 'pdf', label: 'PDF' },
  { value: 'other', label: '其他文件' },
  { value: 'copy', label: '已保存文件' },
  { value: 'reference', label: '文件位置' },
  { value: 'external', label: '外部链接' },
  { value: 'offline-ready', label: '离线可用' },
]

export function getVisibleTicketCategoryFilters(stats: TicketLibraryStats) {
  return [
    { count: stats.totalCount, label: '全部', value: 'all' as const },
    { count: stats.itemBoundCount, label: '行程点', value: 'item-bound' as const },
    { count: stats.tripLevelCount, label: '旅行级', value: 'trip-level' as const },
    { count: stats.unassignedCount, label: '未分类', value: 'unassigned' as const },
  ].filter((option) => option.value === 'all' || option.count > 0)
}

export function buildTicketLibraryStats(
  tickets: TicketMeta[],
  ticketBlobPresence: TicketBlobPresenceState,
): TicketLibraryStats {
  return tickets.reduce<TicketLibraryStats>((stats, ticket) => {
    const storageMode = getTicketStorageMode(ticket)
    const scope = getTicketScope(ticket)
    stats.totalCount += 1
    if (storageMode === 'copy') {
      stats.copyCount += 1
      if (ticketBlobPresence[ticket.id]) stats.cachedCopyCount += 1
    } else if (storageMode === 'reference') {
      stats.referenceCount += 1
    } else if (storageMode === 'external') {
      stats.externalCount += 1
    }
    if (scope === 'unassigned') {
      stats.unassignedCount += 1
    } else if (scope === 'item' || ticket.itemId) {
      stats.itemBoundCount += 1
    } else {
      stats.tripLevelCount += 1
    }
    return stats
  }, {
    cachedCopyCount: 0,
    copyCount: 0,
    externalCount: 0,
    itemBoundCount: 0,
    referenceCount: 0,
    tripLevelCount: 0,
    totalCount: 0,
    unassignedCount: 0,
  })
}

export function getTicketFilterSummary(filter: TicketFilter, count: number) {
  return `${getTicketFilterLabel(filter)}：${count} 张`
}

function getTicketFilterLabel(filter: TicketFilter) {
  switch (filter) {
    case 'all': return '全部票据'
    case 'copy': return '保存票据文件'
    case 'reference': return '仅记录位置'
    case 'external': return '外部链接'
    case 'image': return '图片票据'
    case 'pdf': return 'PDF 票据'
    case 'other': return '其他文件'
    case 'item-bound': return '行程点票据'
    case 'offline-ready': return '此设备离线可用'
    case 'trip-level': return '旅行级票据'
    case 'unassigned': return '未分类票据'
  }
}

export function normalizeTicketSearchQuery(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

export function ticketMatchesSearch(
  ticket: TicketMeta,
  normalizedQuery: string,
  itemById: Map<string, ItineraryItem>,
) {
  const item = ticket.itemId ? itemById.get(ticket.itemId) : undefined
  const haystack = normalizeTicketSearchQuery([
    getTicketDisplayTitle(ticket),
    ticket.fileName,
    ticket.note,
    describeTicketMetaLine(ticket),
    item?.title,
    item?.locationName,
    item?.address,
  ].filter(Boolean).join(' '))
  const searchGroups = buildTicketSearchGroups(normalizedQuery)
  return searchGroups.length === 0 || searchGroups.some((group) =>
    group.some((term) => haystack.includes(term)),
  )
}

function buildTicketSearchGroups(normalizedQuery: string) {
  return normalizedQuery
    .split(/[\s,，。；;、]+/)
    .filter(Boolean)
    .map((term) => {
      if (term === '爱丁堡') return ['爱丁堡', 'edinburgh']
      if (term === '伦敦') return ['伦敦', 'london']
      if (term === '剑桥') return ['剑桥', 'cambridge']
      if (term === '牛津') return ['牛津', 'oxford']
      if (term === '曼彻斯特') return ['曼彻斯特', 'manchester']
      if (term === '酒店') return ['酒店', 'hotel', 'royal']
      if (term === '门票') return ['门票', 'ticket', 'castle']
      return [term]
    })
}

export function describeCompactTicketMeta(ticket: TicketMeta) {
  const category = ticketCategoryOptions.find((option) => option.value === (ticket.ticketCategory ?? 'other'))?.label ?? '票据'
  const storageMode = getTicketStorageMode(ticket)
  if (storageMode === 'external') return `${category} · 链接`
  if (storageMode === 'reference') return `${category} · 位置`
  const fileType = ticket.fileType === 'pdf' ? 'PDF' : ticket.fileType === 'image' ? '图片' : '文件'
  return `${category} · ${fileType}`
}

export function getTicketSaveSuccessMessage({
  autoSyncEnabled,
  isOnline,
  signedIn,
}: {
  autoSyncEnabled: boolean
  isOnline: boolean
  signedIn: boolean
}) {
  if (!autoSyncEnabled) {
    return signedIn
      ? '已保存到此设备，重新开启云端自动同步后会随旅行同步。'
      : '已保存到此设备，登录后会自动同步。'
  }
  if (!signedIn) return '已保存到此设备，登录后会自动同步。'
  if (!isOnline) return '已保存到此设备，网络恢复后会自动同步。'
  return '已保存，已加入同步队列。'
}

export function buildTicketMetaInput(
  storageMode: TicketStorageMode,
  {
    selectedFile,
    title,
    note,
    referenceFileName,
    referenceLocation,
    externalUrl,
    ticketCategory,
  }: {
    selectedFile: File | null
    title?: string
    note?: string
    referenceFileName: string
    referenceLocation: string
    externalUrl: string
    ticketCategory: TicketCategory
  },
) {
  if (storageMode === 'copy' && selectedFile) {
    return {
      fileName: selectedFile.name,
      fileType: getTicketFileType(selectedFile),
      mimeType: selectedFile.type || 'application/octet-stream',
      note,
      size: selectedFile.size,
      storageMode,
      ticketCategory,
      title,
    }
  }

  if (storageMode === 'reference') {
    return {
      fileName: normalizeTicketFileName(referenceFileName, title),
      fileType: 'other' as const,
      mimeType: 'text/plain',
      note,
      referenceLocation: referenceLocation.trim(),
      size: 0,
      storageMode,
      ticketCategory,
      title,
    }
  }

  const normalizedUrl = externalUrl.trim()
  return {
    externalUrl: normalizedUrl,
    fileName: normalizeTicketFileName(title, normalizedUrl),
    fileType: 'other' as const,
    mimeType: 'text/uri-list',
    note,
    size: 0,
    storageMode,
    ticketCategory,
    title,
  }
}

export function describeTicketBinding(ticket: TicketMeta, itemById: Map<string, ItineraryItem>) {
  const scope = getTicketScope(ticket)
  if (scope === 'item') {
    const item = ticket.itemId ? itemById.get(ticket.itemId) : undefined
    return item ? `${ticketScopeLabels.item}：${item.title}` : '绑定到行程点（记录缺失）'
  }
  return ticketScopeLabels[scope]
}

export function getTicketBindingTarget(ticket: TicketMeta): BindingTarget {
  const scope = getTicketScope(ticket)
  if (scope === 'item') return ticket.itemId ? `item:${ticket.itemId}` : 'unassigned'
  return scope
}

export function normalizeOptional(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
