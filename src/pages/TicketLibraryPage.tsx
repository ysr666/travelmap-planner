import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileArchive, HardDrive, Link2, MapPinned, MoreHorizontal, Pencil, Plus, RefreshCw, Save, Search, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react'
import {
  createTicketMeta,
  deleteTicket,
  getItineraryItem,
  getLedgerSettingsByTrip,
  getTicketBlob,
  getTrip,
  listDaysByTrip,
  listItemsByTrip,
  listLedgerExpenses,
  listLedgerParticipants,
  listTicketsByTrip,
  saveTicketBlob,
  updateItineraryItem,
  updateTicketMeta,
} from '../db'
import { TicketPreview } from '../components/TicketPreview'
import { DocumentPreviewRow } from '../components/tickets/DocumentPreviewRow'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import {
  FIELD_INPUT_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_SELECT_CLASS,
  FIELD_TEXTAREA_CLASS,
} from '../components/ui/FormField'
import { InlineStatus } from '../components/ui/InlineStatus'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { describeItemTime } from '../lib/itinerary'
import { buildLedgerExpenseDraftCandidates, type LedgerExpenseDraftCandidate } from '../lib/ledgerExtraction'
import { getRouteParams, navigateTo } from '../lib/routes'
import {
  describeTicketMetaLine,
  formatFileSize,
  getTicketDisplayTitle,
  getTicketFileType,
  getTicketScope,
  getTicketStorageMode,
  isValidExternalUrl,
  normalizeTicketFileName,
  ticketCategoryOptions,
  ticketScopeLabels,
} from '../lib/tickets'
import {
  getTripAutoSnapshotStatus,
  isAutoSnapshotBackupEnabled,
  subscribeAutoSnapshotBackup,
  type AutoSnapshotBackupEntry,
} from '../lib/autoSnapshotBackup'
import {
  getCurrentUser,
  getSupabaseConfigStatus,
} from '../lib/cloudBackup'
import {
  clearSyncedTicketBlobCache,
  refreshTicketBlobSyncStatesFromCloud,
  restoreTicketBlobCacheFromCloud,
  retryTicketBlobUpload,
} from '../lib/cloudObjectSync'
import { getTicketBlobSyncState } from '../lib/objectSyncLocal'
import { getSupabaseClient } from '../lib/supabaseClient'
import {
  buildTripIntelligenceModel,
  executeTripIntelligenceAction,
  getLedgerDraftCandidateSuggestionKey,
  type TripIntelligenceSuggestion,
} from '../lib/tripIntelligence'
import { useTripIntelligencePersistence } from '../hooks/useTripIntelligencePersistence'
import type {
  Day,
  ItineraryItem,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
  TicketBlobSyncState,
  TicketCategory,
  TicketMeta,
  TicketScope,
  TicketStorageMode,
  Trip,
} from '../types'

type TicketFilter =
  | 'all'
  | TicketMeta['fileType']
  | TicketStorageMode
  | 'item-bound'
  | 'offline-ready'
  | 'trip-level'
  | 'unassigned'
type TicketSort = 'newest' | 'oldest' | 'title'
type BindingTarget = TicketScope | `item:${string}`
type TicketEditDraft = {
  bindingTarget: BindingTarget
  note: string
  ticketCategory: TicketCategory
  title: string
}
type TicketBlobPresenceState = Record<string, boolean | undefined>
type TicketBlobSyncStateMap = Record<string, TicketBlobSyncState | undefined>

