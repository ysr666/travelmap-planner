import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { describeItemTime } from '../lib/itinerary'
import { buildLedgerExpenseDraftCandidates, type LedgerExpenseDraftCandidate } from '../lib/ledgerExtraction'
import { getRouteParams, navigateTo } from '../lib/routes'
import {
  getTicketDisplayTitle,
  getTicketScope,
  getTicketStorageMode,
  isValidExternalUrl,
} from '../lib/tickets'
import {
  getTripAutoSnapshotStatus,
  isAutoSnapshotBackupEnabled,
  subscribeAutoSnapshotBackup,
  type AutoSnapshotBackupEntry,
} from '../lib/autoSnapshotBackup'
import { getCurrentUser, getSupabaseConfigStatus } from '../lib/cloudBackup'
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
import { useTripIntelligencePersistence } from './useTripIntelligencePersistence'
import {
  buildTicketLibraryStats,
  buildTicketMetaInput,
  getTicketSaveSuccessMessage,
  getVisibleTicketCategoryFilters,
  normalizeOptional,
  normalizeTicketSearchQuery,
  ticketMatchesSearch,
  type BindingTarget,
  type TicketBlobPresenceState,
  type TicketBlobSyncStateMap,
  type TicketEditDraft,
  type TicketFilter,
  type TicketSort,
} from '../lib/ticketLibraryViewModel'
import type {
  Day,
  ItineraryItem,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
  TicketCategory,
  TicketMeta,
  TicketScope,
  TicketStorageMode,
  Trip,
} from '../types'

