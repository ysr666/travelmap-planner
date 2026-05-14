import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileArchive, FileImage, FileText, HardDrive, Link2, MapPinned, Trash2, Upload } from 'lucide-react'
import {
  createTicketMeta,
  deleteTicket,
  getItineraryItem,
  getTrip,
  listDaysByTrip,
  listItemsByTrip,
  listTicketsByTrip,
  saveTicketBlob,
  updateItineraryItem,
} from '../db'
import { TicketPreview } from '../components/TicketPreview'
import { TripNav } from '../components/AppShell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { SectionHeader } from '../components/ui/SectionHeader'
import { describeItemTime } from '../lib/itinerary'
import { getRouteParams, navigateTo } from '../lib/routes'
import {
  describeTicketMetaLine,
  formatFileSize,
  formatTicketCreatedAt,
  getTicketDisplayTitle,
  getTicketFileType,
  getTicketScope,
  getTicketStorageMode,
  isValidExternalUrl,
  normalizeTicketFileName,
  ticketScopeLabels,
} from '../lib/tickets'
import type { Day, ItineraryItem, TicketMeta, TicketScope, TicketStorageMode, Trip } from '../types'

type TicketFilter = 'all' | TicketMeta['fileType'] | 'unassigned'
type BindingTarget = TicketScope | `item:${string}`
type StorageEstimateState = {
  usage?: number
  quota?: number
}

const filterOptions: Array<{ value: TicketFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'pdf', label: 'PDF' },
  { value: 'other', label: '其他' },
  { value: 'unassigned', label: '未绑定' },
]

const storageOptions: Array<{ value: TicketStorageMode; label: string; description: string; icon: ReactNode }> = [
  {
    value: 'copy',
    label: '保存文件副本',
    description: '离线可看，会进入 zip 备份。',
    icon: <Upload className="size-4" />,
  },
  {
    value: 'reference',
    label: '仅记录文件位置',
    description: '不占浏览器空间，但不能直接打开本地路径。',
    icon: <MapPinned className="size-4" />,
  },
  {
    value: 'external',
    label: '添加外部链接',
    description: '适合网盘、邮箱或订单网页链接。',
    icon: <Link2 className="size-4" />,
  },
]

const ticketIcons: Record<TicketMeta['fileType'], ReactNode> = {
  image: <FileImage className="size-5" />,
  pdf: <FileText className="size-5" />,
  other: <FileArchive className="size-5" />,
}