const filterOptions: Array<{ value: TicketFilter; label: string }> = [
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

const storageOptions: Array<{ value: TicketStorageMode; label: string; icon: ReactNode }> = [
  {
    value: 'copy',
    label: '文件',
    icon: <Upload className="size-4" />,
  },
  {
    value: 'reference',
    label: '位置',
    icon: <MapPinned className="size-4" />,
  },
  {
    value: 'external',
    label: '链接',
    icon: <Link2 className="size-4" />,
  },
]

export function TicketLibraryPage({
  contextControls,
  embedded = false,
  headerAction,
  tripIdOverride,
}: {
  contextControls?: ReactNode
  embedded?: boolean
  headerAction?: ReactNode
  tripIdOverride?: string | null
} = {}) {
  const params = getRouteParams()
  const tripId = tripIdOverride ?? params.get('tripId')
  const initialItemId = params.get('itemId')
  const initialTicketId = params.get('ticketId')
  const initialTicketQuery = params.get('ticketQuery') ?? ''
  const [trip, setTrip] = useState<Trip | null>(null)
  const [days, setDays] = useState<Day[]>([])
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [tickets, setTickets] = useState<TicketMeta[]>([])
  const [ledgerSettings, setLedgerSettings] = useState<LedgerSettings | null>(null)
  const [ledgerParticipants, setLedgerParticipants] = useState<LedgerParticipant[]>([])
  const [ledgerExpenses, setLedgerExpenses] = useState<LedgerExpense[]>([])
  const [storageMode, setStorageMode] = useState<TicketStorageMode>('copy')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [ticketCategory, setTicketCategory] = useState<TicketCategory>('other')
  const [note, setNote] = useState('')
  const [referenceFileName, setReferenceFileName] = useState('')
  const [referenceLocation, setReferenceLocation] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [bindingTarget, setBindingTarget] = useState<BindingTarget>('trip')
  const [filter, setFilter] = useState<TicketFilter>('all')
  const [sort, setSort] = useState<TicketSort>('newest')
  const [searchQuery, setSearchQuery] = useState(initialTicketQuery)
  const [showAddSheet, setShowAddSheet] = useState(false)
  const [showFilterSheet, setShowFilterSheet] = useState(false)
  const [showSearch, setShowSearch] = useState(Boolean(initialTicketQuery))
  const [previewTicket, setPreviewTicket] = useState<TicketMeta | null>(null)
  const [editingTicket, setEditingTicket] = useState<TicketMeta | null>(null)
  const [ticketBlobPresence, setTicketBlobPresence] = useState<TicketBlobPresenceState>({})
  const [ticketBlobSyncStates, setTicketBlobSyncStates] = useState<TicketBlobSyncStateMap>({})
  const [autoSyncEnabled, setAutoSyncEnabledState] = useState(() => isAutoSnapshotBackupEnabled())
  const [tripSyncEntry, setTripSyncEntry] = useState<AutoSnapshotBackupEntry | null>(() => getTripAutoSnapshotStatus(tripId))
  const [isCloudSignedIn, setIsCloudSignedIn] = useState(false)
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' || !('onLine' in navigator) ? true : navigator.onLine
  ))
  const [fileInputKey, setFileInputKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isSavingTicketEdit, setIsSavingTicketEdit] = useState(false)
  const [deletingTicketId, setDeletingTicketId] = useState<string | null>(null)
  const [ticketBlobActionId, setTicketBlobActionId] = useState<string | null>(null)
  const [ticketIntelligenceActionId, setTicketIntelligenceActionId] = useState<string | null>(null)
  const [pendingDeleteTicket, setPendingDeleteTicket] = useState<TicketMeta | null>(null)
  const [pendingExpenseDraft, setPendingExpenseDraft] = useState<{
    candidate: LedgerExpenseDraftCandidate
    suggestion: TripIntelligenceSuggestion
    ticket: TicketMeta
  } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const {
    appendExecutionResult,
    restoreSuggestionState,
    setSuggestionState,
    suggestionStates,
  } = useTripIntelligencePersistence(tripId)

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
    const normalizedSearchQuery = normalizeTicketSearchQuery(searchQuery)
    const matches = tickets.filter((ticket) => {
      if (normalizedSearchQuery && !ticketMatchesSearch(ticket, normalizedSearchQuery, itemById)) {
        return false
      }

      if (filter === 'all') {
        return true
      }

      if (filter === 'unassigned') {
        return getTicketScope(ticket) === 'unassigned'
      }

      if (filter === 'item-bound') {
        return getTicketScope(ticket) === 'item' || Boolean(ticket.itemId)
      }

      if (filter === 'trip-level') {
        return getTicketScope(ticket) === 'trip'
      }

      if (filter === 'offline-ready') {
        return getTicketStorageMode(ticket) === 'copy' && ticketBlobPresence[ticket.id] === true
      }

      if (filter === 'copy' || filter === 'reference' || filter === 'external') {
        return getTicketStorageMode(ticket) === filter
      }

      return ticket.fileType === filter
    })
    return [...matches].sort((left, right) => {
      if (sort === 'title') {
        return getTicketDisplayTitle(left).localeCompare(getTicketDisplayTitle(right), 'zh-CN')
      }
      return sort === 'oldest' ? left.createdAt - right.createdAt : right.createdAt - left.createdAt
    })
  }, [filter, itemById, searchQuery, sort, ticketBlobPresence, tickets])
  const ticketLibraryStats = useMemo(
    () => buildTicketLibraryStats(tickets, ticketBlobPresence),
    [ticketBlobPresence, tickets],
  )
  const visibleTicketCategoryFilters = getVisibleTicketCategoryFilters(ticketLibraryStats)
  const showEmbeddedScopeFilters = embedded && (visibleTicketCategoryFilters.length > 2 || filter !== 'all')
  const ticketLedgerDraftCandidates = useMemo(() => {
    if (!trip || !ledgerSettings) return []
    return buildLedgerExpenseDraftCandidates({
      bookings: [],
      days,
      existingExpenses: ledgerExpenses,
      inboxEntries: [],
      items,
      participants: ledgerParticipants,
      tickets,
      tripCurrency: ledgerSettings.tripCurrency,
      tripStartDate: trip.startDate,
    }).filter((candidate) => candidate.source.kind === 'ticket')
  }, [days, items, ledgerExpenses, ledgerParticipants, ledgerSettings, tickets, trip])
  const ledgerDraftCandidateBySuggestionKey = useMemo(() => {
    return new Map(ticketLedgerDraftCandidates.map((candidate, index) => [
      getLedgerDraftCandidateSuggestionKey(candidate, index),
      candidate,
    ]))
  }, [ticketLedgerDraftCandidates])
  const ticketIntelligenceModel = useMemo(() => buildTripIntelligenceModel({
    items,
    ledgerDraftCandidates: ticketLedgerDraftCandidates,
    suggestionStates,
    ticketInput: {
      ticketBlobSyncStates: Object.values(ticketBlobSyncStates),
      tickets,
    },
  }), [items, suggestionStates, ticketBlobSyncStates, ticketLedgerDraftCandidates, tickets])

  const defaultBindingTarget = useCallback(
    (loadedItems: ItineraryItem[]) => {
      if (initialItemId && loadedItems.some((item) => item.id === initialItemId)) {
        return `item:${initialItemId}` as const
      }

      return 'trip'
    },
    [initialItemId],
  )

  const updateTicketRouteParam = useCallback((ticketId: string | null) => {
    if (typeof window === 'undefined') return
    const rawHash = window.location.hash.replace(/^#\/?/, '')
    const [rawPath = '', rawQuery = ''] = rawHash.split('?')
    const nextPath = rawPath || (embedded ? 'documents' : 'tickets')
    const nextParams = new URLSearchParams(rawQuery)
    if (ticketId) {
      nextParams.set('ticketId', ticketId)
    } else {
      nextParams.delete('ticketId')
    }
    const nextQuery = nextParams.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/${nextPath}${nextQuery ? `?${nextQuery}` : ''}`)
  }, [embedded])

  const openTicketPreview = useCallback((ticket: TicketMeta) => {
    setPreviewTicket(ticket)
    updateTicketRouteParam(ticket.id)
  }, [updateTicketRouteParam])

  const closeTicketPreview = useCallback(() => {
    setPreviewTicket(null)
    updateTicketRouteParam(null)
  }, [updateTicketRouteParam])

  const refreshLibrary = useCallback(async () => {
    if (!tripId) {
      setTrip(null)
      setDays([])
      setItems([])
      setTickets([])
      setLedgerSettings(null)
      setLedgerParticipants([])
      setLedgerExpenses([])
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
        setLedgerSettings(null)
        setLedgerParticipants([])
        setLedgerExpenses([])
        setLoadError('没有找到这个旅行，请返回首页重新选择。')
        return
      }

      const [foundDays, foundItems, foundTickets, foundLedgerSettings, foundLedgerParticipants, foundLedgerExpenses] = await Promise.all([
        listDaysByTrip(tripId),
        listItemsByTrip(tripId),
        listTicketsByTrip(tripId),
        getLedgerSettingsByTrip(tripId).catch(() => null),
        listLedgerParticipants(tripId).catch(() => []),
        listLedgerExpenses(tripId).catch(() => []),
      ])
      setTrip(foundTrip)
      setDays(foundDays)
      setItems(foundItems)
      setTickets(foundTickets)
      setLedgerSettings(foundLedgerSettings ?? null)
      setLedgerParticipants(foundLedgerParticipants)
      setLedgerExpenses(foundLedgerExpenses)
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
    const timeout = window.setTimeout(() => {
      setSearchQuery(initialTicketQuery)
      if (initialTicketQuery) setShowSearch(true)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [initialTicketQuery])

  useEffect(() => {
    function handleTicketSearchCommand() {
      setShowSearch((current) => {
        const next = !current
        if (next) window.requestAnimationFrame(() => searchInputRef.current?.focus())
        return next
      })
    }
    window.addEventListener('tripmap:ticket-search', handleTicketSearchCommand)
    return () => window.removeEventListener('tripmap:ticket-search', handleTicketSearchCommand)
  }, [])

  useEffect(() => {
    if (!initialTicketId || previewTicket?.id === initialTicketId) return
    const ticket = tickets.find((candidate) => candidate.id === initialTicketId)
    if (!ticket) return
    const timeout = window.setTimeout(() => {
      setPreviewTicket(ticket)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [initialTicketId, previewTicket?.id, tickets])

  useEffect(() => {
    function handleSameRouteNavigation(event: Event) {
      const detail = (event as CustomEvent<{ params?: Record<string, string>; route?: string }>).detail
      if (detail?.route !== 'documents' && detail?.route !== 'tickets') return
      const navParams = detail.params
      const ticketId = navParams?.ticketId
      if (!ticketId) return
      if (typeof navParams.ticketQuery === 'string') {
        setSearchQuery(navParams.ticketQuery)
      }
      const ticket = tickets.find((candidate) => candidate.id === ticketId)
      if (ticket) {
        openTicketPreview(ticket)
      }
    }

    window.addEventListener('tripmap:same-route-navigation', handleSameRouteNavigation)
    return () => window.removeEventListener('tripmap:same-route-navigation', handleSameRouteNavigation)
  }, [openTicketPreview, tickets])

  useEffect(() => {
    let isActive = true

    async function refreshTicketBlobPresence() {
      const copyTickets = tickets.filter((ticket) => getTicketStorageMode(ticket) === 'copy')
      if (copyTickets.length === 0) {
        if (isActive) {
          setTicketBlobPresence({})
          setTicketBlobSyncStates({})
        }
        return
      }
      if (isCloudSignedIn && tripId) {
        await refreshTicketBlobSyncStatesFromCloud(tripId).catch(() => undefined)
      }

      const nextPresence: TicketBlobPresenceState = {}
      const nextSyncStates: TicketBlobSyncStateMap = {}
      await Promise.all(copyTickets.map(async (ticket) => {
        try {
          nextPresence[ticket.id] = Boolean(await getTicketBlob(ticket.id))
          nextSyncStates[ticket.id] = await getTicketBlobSyncState(ticket.id)
        } catch {
          nextPresence[ticket.id] = false
          nextSyncStates[ticket.id] = undefined
        }
      }))
      if (isActive) {
        setTicketBlobPresence(nextPresence)
        setTicketBlobSyncStates(nextSyncStates)
      }
    }

    void refreshTicketBlobPresence()

    return () => {
      isActive = false
    }
  }, [isCloudSignedIn, tickets, tripId, tripSyncEntry])

  useEffect(() => {
    const refreshTripSyncEntry = () => {
      setAutoSyncEnabledState(isAutoSnapshotBackupEnabled())
      setTripSyncEntry(getTripAutoSnapshotStatus(tripId))
    }

    refreshTripSyncEntry()
    return subscribeAutoSnapshotBackup(refreshTripSyncEntry)
  }, [tripId])

  useEffect(() => {
    let isActive = true

    async function refreshCloudSignInState() {
      if (!getSupabaseConfigStatus().configured) {
        if (isActive) {
          setIsCloudSignedIn(false)
        }
        return
      }

      const currentUser = await getCurrentUser().catch(() => null)
      if (isActive) {
        setIsCloudSignedIn(Boolean(currentUser))
      }
    }

    void refreshCloudSignInState()

    const client = getSupabaseClient()
    const subscription = client?.auth.onAuthStateChange(() => {
      void refreshCloudSignInState()
    }).data.subscription

    return () => {
      isActive = false
      subscription?.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const updateOnlineState = () => {
      setIsOnline(typeof navigator === 'undefined' || !('onLine' in navigator) ? true : navigator.onLine)
    }

    window.addEventListener('online', updateOnlineState)
    window.addEventListener('offline', updateOnlineState)
    return () => {
      window.removeEventListener('online', updateOnlineState)
      window.removeEventListener('offline', updateOnlineState)
    }
  }, [])

  async function handleSaveTicket() {
    if (!trip) {
      return
    }

    setActionError(null)
    setActionMessage(null)

    if (storageMode === 'copy' && !selectedFile) {
      setActionError('请选择要保存的票据文件。')
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
      !window.confirm('这个文件超过 20MB，会占用较多离线缓存空间。仍然继续保存票据吗？')
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
          ticketCategory,
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
      setShowAddSheet(false)
      setActionMessage(getTicketSaveSuccessMessage({
        autoSyncEnabled,
        isOnline,
        signedIn: isCloudSignedIn,
      }))
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
    setActionMessage(null)
    setDeletingTicketId(ticket.id)
    try {
      await deleteTicket(ticket.id)
      if (previewTicket?.id === ticket.id) {
        closeTicketPreview()
      }
      setPendingDeleteTicket(null)
      await refreshLibrary()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '删除票据失败')
    } finally {
      setDeletingTicketId(null)
    }
  }

  async function handleClearTicketCache(ticket: TicketMeta) {
    if (!window.confirm(`清理「${getTicketDisplayTitle(ticket)}」的此设备离线缓存？账号中已同步的票据文件不会删除，可稍后重新同步。`)) {
      return
    }
    setActionError(null)
    setActionMessage(null)
    setTicketBlobActionId(ticket.id)
    try {
      await clearSyncedTicketBlobCache(ticket.id)
      await refreshLibrary()
      setActionMessage('已清理此设备离线缓存，账号票据文件仍保留。')
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '清理离线缓存失败')
    } finally {
      setTicketBlobActionId(null)
    }
  }

  async function handleRestoreTicketCache(ticket: TicketMeta) {
    if (!window.confirm(`从账号重新同步「${getTicketDisplayTitle(ticket)}」到此设备离线缓存？`)) {
      return
    }
    setActionError(null)
    setActionMessage(null)
    setTicketBlobActionId(ticket.id)
    try {
      await restoreTicketBlobCacheFromCloud(ticket.id)
      await refreshLibrary()
      setActionMessage('票据文件已重新同步到此设备，离线可用。')
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '重新同步票据文件失败')
    } finally {
      setTicketBlobActionId(null)
    }
  }

  async function handleRetryTicketBlobUpload(ticket: TicketMeta) {
    if (!window.confirm(`重试上传「${getTicketDisplayTitle(ticket)}」到账号？`)) {
      return
    }
    setActionError(null)
    setActionMessage(null)
    setTicketBlobActionId(ticket.id)
    try {
      await retryTicketBlobUpload(ticket.id)
      await refreshLibrary()
      setActionMessage('已加入票据文件上传队列。')
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '重试上传失败')
    } finally {
      setTicketBlobActionId(null)
    }
  }

  function handleTicketIntelligenceAction(suggestion: TripIntelligenceSuggestion) {
    const ticket = tickets.find((candidate) => suggestion.ticketIds.includes(candidate.id))
    if (!ticket || !trip) return
    setActionError(null)
    setActionMessage(null)
    if (suggestion.action?.kind === 'ledger_create_expense_draft_from_candidate') {
      const candidate = ledgerDraftCandidateBySuggestionKey.get(suggestion.key)
      if (!ledgerSettings || !candidate) {
        setActionError('先建立旅行账本后，才能从票据生成费用草稿。')
        return
      }
      setPendingExpenseDraft({ candidate, suggestion, ticket })
      return
    }
    if (suggestion.action?.kind === 'ticket_retry_upload_existing_flow') {
      void handleRetryTicketBlobUpload(ticket)
      return
    }
    if (suggestion.action?.kind === 'ticket_restore_cache_existing_flow') {
      void handleRestoreTicketCache(ticket)
      return
    }
    if (suggestion.action?.targetRoute === 'documents') {
      navigateTo('documents', { tab: 'attachments', ticketId: ticket.id, tripId: trip.id })
      return
    }
    closeTicketPreview()
    if (suggestion.action?.kind === 'ticket_open_binding_existing_flow') {
      setFilter('unassigned')
      setActionMessage('已定位到未绑定票据；现阶段不会自动改写绑定。')
      return
    }
    setActionMessage('已回到票据库；当前建议只作为整理入口，不会自动改写票据。')
  }

  async function confirmCreateExpenseDraft() {
    if (!pendingExpenseDraft || !trip) return
    setTicketIntelligenceActionId(pendingExpenseDraft.suggestion.id)
    setActionError(null)
    setActionMessage(null)
    try {
      const result = await executeTripIntelligenceAction({
        candidate: pendingExpenseDraft.candidate,
        kind: 'ledger_create_expense_draft_from_candidate',
        participants: ledgerParticipants,
        tripId: trip.id,
      })
      if (result.status !== 'completed') {
        setActionError(result.message)
        return
      }
      await appendExecutionResult({
        result,
        source: 'ticket',
        suggestion: pendingExpenseDraft.suggestion,
        title: '已从票据生成费用草稿',
      })
      setPendingExpenseDraft(null)
      setActionMessage(result.message)
      await refreshLibrary()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '生成费用草稿失败')
    } finally {
      setTicketIntelligenceActionId(null)
    }
  }

  function openTicketEditor(ticket: TicketMeta) {
    setActionError(null)
    setActionMessage(null)
    closeTicketPreview()
    setEditingTicket(ticket)
  }

  async function handleSaveTicketEdit(ticket: TicketMeta, draft: TicketEditDraft) {
    setActionError(null)
    setActionMessage(null)
    setIsSavingTicketEdit(true)
    try {
      const itemId = draft.bindingTarget.startsWith('item:') ? draft.bindingTarget.slice(5) : undefined
      const scope: TicketScope = itemId ? 'item' : (draft.bindingTarget as TicketScope)
      const result = await updateTicketMeta(ticket.id, {
        itemId,
        note: normalizeOptional(draft.note),
        scope,
        ticketCategory: draft.ticketCategory,
        title: normalizeOptional(draft.title),
      })
      if (!result) {
        throw new Error('票据不存在，可能已在其他位置删除。')
      }
      setEditingTicket(null)
      await refreshLibrary()
      setActionMessage('票据信息已更新。')
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '更新票据信息失败')
    } finally {
      setIsSavingTicketEdit(false)
    }
  }

  function resetForm() {
    setSelectedFile(null)
    setTitle('')
    setTicketCategory('other')
    setNote('')
    setReferenceFileName('')
    setReferenceLocation('')
    setExternalUrl('')
    setFileInputKey((current) => current + 1)
  }

  function renderDocumentPreviewRow(ticket: TicketMeta) {
    const displayTitle = getTicketDisplayTitle(ticket)
    const blobSyncState = ticketBlobSyncStates[ticket.id]
    const canClearCache = blobSyncState?.uploadStatus === 'synced' && blobSyncState.cacheStatus === 'cached' && Boolean(blobSyncState.cloudStoragePath)
    const canRestoreCache = blobSyncState?.uploadStatus === 'synced' && blobSyncState.cacheStatus !== 'cached' && Boolean(blobSyncState.cloudStoragePath)
    const canRetryUpload = blobSyncState?.uploadStatus === 'error'
    return (
      <DocumentPreviewRow
        action={(
          <TicketActionsMenu
            busy={ticketBlobActionId === ticket.id}
            canClearCache={canClearCache}
            canRestoreCache={canRestoreCache}
            canRetryUpload={canRetryUpload}
            className="relative"
            displayTitle={displayTitle}
            onClearCache={() => void handleClearTicketCache(ticket)}
            onDelete={() => setPendingDeleteTicket(ticket)}
            onEdit={() => openTicketEditor(ticket)}
            onRestoreCache={() => void handleRestoreTicketCache(ticket)}
            onRetryUpload={() => void handleRetryTicketBlobUpload(ticket)}
          />
        )}
        blobSyncState={blobSyncState}
        detail={ticket.note?.trim() || describeTicketBinding(ticket, itemById)}
        key={ticket.id}
        meta={ticket.size > 0 ? formatFileSize(ticket.size) : undefined}
        onOpen={() => openTicketPreview(ticket)}
        subtitle={describeCompactTicketMeta(ticket)}
        ticket={ticket}
        title={displayTitle}
      />
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Card variant="grouped" className="space-y-3">
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
    <div className="flex flex-col gap-3">

      {actionError ? (
        <InlineStatus role="alert" size="md" tone="error">
          {actionError}
        </InlineStatus>
      ) : null}
      {actionMessage ? (
        <InlineStatus role="status" size="md" tone="success">
          {actionMessage}
        </InlineStatus>
      ) : null}

      <section className="space-y-3">
        {embedded ? <h2 className="sr-only">票据</h2> : null}
        <div className="flex min-h-11 items-center justify-between gap-3">
          {embedded ? (
            <div className="min-w-0 flex-1 overflow-x-auto app-scrollbar">
              {contextControls}
            </div>
          ) : (
            <h2 className="min-w-0 truncate text-base font-semibold text-on-surface">
              票据 <span className="text-sm font-normal text-on-surface-variant">{ticketLibraryStats.totalCount}</span>
            </h2>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {headerAction}
            <button
              aria-label="筛选和排序票据"
              className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant tm-focus"
              onClick={() => setShowFilterSheet(true)}
              type="button"
            >
              <SlidersHorizontal className="size-5" />
            </button>
            <button
              aria-label="添加票据"
              className="flex size-11 items-center justify-center rounded-lg bg-primary text-on-primary tm-focus"
              onClick={() => setShowAddSheet(true)}
              type="button"
            >
              <Plus className="size-5" />
            </button>
          </div>
        </div>
        <label className={showSearch ? 'relative block' : 'hidden'}>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
          <input
            aria-label="搜索票据"
            className={`${FIELD_INPUT_CLASS} pl-9`}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索票据、地点或订单"
            ref={searchInputRef}
            value={searchQuery}
          />
        </label>
        {ticketLibraryStats.totalCount > 0 && (!embedded || showEmbeddedScopeFilters) ? (
          <div className="flex gap-2 overflow-x-auto pb-1 app-scrollbar" aria-label="票据分类">
          {visibleTicketCategoryFilters.map((option) => (
            <button
              className={`min-h-10 shrink-0 rounded-full border px-3 text-xs font-semibold tm-focus ${
                filter === option.value
                  ? 'border-primary/45 bg-primary-container/45 text-primary'
                  : 'border-outline-variant/45 bg-surface text-on-surface-variant'
              }`}
              key={option.value}
              onClick={() => setFilter(option.value)}
              type="button"
            >
              {option.label}{embedded ? '' : ` ${option.count}`}
            </button>
          ))}
          </div>
        ) : null}
        <div
          className={filter !== 'all' || searchQuery ? 'flex min-h-6 items-center justify-between gap-3 text-xs tm-muted' : 'sr-only'}
          data-testid="ticket-filter-summary"
        >
          <span className="min-w-0 truncate">{getTicketFilterSummary(filter, filteredTickets.length)}</span>
          {filter !== 'all' ? (
            <button
              className="shrink-0 font-semibold text-primary tm-focus"
              onClick={() => setFilter('all')}
              type="button"
            >
              清除
            </button>
          ) : null}
        </div>

        {filteredTickets.length === 0 ? (
          <div className="space-y-3">
            <EmptyState
              body={tickets.length > 0 ? '换个关键词或清除筛选。' : '添加图片、PDF 或订单链接。'}
              icon={<FileArchive className="size-6" />}
              title={tickets.length > 0 ? '没有匹配的票据' : '暂无票据'}
            />
            {tickets.length === 0 ? (
              <Button className="w-full" icon={<Plus className="size-4" />} onClick={() => setShowAddSheet(true)}>
                添加票据
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="document-preview-list" data-testid="ticket-gallery" id="ticket-gallery">
            {filteredTickets.map(renderDocumentPreviewRow)}
          </div>
        )}
      </section>

      <BottomSheet maxHeight="calc(100dvh - 1rem)" onClose={() => setShowAddSheet(false)} open={showAddSheet} title="添加票据">
        <div className="space-y-4" data-testid="ticket-add-panel">
          <div className="grid grid-cols-3 gap-2">
            {storageOptions.map((option) => (
              <button
                aria-pressed={storageMode === option.value}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-2 text-sm font-semibold transition active:scale-[0.99] ${
                  storageMode === option.value
                    ? 'border-primary/35 bg-primary-container text-on-primary-container'
                    : 'border-outline-variant/30 bg-surface text-on-surface-variant'
                }`}
                key={option.value}
                onClick={() => {
                  setStorageMode(option.value)
                  setActionError(null)
                  setActionMessage(null)
                }}
                type="button"
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>

          <TextField label="显示名称" onChange={setTitle} placeholder="例如：浅草寺门票" value={title} />

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>票据分类</span>
            <select className={FIELD_SELECT_CLASS} onChange={(event) => setTicketCategory(event.target.value as TicketCategory)} value={ticketCategory}>
              {ticketCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          {storageMode === 'copy' ? <CopyTicketFields fileInputKey={fileInputKey} selectedFile={selectedFile} setSelectedFile={setSelectedFile} /> : null}
          {storageMode === 'reference' ? <ReferenceTicketFields fileName={referenceFileName} location={referenceLocation} setFileName={setReferenceFileName} setLocation={setReferenceLocation} /> : null}
          {storageMode === 'external' ? <TextField label="外部链接" onChange={setExternalUrl} placeholder="https://..." required value={externalUrl} /> : null}

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>绑定对象</span>
            <select className={FIELD_SELECT_CLASS} onChange={(event) => setBindingTarget(event.target.value as BindingTarget)} value={bindingTarget}>
              <option value="trip">整个旅行</option>
              <option value="unassigned">暂不分类</option>
              {bindingOptions.map((option) => <option key={option.id} value={`item:${option.id}`}>{option.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>备注</span>
            <textarea className={`${FIELD_TEXTAREA_CLASS} min-h-20 resize-none`} onChange={(event) => setNote(event.target.value)} placeholder="订单号、取票位置等" value={note} />
          </label>

          <Button className="w-full" icon={<Upload className="size-4" />} loading={isUploading} onClick={() => void handleSaveTicket()}>
            保存票据
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet onClose={() => setShowFilterSheet(false)} open={showFilterSheet} title="筛选与排序">
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold tm-muted">筛选</legend>
            <div className="grid grid-cols-2 gap-2">
              {filterOptions.map((option) => (
                <button
                  aria-pressed={filter === option.value}
                  className={`min-h-11 rounded-lg px-3 text-left text-sm font-semibold tm-focus ${
                    filter === option.value ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container text-on-surface'
                  }`}
                  key={option.value}
                  onClick={() => setFilter(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold tm-muted">排序</legend>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['newest', '最新'],
                ['oldest', '最早'],
                ['title', '名称'],
              ] as Array<[TicketSort, string]>).map(([value, label]) => (
                <button
                  aria-pressed={sort === value}
                  className={`min-h-11 rounded-lg px-2 text-sm font-semibold tm-focus ${
                    sort === value ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container text-on-surface'
                  }`}
                  key={value}
                  onClick={() => setSort(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <Button className="w-full" onClick={() => setShowFilterSheet(false)}>完成</Button>
        </div>
      </BottomSheet>

      {previewTicket ? (
        <TicketPreview
          hiddenIntelligenceSuggestions={ticketIntelligenceModel.allSuggestions.filter((suggestion) =>
            suggestion.ticketIds.includes(previewTicket.id) && (suggestion.status === 'ignored' || suggestion.status === 'later'),
          )}
          intelligenceActionBusyId={ticketIntelligenceActionId}
          intelligenceSuggestions={ticketIntelligenceModel.forTicket(previewTicket.id)}
          key={previewTicket.id}
          onChangeTicket={openTicketPreview}
          onClose={closeTicketPreview}
          onEditTicket={openTicketEditor}
          onIntelligenceSuggestionAction={handleTicketIntelligenceAction}
          onIntelligenceSuggestionIgnore={(suggestion) => void setSuggestionState({ status: 'ignored', suggestion })}
          onIntelligenceSuggestionLater={(suggestion) => void setSuggestionState({ status: 'later', suggestion })}
          onIntelligenceSuggestionRestore={(suggestion) => void restoreSuggestionState(suggestion.key)}
          blobSyncState={ticketBlobSyncStates[previewTicket.id]}
          blobSyncStates={ticketBlobSyncStates}
          ticket={previewTicket}
          tickets={filteredTickets}
        />
      ) : null}

      {editingTicket ? (
        <TicketMetadataEditor
          bindingOptions={bindingOptions}
          isSaving={isSavingTicketEdit}
          onCancel={() => {
            if (!isSavingTicketEdit) {
              setEditingTicket(null)
            }
          }}
          onSave={(draft) => void handleSaveTicketEdit(editingTicket, draft)}
          ticket={editingTicket}
        />
      ) : null}

      <ConfirmDialog
        body="删除后，票据文件、元数据和行程点绑定关系都会从此设备移除，并会随旅行同步到账号。"
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

      <ConfirmDialog
        body={pendingExpenseDraft
          ? `将为「${getTicketDisplayTitle(pendingExpenseDraft.ticket)}」生成一条待确认费用草稿。不会自动计入结算。`
          : '将生成一条待确认费用草稿。'}
        cancelLabel="暂不生成"
        confirmLabel="生成草稿"
        loading={Boolean(ticketIntelligenceActionId)}
        onCancel={() => {
          if (!ticketIntelligenceActionId) {
            setPendingExpenseDraft(null)
          }
        }}
        onConfirm={() => void confirmCreateExpenseDraft()}
        open={Boolean(pendingExpenseDraft)}
        tone="default"
        title="从票据生成费用草稿？"
      />
    </div>
  )
}

type TicketLibraryStats = {
  cachedCopyCount: number
  copyCount: number
  externalCount: number
  itemBoundCount: number
  referenceCount: number
  tripLevelCount: number
  totalCount: number
  unassignedCount: number
}

function TicketMetadataEditor({
  bindingOptions,
  isSaving,
  onCancel,
  onSave,
  ticket,
}: {
  bindingOptions: Array<{ id: string; label: string }>
  isSaving: boolean
  onCancel: () => void
  onSave: (draft: TicketEditDraft) => void
  ticket: TicketMeta
}) {
  const [title, setTitle] = useState(ticket.title ?? '')
  const [ticketCategory, setTicketCategory] = useState<TicketCategory>(ticket.ticketCategory ?? 'other')
  const [bindingTarget, setBindingTarget] = useState<BindingTarget>(getTicketBindingTarget(ticket))
  const [note, setNote] = useState(ticket.note ?? '')

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-950/60 px-3 py-4 backdrop-blur-sm sm:items-center"
      data-testid="ticket-metadata-editor"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSaving) onCancel()
      }}
      role="dialog"
    >
      <div className="w-full max-w-[460px] space-y-4 rounded-2xl bg-surface p-4 shadow-[0_18px_50px_rgba(15,23,42,0.22)] ring-1 ring-outline-variant/30 dark:bg-surface-container-high">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-sky-600 dark:text-sky-300">{describeTicketMetaLine(ticket)}</p>
            <h3 className="mt-1 text-lg font-semibold text-on-surface dark:text-on-surface">编辑票据</h3>
          </div>
          <button
            aria-label="关闭编辑"
            className="flex size-11 shrink-0 items-center justify-center rounded-full tm-chip tm-focus"
            disabled={isSaving}
            onClick={onCancel}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <TextField
          label="显示名称"
          onChange={setTitle}
          placeholder={ticket.fileName}
          value={title}
        />

        <label className="block">
          <span className={FIELD_LABEL_CLASS}>票据分类</span>
          <select
            className={FIELD_SELECT_CLASS}
            onChange={(event) => setTicketCategory(event.target.value as TicketCategory)}
            value={ticketCategory}
          >
            {ticketCategoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={FIELD_LABEL_CLASS}>绑定对象</span>
          <select
            className={FIELD_SELECT_CLASS}
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
          <span className={FIELD_LABEL_CLASS}>备注</span>
          <textarea
            className={`${FIELD_TEXTAREA_CLASS} min-h-24 resize-none`}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：订单号、取票位置、同行人说明"
            value={note}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Button disabled={isSaving} onClick={onCancel} variant="secondary">
            取消
          </Button>
          <Button
            icon={<Save className="size-4" />}
            loading={isSaving}
            onClick={() => onSave({ bindingTarget, note, ticketCategory, title })}
          >
            保存修改
          </Button>
        </div>
      </div>
    </div>
  )
}

function getVisibleTicketCategoryFilters(stats: TicketLibraryStats) {
  return [
    { count: stats.totalCount, label: '全部', value: 'all' as const },
    { count: stats.itemBoundCount, label: '行程点', value: 'item-bound' as const },
    { count: stats.tripLevelCount, label: '旅行级', value: 'trip-level' as const },
    { count: stats.unassignedCount, label: '未分类', value: 'unassigned' as const },
  ].filter((option) => option.value === 'all' || option.count > 0)
}

function buildTicketLibraryStats(
  tickets: TicketMeta[],
  ticketBlobPresence: TicketBlobPresenceState,
): TicketLibraryStats {
  return tickets.reduce<TicketLibraryStats>((stats, ticket) => {
    const storageMode = getTicketStorageMode(ticket)
    const scope = getTicketScope(ticket)
    stats.totalCount += 1
    if (storageMode === 'copy') {
      stats.copyCount += 1
      if (ticketBlobPresence[ticket.id]) {
        stats.cachedCopyCount += 1
      }
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

function getTicketFilterSummary(filter: TicketFilter, count: number) {
  return `${getTicketFilterLabel(filter)}：${count} 张`
}

function getTicketFilterLabel(filter: TicketFilter) {
  switch (filter) {
    case 'all':
      return '全部票据'
    case 'copy':
      return '保存票据文件'
    case 'reference':
      return '仅记录位置'
    case 'external':
      return '外部链接'
    case 'image':
      return '图片票据'
    case 'pdf':
      return 'PDF 票据'
    case 'other':
      return '其他文件'
    case 'item-bound':
      return '行程点票据'
    case 'offline-ready':
      return '此设备离线可用'
    case 'trip-level':
      return '旅行级票据'
    case 'unassigned':
      return '未分类票据'
  }
}

function normalizeTicketSearchQuery(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function ticketMatchesSearch(
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

function TicketActionsMenu({
  busy,
  canClearCache,
  canRestoreCache,
  canRetryUpload,
  className,
  displayTitle,
  onClearCache,
  onDelete,
  onEdit,
  onRestoreCache,
  onRetryUpload,
}: {
  busy: boolean
  canClearCache: boolean
  canRestoreCache: boolean
  canRetryUpload: boolean
  className: string
  displayTitle: string
  onClearCache: () => void
  onDelete: () => void
  onEdit: () => void
  onRestoreCache: () => void
  onRetryUpload: () => void
}) {
  return (
    <details className={`group z-10 ${className}`}>
      <summary
        aria-label={`${displayTitle}更多操作`}
        className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg bg-surface/90 text-on-surface shadow-sm backdrop-blur marker:hidden [&::-webkit-details-marker]:hidden tm-focus"
      >
        <MoreHorizontal className="size-5" />
      </summary>
      <div className="absolute right-0 top-11 z-20 w-40 overflow-hidden rounded-lg bg-surface p-1 shadow-xl ring-1 ring-outline-variant/30">
        <button className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-on-surface tm-focus" onClick={onEdit} type="button">
          <Pencil className="size-4" />
          编辑
        </button>
        {canClearCache ? (
          <button className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-on-surface-variant tm-focus" disabled={busy} onClick={onClearCache} type="button">
            <HardDrive className="size-4" />
            清理缓存
          </button>
        ) : null}
        {canRestoreCache ? (
          <button className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-on-surface-variant tm-focus" disabled={busy} onClick={onRestoreCache} type="button">
            <RefreshCw className="size-4" />
            重新同步
          </button>
        ) : null}
        {canRetryUpload ? (
          <button className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-amber-800 tm-focus" disabled={busy} onClick={onRetryUpload} type="button">
            <RefreshCw className="size-4" />
            重试上传
          </button>
        ) : null}
        <button className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-error tm-focus" onClick={onDelete} type="button">
          <Trash2 className="size-4" />
          删除
        </button>
      </div>
    </details>
  )
}

function describeCompactTicketMeta(ticket: TicketMeta) {
  const category = ticketCategoryOptions.find((option) => option.value === (ticket.ticketCategory ?? 'other'))?.label ?? '票据'
  const storageMode = getTicketStorageMode(ticket)
  if (storageMode === 'external') return `${category} · 链接`
  if (storageMode === 'reference') return `${category} · 位置`
  const fileType = ticket.fileType === 'pdf' ? 'PDF' : ticket.fileType === 'image' ? '图片' : '文件'
  return `${category} · ${fileType}`
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
      <span className={FIELD_LABEL_CLASS}>文件 *</span>
      <input
        className="mt-2 block w-full min-w-0 tm-field px-3 py-3 text-sm text-on-surface file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-sky-700 dark:text-outline-variant dark:file:bg-sky-950/45 dark:file:text-sky-300"
        key={fileInputKey}
        onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
        type="file"
      />
      {selectedFile ? (
        <span className="mt-2 block rounded-xl bg-surface-container-low/75 px-3 py-2 text-xs tm-muted ring-1 ring-outline-variant/30 dark:bg-surface-container-highest/40 dark:ring-outline-variant/30">
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
      <InlineStatus tone="warning">
        旅图只记录这个文件的位置说明，不保存文件内容，也不能直接打开本地路径。请按你填写的位置到“文件”App、网盘或相册中查找。
      </InlineStatus>
    </div>
  )
}

function getTicketSaveSuccessMessage({
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

  if (!signedIn) {
    return '已保存到此设备，登录后会自动同步。'
  }

  if (!isOnline) {
    return '已保存到此设备，网络恢复后会自动同步。'
  }

  return '已保存，已加入同步队列。'
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
      <span className={FIELD_LABEL_CLASS}>
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <input
        className={FIELD_INPUT_CLASS}
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
    const fileName = normalizeTicketFileName(referenceFileName, title)
    return {
      fileName,
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
  const fileName = normalizeTicketFileName(title, normalizedUrl)
  return {
    externalUrl: normalizedUrl,
    fileName,
    fileType: 'other' as const,
    mimeType: 'text/uri-list',
    note,
    size: 0,
    storageMode,
    ticketCategory,
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

function getTicketBindingTarget(ticket: TicketMeta): BindingTarget {
  const scope = getTicketScope(ticket)
  if (scope === 'item') {
    return ticket.itemId ? `item:${ticket.itemId}` : 'unassigned'
  }

  return scope
}

function normalizeOptional(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