export function useTicketLibraryController({
  embedded,
  tripIdOverride,
}: {
  embedded: boolean
  tripIdOverride?: string | null
}) {
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

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  const bindingOptions = useMemo(() => days.flatMap((day, dayIndex) =>
    items
      .filter((item) => item.dayId === day.id)
      .map((item) => ({
        id: item.id,
        label: `Day ${dayIndex + 1} · ${describeItemTime(item)} · ${item.title}`,
      })),
  ), [days, items])

  const filteredTickets = useMemo(() => {
    const normalizedSearchQuery = normalizeTicketSearchQuery(searchQuery)
    const matches = tickets.filter((ticket) => {
      if (normalizedSearchQuery && !ticketMatchesSearch(ticket, normalizedSearchQuery, itemById)) return false
      if (filter === 'all') return true
      if (filter === 'unassigned') return getTicketScope(ticket) === 'unassigned'
      if (filter === 'item-bound') return getTicketScope(ticket) === 'item' || Boolean(ticket.itemId)
      if (filter === 'trip-level') return getTicketScope(ticket) === 'trip'
      if (filter === 'offline-ready') return getTicketStorageMode(ticket) === 'copy' && ticketBlobPresence[ticket.id] === true
      if (filter === 'copy' || filter === 'reference' || filter === 'external') return getTicketStorageMode(ticket) === filter
      return ticket.fileType === filter
    })
    return [...matches].sort((left, right) => {
      if (sort === 'title') return getTicketDisplayTitle(left).localeCompare(getTicketDisplayTitle(right), 'zh-CN')
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

  const ledgerDraftCandidateBySuggestionKey = useMemo(() => new Map(
    ticketLedgerDraftCandidates.map((candidate, index) => [
      getLedgerDraftCandidateSuggestionKey(candidate, index),
      candidate,
    ]),
  ), [ticketLedgerDraftCandidates])

  const ticketIntelligenceModel = useMemo(() => buildTripIntelligenceModel({
    items,
    ledgerDraftCandidates: ticketLedgerDraftCandidates,
    suggestionStates,
    ticketInput: {
      ticketBlobSyncStates: Object.values(ticketBlobSyncStates),
      tickets,
    },
  }), [items, suggestionStates, ticketBlobSyncStates, ticketLedgerDraftCandidates, tickets])

  const defaultBindingTarget = useCallback((loadedItems: ItineraryItem[]) => {
    if (initialItemId && loadedItems.some((item) => item.id === initialItemId)) return `item:${initialItemId}` as const
    return 'trip'
  }, [initialItemId])

  const updateTicketRouteParam = useCallback((ticketId: string | null) => {
    if (typeof window === 'undefined') return
    const rawHash = window.location.hash.replace(/^#\/?/, '')
    const [rawPath = '', rawQuery = ''] = rawHash.split('?')
    const nextPath = rawPath || (embedded ? 'documents' : 'tickets')
    const nextParams = new URLSearchParams(rawQuery)
    if (ticketId) nextParams.set('ticketId', ticketId)
    else nextParams.delete('ticketId')
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
    const timeout = window.setTimeout(() => setPreviewTicket(ticket), 0)
    return () => window.clearTimeout(timeout)
  }, [initialTicketId, previewTicket?.id, tickets])

  useEffect(() => {
    function handleSameRouteNavigation(event: Event) {
      const detail = (event as CustomEvent<{ params?: Record<string, string>; route?: string }>).detail
      if (detail?.route !== 'documents' && detail?.route !== 'tickets') return
      const ticketId = detail.params?.ticketId
      if (!ticketId) return
      if (typeof detail.params?.ticketQuery === 'string') setSearchQuery(detail.params.ticketQuery)
      const ticket = tickets.find((candidate) => candidate.id === ticketId)
      if (ticket) openTicketPreview(ticket)
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
      if (isCloudSignedIn && tripId) await refreshTicketBlobSyncStatesFromCloud(tripId).catch(() => undefined)

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
    return () => { isActive = false }
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
        if (isActive) setIsCloudSignedIn(false)
        return
      }
      const currentUser = await getCurrentUser().catch(() => null)
      if (isActive) setIsCloudSignedIn(Boolean(currentUser))
    }
    void refreshCloudSignInState()
    const client = getSupabaseClient()
    const subscription = client?.auth.onAuthStateChange(() => void refreshCloudSignInState()).data.subscription
    return () => {
      isActive = false
      subscription?.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(
      typeof navigator === 'undefined' || !('onLine' in navigator) ? true : navigator.onLine,
    )
    window.addEventListener('online', updateOnlineState)
    window.addEventListener('offline', updateOnlineState)
    return () => {
      window.removeEventListener('online', updateOnlineState)
      window.removeEventListener('offline', updateOnlineState)
    }
  }, [])

  async function handleSaveTicket() {
    if (!trip) return
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
    if (storageMode === 'copy' && selectedFile && selectedFile.size > 20 * 1024 * 1024 && !window.confirm('这个文件超过 20MB，会占用较多离线缓存空间。仍然继续保存票据吗？')) return

    setIsUploading(true)
    let createdTicketId: string | null = null
    try {
      const itemId = bindingTarget.startsWith('item:') ? bindingTarget.slice(5) : undefined
      const scope: TicketScope = itemId ? 'item' : (bindingTarget as TicketScope)
      const ticket = await createTicketMeta({
        ...buildTicketMetaInput(storageMode, {
          externalUrl,
          note: normalizeOptional(note),
          referenceFileName,
          referenceLocation,
          selectedFile,
          ticketCategory,
          title: normalizeOptional(title),
        }),
        itemId,
        scope,
        tripId: trip.id,
      })
      createdTicketId = ticket.id

      if (storageMode === 'copy' && selectedFile) await saveTicketBlob(ticket.id, selectedFile)
      if (itemId) {
        const item = await getItineraryItem(itemId)
        if (!item || item.tripId !== trip.id) throw new Error('绑定的行程点不存在，票据已回滚。')
        const nextTicketIds = item.ticketIds.includes(ticket.id) ? item.ticketIds : [...item.ticketIds, ticket.id]
        if (!await updateItineraryItem(item.id, { ticketIds: nextTicketIds })) throw new Error('绑定到行程点失败，票据已回滚。')
      }

      resetForm()
      await refreshLibrary()
      setShowAddSheet(false)
      setActionMessage(getTicketSaveSuccessMessage({ autoSyncEnabled, isOnline, signedIn: isCloudSignedIn }))
    } catch (caught) {
      if (createdTicketId) await deleteTicket(createdTicketId)
      setActionError(caught instanceof Error ? caught.message : '保存票据失败')
    } finally {
      setIsUploading(false)
    }
  }

  async function confirmDeleteTicket() {
    if (!pendingDeleteTicket) return
    const ticket = pendingDeleteTicket
    setActionError(null)
    setActionMessage(null)
    setDeletingTicketId(ticket.id)
    try {
      await deleteTicket(ticket.id)
      if (previewTicket?.id === ticket.id) closeTicketPreview()
      setPendingDeleteTicket(null)
      await refreshLibrary()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '删除票据失败')
    } finally {
      setDeletingTicketId(null)
    }
  }

  async function handleClearTicketCache(ticket: TicketMeta) {
    if (!window.confirm(`清理「${getTicketDisplayTitle(ticket)}」的此设备离线缓存？账号中已同步的票据文件不会删除，可稍后重新同步。`)) return
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
    if (!window.confirm(`从账号重新同步「${getTicketDisplayTitle(ticket)}」到此设备离线缓存？`)) return
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
    if (!window.confirm(`重试上传「${getTicketDisplayTitle(ticket)}」到账号？`)) return
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
      if (!result) throw new Error('票据不存在，可能已在其他位置删除。')
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

  return {
    actionError,
    actionMessage,
    bindingOptions,
    bindingTarget,
    closeTicketPreview,
    confirmCreateExpenseDraft,
    confirmDeleteTicket,
    deletingTicketId,
    days,
    editingTicket,
    externalUrl,
    fileInputKey,
    filter,
    filteredTickets,
    handleClearTicketCache,
    handleRestoreTicketCache,
    handleRetryTicketBlobUpload,
    handleSaveTicket,
    handleSaveTicketEdit,
    handleTicketIntelligenceAction,
    isLoading,
    isSavingTicketEdit,
    isUploading,
    items,
    itemById,
    loadError,
    note,
    openTicketEditor,
    openTicketPreview,
    pendingDeleteTicket,
    pendingExpenseDraft,
    previewTicket,
    referenceFileName,
    referenceLocation,
    restoreSuggestionState,
    searchInputRef,
    searchQuery,
    selectedFile,
    setBindingTarget,
    setActionError,
    setActionMessage,
    setEditingTicket,
    setExternalUrl,
    setFilter,
    setNote,
    setPendingDeleteTicket,
    setPendingExpenseDraft,
    setReferenceFileName,
    setReferenceLocation,
    setSearchQuery,
    setSelectedFile,
    setShowAddSheet,
    setShowFilterSheet,
    setSort,
    setStorageMode,
    setSuggestionState,
    setTicketCategory,
    setTitle,
    showAddSheet,
    showEmbeddedScopeFilters,
    showFilterSheet,
    showSearch,
    sort,
    storageMode,
    ticketBlobActionId,
    ticketBlobSyncStates,
    ticketCategory,
    ticketIntelligenceActionId,
    ticketIntelligenceModel,
    ticketLibraryStats,
    tickets,
    title,
    trip,
    visibleTicketCategoryFilters,
  }
}

export type TicketLibraryController = ReturnType<typeof useTicketLibraryController>