export function TicketLibraryPage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const initialItemId = params.get('itemId')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [days, setDays] = useState<Day[]>([])
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [tickets, setTickets] = useState<TicketMeta[]>([])
  const [storageMode, setStorageMode] = useState<TicketStorageMode>('copy')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [referenceFileName, setReferenceFileName] = useState('')
  const [referenceLocation, setReferenceLocation] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [bindingTarget, setBindingTarget] = useState<BindingTarget>('trip')
  const [filter, setFilter] = useState<TicketFilter>('all')
  const [previewTicket, setPreviewTicket] = useState<TicketMeta | null>(null)
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimateState | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [deletingTicketId, setDeletingTicketId] = useState<string | null>(null)
  const [pendingDeleteTicket, setPendingDeleteTicket] = useState<TicketMeta | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const itemById = useMemo(() => {
    return new Map(items.map((item) => [item.id, item]))
  }, [items])

  const bindingOptions = useMemo(() => {
    return days.flatMap((day, dayIndex) =>
      items
        .filter((item) => item.dayId === day.id)
        .map((item) => ({
          id: item.id,
          label: `Day ${dayIndex + 1} · ${describeItemTime(item)} · ${item.title}`,
        })),
    )
  }, [days, items])

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (filter === 'all') {
        return true
      }

      if (filter === 'unassigned') {
        return getTicketScope(ticket) === 'unassigned'
      }

      return ticket.fileType === filter
    })
  }, [filter, tickets])

  const defaultBindingTarget = useCallback(
    (loadedItems: ItineraryItem[]) => {
      if (initialItemId && loadedItems.some((item) => item.id === initialItemId)) {
        return `item:${initialItemId}` as const
      }

      return 'trip'
    },
    [initialItemId],
  )

  const refreshLibrary = useCallback(async () => {
    if (!tripId) {
      setTrip(null)
      setDays([])
      setItems([])
      setTickets([])
      setLoadError('缺少旅行 ID，请从旅行总览进入票据库。')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setLoadError(null)
    setActionError(null)
    try {
      const foundTrip = await getTrip(tripId)
      if (!foundTrip) {
        setTrip(null)
        setDays([])
        setItems([])
        setTickets([])
        setLoadError('没有找到这个旅行，请返回首页重新选择。')
        return
      }

      const [foundDays, foundItems, foundTickets] = await Promise.all([
        listDaysByTrip(tripId),
        listItemsByTrip(tripId),
        listTicketsByTrip(tripId),
      ])
      setTrip(foundTrip)
      setDays(foundDays)
      setItems(foundItems)
      setTickets(foundTickets)
      setBindingTarget(defaultBindingTarget(foundItems))
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : '读取票据库失败')
    } finally {
      setIsLoading(false)
    }
  }, [defaultBindingTarget, tripId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshLibrary(), 0)
    return () => window.clearTimeout(timeout)
  }, [refreshLibrary])

  useEffect(() => {
    let isActive = true

    async function loadStorageEstimate() {
      if (!navigator.storage?.estimate) {
        return
      }

      const estimate = await navigator.storage.estimate()
      if (isActive) {
        setStorageEstimate({ quota: estimate.quota, usage: estimate.usage })
      }
    }

    void loadStorageEstimate()

    return () => {
      isActive = false
    }
  }, [])

  async function handleSaveTicket() {
    if (!trip) {
      return
    }

    setActionError(null)

    if (storageMode === 'copy' && !selectedFile) {
      setActionError('请选择要保存到本机的文件。')
      return
    }

    if (storageMode === 'reference' && !referenceLocation.trim()) {
      setActionError('请填写文件位置说明。')
      return
    }

    if (storageMode === 'external' && !isValidExternalUrl(externalUrl.trim())) {
      setActionError('外部链接必须以 http:// 或 https:// 开头。')
      return
    }

    if (
      storageMode === 'copy' &&
      selectedFile &&
      selectedFile.size > 20 * 1024 * 1024 &&
      !window.confirm('这个文件超过 20MB，可能占用较多本地空间。仍然继续保存到本机浏览器吗？')
    ) {
      return
    }

    setIsUploading(true)
    let createdTicketId: string | null = null

    try {
      const itemId = bindingTarget.startsWith('item:') ? bindingTarget.slice(5) : undefined
      const scope: TicketScope = itemId ? 'item' : (bindingTarget as TicketScope)
      const normalizedTitle = normalizeOptional(title)
      const normalizedNote = normalizeOptional(note)
      const ticket = await createTicketMeta({
        ...buildTicketMetaInput(storageMode, {
          externalUrl,
          note: normalizedNote,
          referenceFileName,
          referenceLocation,
          selectedFile,
          title: normalizedTitle,
        }),
        itemId,
        scope,
        tripId: trip.id,
      })
      createdTicketId = ticket.id

      if (storageMode === 'copy' && selectedFile) {
        await saveTicketBlob(ticket.id, selectedFile)
      }

      if (itemId) {
        const item = await getItineraryItem(itemId)
        if (!item || item.tripId !== trip.id) {
          throw new Error('绑定的行程点不存在，票据已回滚。')
        }

        const nextTicketIds = item.ticketIds.includes(ticket.id)
          ? item.ticketIds
          : [...item.ticketIds, ticket.id]
        const updatedItem = await updateItineraryItem(item.id, { ticketIds: nextTicketIds })
        if (!updatedItem) {
          throw new Error('绑定到行程点失败，票据已回滚。')
        }
      }

      resetForm()
      await refreshLibrary()
    } catch (caught) {
      if (createdTicketId) {
        await deleteTicket(createdTicketId)
      }
      setActionError(caught instanceof Error ? caught.message : '保存票据失败')
    } finally {
      setIsUploading(false)
    }
  }

  async function confirmDeleteTicket() {
    if (!pendingDeleteTicket) {
      return
    }

    const ticket = pendingDeleteTicket
    setActionError(null)
    setDeletingTicketId(ticket.id)
    try {
      await deleteTicket(ticket.id)
      if (previewTicket?.id === ticket.id) {
        setPreviewTicket(null)
      }
      setPendingDeleteTicket(null)
      await refreshLibrary()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '删除票据失败')
    } finally {
      setDeletingTicketId(null)
    }
  }

  function resetForm() {
    setSelectedFile(null)
    setTitle('')
    setNote('')
    setReferenceFileName('')
    setReferenceLocation('')
    setExternalUrl('')
    setFileInputKey((current) => current + 1)
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Card className="space-y-3">
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-1/2" />
        </Card>
      </div>
    )
  }

  if (loadError || !trip) {
    return (
      <div className="space-y-5">
        <EmptyState
          body={loadError || '请从旅行总览进入票据库。'}
          icon={<FileArchive className="size-6" />}
          title="无法打开票据库"
        />
        <Button className="w-full" onClick={() => navigateTo('home')} variant="secondary">
          返回首页
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-sky-600">{trip.title}</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">票据和订单</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            可保存文件副本，也可只记录文件位置或外部链接。
          </p>
        </div>

        <div className="rounded-xl bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-800">
          清除浏览器数据、私密浏览、系统清理或长期未使用都可能导致票据丢失。重要旅行出发前必须导出 zip 备份到 iCloud Drive。
        </div>

        {storageEstimate ? (
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
            <HardDrive className="size-4 text-slate-400" />
            <span>
              已用 {formatStorageSize(storageEstimate.usage)} / 可用 {formatStorageSize(storageEstimate.quota)}
            </span>
          </div>
        ) : null}
      </Card>

      <TripNav activeRoute="tickets" firstDayId={days[0]?.id} tripId={trip.id} />
      <Button
        className="w-full"
        onClick={() =>
          navigateTo('trip', days[0] ? { tripId: trip.id, dayId: days[0].id } : { tripId: trip.id })
        }
        variant="secondary"
      >
        返回旅行工作台
      </Button>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <Upload className="size-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-950">添加票据</h3>
            <p className="text-xs text-slate-500">文件副本单个建议不超过 20MB。</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {storageOptions.map((option) => (
            <button
              className={`rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                storageMode === option.value
                  ? 'border-sky-200 bg-sky-50 text-sky-800'
                  : 'border-slate-100 bg-white text-slate-600'
              }`}
              key={option.value}
              onClick={() => {
                setStorageMode(option.value)
                setActionError(null)
              }}
              type="button"
            >
              <span className="flex items-center gap-2 text-sm font-bold">
                {option.icon}
                {option.label}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>
            </button>
          ))}
        </div>

        <TextField
          label="显示名称"
          onChange={setTitle}
          placeholder="例如：浅草寺门票二维码"
          value={title}
        />

        {storageMode === 'copy' ? (
          <CopyTicketFields
            fileInputKey={fileInputKey}
            selectedFile={selectedFile}
            setSelectedFile={setSelectedFile}
          />
        ) : null}

        {storageMode === 'reference' ? (
          <ReferenceTicketFields
            fileName={referenceFileName}
            location={referenceLocation}
            setFileName={setReferenceFileName}
            setLocation={setReferenceLocation}
          />
        ) : null}

        {storageMode === 'external' ? (
          <TextField
            label="外部链接"
            onChange={setExternalUrl}
            placeholder="https://..."
            required
            value={externalUrl}
          />
        ) : null}

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">绑定对象</span>
          <select
            className="mt-2 h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
            onChange={(event) => setBindingTarget(event.target.value as BindingTarget)}
            value={bindingTarget}
          >
            <option value="trip">整个旅行：机票、酒店、保险等</option>
            <option value="unassigned">不绑定：暂时未分类</option>
            {bindingOptions.map((option) => (
              <option key={option.id} value={`item:${option.id}`}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">备注</span>
          <textarea
            className="mt-2 min-h-20 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：酒店订单、门票二维码、登机牌"
            value={note}
          />
        </label>

        {actionError ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
            {actionError}
          </p>
        ) : null}

        <Button
          className="w-full"
          icon={<Upload className="size-4" />}
          loading={isUploading}
          onClick={() => void handleSaveTicket()}
        >
          保存票据
        </Button>
      </Card>

      <section className="space-y-3">
        <SectionHeader title="票据库" />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {filterOptions.map((option) => (
            <button
              className={`min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold ${
                filter === option.value ? 'bg-primary text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'
              }`}
              key={option.value}
              onClick={() => setFilter(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

        {filteredTickets.length === 0 ? (
          <EmptyState
            body="添加图片、PDF、文件位置或外部链接后，会显示在这里。"
            icon={<FileArchive className="size-6" />}
            title="暂无票据"
          />
        ) : (
          <div className="space-y-3">
            {filteredTickets.map((ticket) => (
              <TicketCard
                bindingLabel={describeTicketBinding(ticket, itemById)}
                key={ticket.id}
                onDelete={() => setPendingDeleteTicket(ticket)}
                onPreview={() => setPreviewTicket(ticket)}
                ticket={ticket}
              />
            ))}
          </div>
        )}
      </section>

      {previewTicket ? (
        <TicketPreview
          key={previewTicket.id}
          onClose={() => setPreviewTicket(null)}
          ticket={previewTicket}
        />
      ) : null}

      <ConfirmDialog
        body="删除后，本机票据文件、元数据和行程点绑定关系都会被移除。"
        confirmLabel="删除票据"
        loading={Boolean(deletingTicketId)}
        onCancel={() => {
          if (!deletingTicketId) {
            setPendingDeleteTicket(null)
          }
        }}
        onConfirm={() => void confirmDeleteTicket()}
        open={Boolean(pendingDeleteTicket)}
        title={
          pendingDeleteTicket
            ? `确认删除「${getTicketDisplayTitle(pendingDeleteTicket)}」吗？`
            : '确认删除这个票据吗？'
        }
      />
    </div>
  )
}

function TicketCard({
  ticket,
  bindingLabel,
  onPreview,
  onDelete,
}: {
  ticket: TicketMeta
  bindingLabel: string
  onPreview: () => void
  onDelete: () => void
}) {
  const displayTitle = getTicketDisplayTitle(ticket)
  const storageMode = getTicketStorageMode(ticket)
  const shouldShowNote = ticket.note && ticket.note.trim() !== displayTitle

  return (
    <Card className="space-y-3 p-3">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
          {ticketIcons[ticket.fileType]}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-semibold text-slate-950 [overflow-wrap:anywhere]">
            {displayTitle}
          </h3>
          <p className="mt-1 break-words text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
            {ticket.fileName}
          </p>
          <p className="text-xs leading-5 text-slate-400">{describeTicketMetaLine(ticket)}</p>
          <p className="text-xs text-slate-400">{formatTicketCreatedAt(ticket.createdAt)}</p>
        </div>
      </div>

      {shouldShowNote ? (
        <p className="break-words rounded-xl bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-500 [overflow-wrap:anywhere]">
          {ticket.note}
        </p>
      ) : null}

      {storageMode === 'reference' && ticket.referenceLocation ? (
        <p className="break-words rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
          位置：{ticket.referenceLocation}
        </p>
      ) : null}

      {storageMode === 'external' && ticket.externalUrl ? (
        <p className="truncate rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {ticket.externalUrl}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-slate-500">{bindingLabel}</p>
        <div className="flex shrink-0 gap-2">
          <Button className="min-h-9 px-3 text-xs" onClick={onPreview} variant="secondary">
            查看
          </Button>
          <Button
            className="min-h-9 px-3 text-xs text-red-600"
            icon={<Trash2 className="size-4" />}
            onClick={onDelete}
            variant="secondary"
          >
            删除
          </Button>
        </div>
      </div>
    </Card>
  )
}

function CopyTicketFields({
  selectedFile,
  fileInputKey,
  setSelectedFile,
}: {
  selectedFile: File | null
  fileInputKey: number
  setSelectedFile: (file: File | null) => void
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">文件 *</span>
      <input
        className="mt-2 block w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-sky-700"
        key={fileInputKey}
        onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
        type="file"
      />
      {selectedFile ? (
        <span className="mt-2 block rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          已选择：{selectedFile.name} · {formatFileSize(selectedFile.size)}
        </span>
      ) : null}
    </label>
  )
}

function ReferenceTicketFields({
  fileName,
  location,
  setFileName,
  setLocation,
}: {
  fileName: string
  location: string
  setFileName: (value: string) => void
  setLocation: (value: string) => void
}) {
  return (
    <div className="space-y-3">
      <TextField
        label="原文件名"
        onChange={setFileName}
        placeholder="例如：酒店订单.pdf"
        value={fileName}
      />
      <TextField
        label="文件位置说明"
        onChange={setLocation}
        placeholder="例如：iCloud Drive/英国签证/酒店订单.pdf"
        required
        value={location}
      />
      <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
        旅图没有保存这个文件副本，也不能直接打开本地路径。请按你填写的位置到“文件”App、网盘或相册中查找。
      </p>
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <input
        className="mt-2 h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  )
}

function buildTicketMetaInput(
  storageMode: TicketStorageMode,
  {
    selectedFile,
    title,
    note,
    referenceFileName,
    referenceLocation,
    externalUrl,
  }: {
    selectedFile: File | null
    title?: string
    note?: string
    referenceFileName: string
    referenceLocation: string
    externalUrl: string
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
      title,
    }
  }

  if (storageMode === 'reference') {
    const fileName = normalizeTicketFileName(referenceFileName, title)
    return {
      fileName,
      fileType: 'other' as const,
      mimeType: 'text/plain',
      note,
      referenceLocation: referenceLocation.trim(),
      size: 0,
      storageMode,
      title,
    }
  }

  const normalizedUrl = externalUrl.trim()
  const fileName = normalizeTicketFileName(title, normalizedUrl)
  return {
    externalUrl: normalizedUrl,
    fileName,
    fileType: 'other' as const,
    mimeType: 'text/uri-list',
    note,
    size: 0,
    storageMode,
    title,
  }
}

function describeTicketBinding(ticket: TicketMeta, itemById: Map<string, ItineraryItem>) {
  const scope = getTicketScope(ticket)
  if (scope === 'item') {
    const item = ticket.itemId ? itemById.get(ticket.itemId) : undefined
    return item ? `${ticketScopeLabels.item}：${item.title}` : '绑定到行程点（记录缺失）'
  }

  return ticketScopeLabels[scope]
}

function normalizeOptional(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function formatStorageSize(size?: number) {
  if (!size) {
    return '未知'
  }

  return formatFileSize(size)
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}
