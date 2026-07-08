import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  BriefcaseBusiness,
  Cloud,
  Download,
  ExternalLink,
  FileLock2,
  FileText,
  FolderLock,
  KeyRound,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  ShieldCheck,
  TrainFront,
  Trash2,
  UserRoundPlus,
} from 'lucide-react'
import { createItineraryItem, deleteTicket, listDaysByTrip, listItemsByDay, listTicketsByTrip, listTrips } from '../db'
import { TripNav } from '../components/AppShell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { FIELD_INPUT_CLASS, FIELD_LABEL_CLASS, FIELD_SELECT_CLASS, FIELD_TEXTAREA_CLASS, FormField } from '../components/ui/FormField'
import { TimeZoneSelect } from '../components/ui/TimeZoneSelect'
import { TicketLibraryPage } from './TicketLibraryPage'
import { getRouteParams, navigateTo } from '../lib/routes'
import { todayInTimeZone } from '../lib/timeSemantics'
import { getDeviceTimeZone, resolveTripTimeZone } from '../lib/timeZone'
import { extractSensitiveDocumentPreview, type SensitiveDocumentOcrPreview } from '../lib/sensitiveDocumentOcr'
import {
  createTransportBooking,
  createTravelDocument,
  createTravelerProfile,
  deleteTransportBooking,
  deleteTravelDocument,
  addDocumentAttachment,
  encryptExistingTicketAsDocument,
  getTravelVaultStatus,
  initializeTravelVault,
  isSafeExternalAction,
  linkDocumentToTrip,
  listDocumentTripLinks,
  listTransportBookings,
  listTransportSegments,
  listTravelDocuments,
  listTravelerProfiles,
  lockTravelVault,
  openDocumentAttachment,
  unlockTravelVault,
  updateTravelDocument,
  type DecryptedVaultObject,
} from '../lib/travelDocumentCenter'
import { exportEncryptedVaultBackup, importEncryptedVaultBackup } from '../lib/vaultBackup'
import { downloadBlob } from '../lib/backup'
import { listUpcomingReminders, scheduleDocumentExpiryReminder, scheduleTransportReminder } from '../lib/travelReminders'
import { createDisabledFlightStatusProvider } from '../lib/flightStatusProvider'
import type {
  ReminderSchedule,
  ExternalActionKind,
  TicketMeta,
  TransportBooking,
  TransportBookingKind,
  TransportSegment,
  TravelDocumentData,
  TravelDocumentFormat,
  TravelDocumentEntryCount,
  TravelDocumentKind,
  TravelDocumentStatus,
  TravelerProfileData,
  TravelerRole,
  TravelCenterSyncConflict,
  Trip,
} from '../types'
import { listTravelCenterSyncConflicts, resolveTravelCenterSyncConflict, syncTravelCenter } from '../lib/cloudTravelCenter'
import { enableTravelWebPush, showDueLocalReminders } from '../lib/webPush'
import { extractTransportImportPreview, type TransportImportPreview } from '../lib/transportImport'
import { buildTripIntelligenceModel, type TripIntelligenceSuggestion } from '../lib/tripIntelligence'
import { useTripIntelligencePersistence } from '../hooks/useTripIntelligencePersistence'
import { RestoreTripIntelligenceSuggestionButton, TripIntelligenceSuggestionControls } from '../components/trip/TripIntelligenceSuggestionControls'

type CenterTab = 'documents' | 'transport' | 'attachments'
type DraftSegment = Omit<TransportSegment, 'id' | 'bookingId' | 'tripId' | 'sortOrder' | 'createdAt' | 'updatedAt'>

const documentKindLabels: Record<TravelDocumentKind, string> = {
  discount_card: '交通/优惠卡',
  entry_permit: '入境许可',
  insurance: '旅行保险',
  loyalty_card: '会员卡',
  other: '其他资料',
  passport: '护照',
  residence_permit: '居留许可',
  visa: '签证',
}

const bookingKindLabels: Record<TransportBookingKind, string> = {
  bus: '长途巴士',
  cruise: '邮轮',
  ferry: '轮渡',
  flight: '航班',
  other: '其他交通',
  train: '火车',
}

export function TravelDocumentCenterPage() {
  const params = getRouteParams()
  const requestedTab = normalizeTab(params.get('tab'))
  const requestedTripId = params.get('tripId')
  const requestedBookingId = params.get('bookingId')
  const [activeTab, setActiveTab] = useState<CenterTab>(requestedTab)
  const [trips, setTrips] = useState<Trip[]>([])
  const [selectedTripId, setSelectedTripId] = useState(requestedTripId ?? '')
  const [vaultExists, setVaultExists] = useState(false)
  const [vaultUnlocked, setVaultUnlocked] = useState(false)
  const [vaultId, setVaultId] = useState<string | undefined>()
  const [travelers, setTravelers] = useState<Array<DecryptedVaultObject<TravelerProfileData>>>([])
  const [documents, setDocuments] = useState<Array<DecryptedVaultObject<TravelDocumentData>>>([])
  const [documentTripIds, setDocumentTripIds] = useState<Record<string, string[]>>({})
  const [bookings, setBookings] = useState<TransportBooking[]>([])
  const [segmentsByBooking, setSegmentsByBooking] = useState<Record<string, TransportSegment[]>>({})
  const [legacyTickets, setLegacyTickets] = useState<TicketMeta[]>([])
  const [reminders, setReminders] = useState<ReminderSchedule[]>([])
  const [syncConflicts, setSyncConflicts] = useState<TravelCenterSyncConflict[]>([])
  const [passphrase, setPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [migrationTicket, setMigrationTicket] = useState<TicketMeta | null>(null)
  const [deleteAfterMigration, setDeleteAfterMigration] = useState(false)

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId)
  const { restoreSuggestionState, setSuggestionState, suggestionStates } = useTripIntelligencePersistence(selectedTripId)
  const documentIntelligenceModel = useMemo(() => buildTripIntelligenceModel({
    documentInput: {
      documentTripIds,
      documents,
      legacyTickets,
      reminders,
      selectedTrip: selectedTrip ?? null,
      syncConflicts,
      transportBookings: bookings,
      transportSegmentsByBooking: segmentsByBooking,
      vaultUnlocked,
    },
    suggestionStates,
  }), [bookings, documentTripIds, documents, legacyTickets, reminders, selectedTrip, segmentsByBooking, suggestionStates, syncConflicts, vaultUnlocked])
  const documentSuggestions = documentIntelligenceModel.forDocument()
  const hiddenDocumentSuggestions = documentIntelligenceModel.allSuggestions.filter((suggestion) =>
    suggestion.scope === 'document' && (suggestion.status === 'ignored' || suggestion.status === 'later'),
  )

  const refresh = useCallback(async () => {
    const nextTrips = await listTrips()
    const nextSelectedTripId = selectedTripId || requestedTripId || nextTrips[0]?.id || ''
    if (nextSelectedTripId !== selectedTripId) setSelectedTripId(nextSelectedTripId)
    const status = await getTravelVaultStatus()
    setTrips(nextTrips)
    setVaultExists(status.exists)
    setVaultUnlocked(status.unlocked)
    setVaultId(status.vaultId)
    setBookings(await listTransportBookings(nextSelectedTripId || undefined))
    setLegacyTickets(nextSelectedTripId ? await listTicketsByTrip(nextSelectedTripId) : [])
    setReminders(await listUpcomingReminders(200))
    setSyncConflicts(await listTravelCenterSyncConflicts())
    if (status.unlocked) {
      const [nextTravelers, nextDocuments, links] = await Promise.all([
        listTravelerProfiles(),
        listTravelDocuments(),
        listDocumentTripLinks(),
      ])
      setTravelers(nextTravelers)
      setDocuments(nextDocuments)
      setDocumentTripIds(links.reduce<Record<string, string[]>>((result, link) => {
        result[link.data.documentId] = [...(result[link.data.documentId] ?? []), link.data.tripId]
        return result
      }, {}))
    } else {
      setTravelers([])
      setDocuments([])
      setDocumentTripIds({})
    }
  }, [requestedTripId, selectedTripId])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh().catch((caught) => setError(toMessage(caught)))
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    Promise.all(bookings.map(async (booking) => [booking.id, await listTransportSegments(booking.id)] as const))
      .then((entries) => { if (!cancelled) setSegmentsByBooking(Object.fromEntries(entries)) })
      .catch((caught) => { if (!cancelled) setError(toMessage(caught)) })
    return () => { cancelled = true }
  }, [bookings])

  function changeTab(tab: CenterTab) {
    setActiveTab(tab)
    navigateTo('documents', Object.fromEntries(Object.entries({ tab, tripId: selectedTripId }).filter(([, value]) => Boolean(value))) as Record<string, string>)
  }

  async function handleCreateVault() {
    if (passphrase !== confirmPassphrase) return setError('两次输入的恢复口令不一致。')
    await runAction(async () => {
      await initializeTravelVault(passphrase)
      setPassphrase('')
      setConfirmPassphrase('')
      await refresh()
      setMessage('加密旅行资料库已建立。请妥善保存恢复口令，旅图无法替你找回。')
    })
  }

  async function handleUnlock() {
    await runAction(async () => {
      await unlockTravelVault(passphrase)
      setPassphrase('')
      await refresh()
      setMessage('旅行资料库已在此设备解锁。')
    })
  }

  async function handleLock() {
    await lockTravelVault()
    await refresh()
    setMessage('旅行资料库已锁定。')
  }

  async function handleExportVault() {
    await runAction(async () => {
      const blob = await exportEncryptedVaultBackup()
      downloadBlob(blob, `tripmap-encrypted-vault-${todayInTimeZone(getDeviceTimeZone())}.zip`)
      setMessage('已导出加密资料库。恢复时仍需要你的恢复口令。')
    })
  }

  async function handleImportVault(file: File) {
    await runAction(async () => {
      const result = await importEncryptedVaultBackup(file)
      await refresh()
      setMessage(`已恢复加密资料库包：${result.objectCount} 项资料、${result.blobCount} 个附件。请输入原恢复口令解锁。`)
    })
  }

  async function handleMigrateTicket() {
    if (!migrationTicket) return
    await runAction(async () => {
      const result = await encryptExistingTicketAsDocument({
        document: {
          format: migrationTicket.storageMode === 'external' ? 'electronic' : 'both',
          kind: inferDocumentKind(migrationTicket),
          notes: migrationTicket.note,
          status: 'active',
          title: migrationTicket.title || migrationTicket.fileName,
          travelerIds: [],
        },
        ticketId: migrationTicket.id,
      })
      if (selectedTripId) await linkDocumentToTrip(result.documentId, selectedTripId)
      if (deleteAfterMigration) await deleteTicket(migrationTicket.id)
      setMigrationTicket(null)
      setDeleteAfterMigration(false)
      await refresh()
      setMessage(deleteAfterMigration ? '已转入加密资料库，并删除原明文票据。' : '已复制到加密资料库；原票据仍保留。')
    })
  }

  async function handleCloudSync() {
    await runAction(async () => {
      const result = await syncTravelCenter()
      await refresh()
      setMessage(`资料同步完成：上传 ${result.uploaded} 项，下载 ${result.downloaded} 项，删除 ${result.deleted} 项${result.conflicts ? `，有 ${result.conflicts} 项冲突待处理` : ''}。`)
    })
  }

  async function handleEnablePush() {
    await runAction(async () => {
      await enableTravelWebPush()
      const localCount = await showDueLocalReminders()
      setMessage(`本机通知已启用${localCount ? `，已补发 ${localCount} 条到期提醒` : ''}。`)
    })
  }

  async function handleResolveConflict(id: string, choice: 'local' | 'remote') {
    await runAction(async () => {
      await resolveTravelCenterSyncConflict(id, choice)
      await syncTravelCenter()
      await refresh()
      setMessage(choice === 'local' ? '已保留本机版本并重新同步。' : '已采用云端版本。')
    })
  }

  function handleDocumentSuggestion(suggestion: TripIntelligenceSuggestion) {
    setError(null)
    const actionKind = suggestion.action?.kind
    if (actionKind === 'document_open_sync_conflicts') {
      scrollToDocumentCenterElement('travel-document-sync-section')
      return
    }
    if (actionKind === 'document_review_transport') {
      changeTab('transport')
      scrollToDocumentCenterElement('travel-document-transport-section')
      return
    }
    if (actionKind === 'document_open_existing_migration') {
      changeTab('documents')
      if (!vaultUnlocked) {
        setMessage('先解锁旅行资料库，再预览转入加密资料库。')
        return
      }
      const ticket = legacyTickets.find((entry) => suggestion.ticketIds.includes(entry.id))
      if (ticket) {
        setMigrationTicket(ticket)
        return
      }
      scrollToDocumentCenterElement('travel-document-migration-section')
      return
    }
    changeTab('documents')
    scrollToDocumentCenterElement('travel-document-documents-section')
  }

  async function runAction(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try { await action() } catch (caught) { setError(toMessage(caught)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5 pb-4">
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="min-h-11 rounded-xl px-2 text-xs font-semibold text-primary tm-focus">安全资料</p>
            <h2 className="mt-1 text-xl font-semibold text-on-surface">旅行资料中心</h2>
            <p className="mt-1 text-sm leading-6 tm-muted">集中管理证件、大交通订单和原有票据附件。</p>
          </div>
          {vaultUnlocked ? (
            <button aria-label="锁定资料库" className="flex size-11 shrink-0 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-container" onClick={() => void handleLock()} type="button">
              <Lock className="size-5" />
            </button>
          ) : null}
        </div>
        {selectedTrip ? <TripNav activeRoute="documents" firstDayId={null} tripId={selectedTrip.id} /> : null}
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-outline-variant/30 bg-surface-container p-1">
          <TabButton active={activeTab === 'documents'} icon={<FileLock2 className="size-4" />} label="证件" onClick={() => changeTab('documents')} />
          <TabButton active={activeTab === 'transport'} icon={<TrainFront className="size-4" />} label="大交通" onClick={() => changeTab('transport')} />
          <TabButton active={activeTab === 'attachments'} icon={<FileText className="size-4" />} label="附件" onClick={() => changeTab('attachments')} />
        </div>
        {trips.length > 0 ? (
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>当前旅行</span>
            <select className={FIELD_SELECT_CLASS} onChange={(event) => setSelectedTripId(event.target.value)} value={selectedTripId}>
              {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}
            </select>
          </label>
        ) : null}
      </section>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      {documentSuggestions.length > 0 || hiddenDocumentSuggestions.length > 0 ? (
        <DocumentIntelligencePanel
          hiddenSuggestions={hiddenDocumentSuggestions}
          onAction={handleDocumentSuggestion}
          onIgnore={(suggestion) => void setSuggestionState({ status: 'ignored', suggestion })}
          onLater={(suggestion) => void setSuggestionState({ status: 'later', suggestion })}
          onRestore={(suggestion) => void restoreSuggestionState(suggestion.key)}
          suggestions={documentSuggestions}
        />
      ) : null}

      {activeTab !== 'attachments' ? (
        <VaultAccessPanel
          busy={busy}
          confirmPassphrase={confirmPassphrase}
          exists={vaultExists}
          onConfirmPassphraseChange={setConfirmPassphrase}
          onCreate={() => void handleCreateVault()}
          onExport={() => void handleExportVault()}
          onImport={(file) => void handleImportVault(file)}
          onPassphraseChange={setPassphrase}
          onUnlock={() => void handleUnlock()}
          passphrase={passphrase}
          unlocked={vaultUnlocked}
        />
      ) : null}

      <CloudControls
        busy={busy}
        conflicts={syncConflicts}
        onEnablePush={() => void handleEnablePush()}
        onResolve={handleResolveConflict}
        onSync={() => void handleCloudSync()}
      />

      {activeTab === 'documents' && vaultUnlocked ? (
        <DocumentsPanel
          documents={documents}
          documentTripIds={documentTripIds}
          legacyTickets={legacyTickets}
          onChanged={refresh}
          onDelete={(id) => runAction(async () => { await deleteTravelDocument(id); await refresh(); setMessage('证件资料已删除。') })}
          onMigrate={setMigrationTicket}
          selectedTrip={selectedTrip}
          travelers={travelers}
          vaultId={vaultId!}
        />
      ) : null}

      {activeTab === 'transport' ? (
        <TransportPanel
          bookings={bookings}
          onChanged={refresh}
          onDelete={(id) => runAction(async () => { await deleteTransportBooking(id); await refresh(); setMessage('交通订单已删除。') })}
          segmentsByBooking={segmentsByBooking}
          selectedBookingId={requestedBookingId}
          selectedTrip={selectedTrip}
          travelers={travelers}
          vaultUnlocked={vaultUnlocked}
        />
      ) : null}

      {activeTab === 'attachments' ? (
        selectedTripId ? <section className="space-y-3"><div><h3 className="text-base font-semibold text-on-surface">票据和订单</h3><p className="text-xs tm-muted">原有旅行附件继续使用现有离线与云同步机制。</p></div><TicketLibraryPage embedded tripIdOverride={selectedTripId} /></section> : (
          <EmptyState body="先创建或选择旅行，再保存该旅行的票据附件。" icon={<FileText className="size-6" />} title="尚未选择旅行" />
        )
      ) : null}

      <ConfirmDialog
        body={migrationTicket ? `将复制「${migrationTicket.title || migrationTicket.fileName}」及其本地文件到端到端加密资料库。转换完成前不会修改原票据。` : ''}
        confirmLabel="确认转入"
        loading={busy}
        onCancel={() => { if (!busy) setMigrationTicket(null) }}
        onConfirm={() => void handleMigrateTicket()}
        open={Boolean(migrationTicket)}
        testId="travel-document-migration-confirm-dialog"
        title="转入加密资料库"
      >
        <label className="mt-3 flex items-center gap-2 text-sm text-on-surface-variant">
          <input checked={deleteAfterMigration} onChange={(event) => setDeleteAfterMigration(event.target.checked)} type="checkbox" />
          校验并写入成功后删除原明文票据
        </label>
      </ConfirmDialog>
    </div>
  )
}

function CloudControls({ busy, conflicts, onEnablePush, onResolve, onSync }: {
  busy: boolean
  conflicts: TravelCenterSyncConflict[]
  onEnablePush: () => void
  onResolve: (id: string, choice: 'local' | 'remote') => Promise<void>
  onSync: () => void
}) {
  return <section className="space-y-3" data-testid="travel-document-sync-section" id="travel-document-sync-section"><div className="grid grid-cols-2 gap-2"><Button icon={<Cloud className="size-4" />} loading={busy} onClick={onSync} variant="secondary">同步资料</Button><Button icon={<Bell className="size-4" />} disabled={busy} onClick={onEnablePush} variant="secondary">启用通知</Button></div>{conflicts.length ? <div className="space-y-2 rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/25"><h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">资料同步冲突</h3><p className="text-xs text-amber-800 dark:text-amber-300">加密对象按整项选择，不会尝试合并密文字段。</p>{conflicts.map((conflict) => <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2" key={conflict.id}><span className="min-w-0 flex-1 truncate text-xs">{conflict.objectType} · {conflict.objectId}</span><button className="min-h-11 rounded-xl px-2 text-xs font-semibold text-primary tm-focus" onClick={() => void onResolve(conflict.id, 'local')} type="button">保留本机</button><button className="min-h-11 rounded-xl px-2 text-xs font-semibold text-primary tm-focus" onClick={() => void onResolve(conflict.id, 'remote')} type="button">使用云端</button></div>)}</div> : null}</section>
}

function DocumentIntelligencePanel({
  hiddenSuggestions,
  onAction,
  onIgnore,
  onLater,
  onRestore,
  suggestions,
}: {
  hiddenSuggestions: TripIntelligenceSuggestion[]
  onAction: (suggestion: TripIntelligenceSuggestion) => void
  onIgnore: (suggestion: TripIntelligenceSuggestion) => void
  onLater: (suggestion: TripIntelligenceSuggestion) => void
  onRestore: (suggestion: TripIntelligenceSuggestion) => void
  suggestions: TripIntelligenceSuggestion[]
}) {
  return (
    <Card className="space-y-3" data-testid="travel-document-intelligence-panel" variant="grouped">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-on-surface">资料建议</h3>
          <p className="text-xs leading-5 tm-muted">只显示已脱敏的资料类型、状态和数量；具体内容仍在原有流程中确认。</p>
        </div>
        <span className="rounded-full bg-primary-container px-2 py-1 text-xs font-semibold text-on-primary-container">{suggestions.length} 项</span>
      </div>
      <div className="space-y-2">
        {suggestions.map((suggestion) => (
          <div className="flex min-h-11 items-center gap-1 rounded-xl border border-outline-variant/30 bg-surface-container-low px-1" key={suggestion.id}>
            <button className="flex min-h-11 min-w-0 flex-1 items-start gap-3 px-2 py-2 text-left tm-focus" data-testid="travel-document-intelligence-action" onClick={() => onAction(suggestion)} type="button">
              <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${suggestion.severity === 'high' ? 'text-red-600' : suggestion.severity === 'medium' ? 'text-amber-600' : 'text-primary'}`} />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{suggestion.title}</span>
                <span className="mt-0.5 block break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">{suggestion.message}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-primary">{suggestion.action?.label ?? '查看'}</span>
            </button>
            <TripIntelligenceSuggestionControls onIgnore={onIgnore} onLater={onLater} suggestion={suggestion} />
          </div>
        ))}
        {hiddenSuggestions.length > 0 ? (
          <details className="rounded-lg border border-outline-variant/20 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold tm-muted">已隐藏资料建议（{hiddenSuggestions.length}）</summary>
            <div className="mt-2 space-y-1">
              {hiddenSuggestions.map((suggestion) => (
                <div className="flex min-h-11 items-center justify-between gap-2" key={suggestion.key}>
                  <span className="min-w-0 truncate text-xs tm-muted">{suggestion.title}</span>
                  <RestoreTripIntelligenceSuggestionButton onRestore={onRestore} suggestion={suggestion} />
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </Card>
  )
}

function VaultAccessPanel({ busy, confirmPassphrase, exists, onConfirmPassphraseChange, onCreate, onExport, onImport, onPassphraseChange, onUnlock, passphrase, unlocked }: {
  busy: boolean
  confirmPassphrase: string
  exists: boolean
  onConfirmPassphraseChange: (value: string) => void
  onCreate: () => void
  onExport: () => void
  onImport: (file: File) => void
  onPassphraseChange: (value: string) => void
  onUnlock: () => void
  passphrase: string
  unlocked: boolean
}) {
  if (unlocked) return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/25">
      <span className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300"><ShieldCheck className="size-5" />资料库已解锁</span>
      <Button icon={<Download className="size-4" />} onClick={onExport} variant="subtle">加密备份</Button>
    </div>
  )
  return (
    <Card variant="grouped" className="space-y-3">
      <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-primary-container text-on-primary-container"><KeyRound className="size-5" /></div><div><h3 className="font-semibold text-on-surface">{exists ? '解锁旅行资料库' : '建立加密资料库'}</h3><p className="text-xs tm-muted">恢复口令不会上传，丢失后无法找回。</p></div></div>
      <label className="block"><span className={FIELD_LABEL_CLASS}>恢复口令</span><input autoComplete="current-password" className={FIELD_INPUT_CLASS} onChange={(event) => onPassphraseChange(event.target.value)} type="password" value={passphrase} /></label>
      {!exists ? <label className="block"><span className={FIELD_LABEL_CLASS}>再次输入</span><input autoComplete="new-password" className={FIELD_INPUT_CLASS} onChange={(event) => onConfirmPassphraseChange(event.target.value)} type="password" value={confirmPassphrase} /></label> : null}
      <Button className="w-full" icon={exists ? <LockOpen className="size-4" /> : <FolderLock className="size-4" />} loading={busy} onClick={exists ? onUnlock : onCreate}>{exists ? '解锁' : '建立资料库'}</Button>
      {!exists ? <label className="block cursor-pointer rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-3 text-center text-sm font-semibold text-on-surface"><span>从加密备份恢复</span><input accept=".zip,application/zip" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = '' }} type="file" /></label> : null}
    </Card>
  )
}

function DocumentsPanel({ documents, documentTripIds, legacyTickets, onChanged, onDelete, onMigrate, selectedTrip, travelers, vaultId }: {
  documents: Array<DecryptedVaultObject<TravelDocumentData>>
  documentTripIds: Record<string, string[]>
  legacyTickets: TicketMeta[]
  onChanged: () => Promise<void>
  onDelete: (id: string) => void
  onMigrate: (ticket: TicketMeta) => void
  selectedTrip?: Trip
  travelers: Array<DecryptedVaultObject<TravelerProfileData>>
  vaultId: string
}) {
  const [showTravelerForm, setShowTravelerForm] = useState(false)
  const [showDocumentForm, setShowDocumentForm] = useState(false)
  return (
    <div className="space-y-5" data-testid="travel-document-documents-section" id="travel-document-documents-section">
      <div className="grid grid-cols-2 gap-2">
        <Button icon={<UserRoundPlus className="size-4" />} onClick={() => setShowTravelerForm((value) => !value)} variant="secondary">添加旅客</Button>
        <Button icon={<Plus className="size-4" />} onClick={() => setShowDocumentForm((value) => !value)}>添加证件</Button>
      </div>
      {showTravelerForm ? <TravelerForm onSaved={async () => { setShowTravelerForm(false); await onChanged() }} /> : null}
      {showDocumentForm ? <DocumentForm onSaved={async () => { setShowDocumentForm(false); await onChanged() }} selectedTrip={selectedTrip} travelers={travelers} vaultId={vaultId} /> : null}
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-on-surface">旅客</h3>
        {travelers.length === 0 ? <EmptyState body="旅客资料会加密保存，可供签证和交通订单复用。" icon={<UserRoundPlus className="size-6" />} title="还没有旅客" /> : (
          <div className="rounded-xl border border-outline-variant/30 bg-surface-container">
            {travelers.map((traveler) => <div className="flex items-center justify-between border-b border-outline-variant/20 px-4 py-3 last:border-b-0" key={traveler.id}><span className="font-medium text-on-surface">{traveler.data.displayName}</span><span className="text-xs tm-muted">{travelerRoleLabel(traveler.data.role)}</span></div>)}
          </div>
        )}
      </section>
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-on-surface">证件与权益</h3>
        {documents.length === 0 ? <EmptyState body="护照、签证、保险和优惠卡会显示在这里。" icon={<FileLock2 className="size-6" />} title="还没有加密资料" /> : (
          <div className="space-y-2">
            {documents.map((document) => <DocumentRow document={document} linked={documentTripIds[document.id]?.includes(selectedTrip?.id ?? '') ?? false} key={document.id} onDelete={() => onDelete(document.id)} />)}
          </div>
        )}
      </section>
      {legacyTickets.length > 0 ? (
        <section className="space-y-3" data-testid="travel-document-migration-section" id="travel-document-migration-section">
          <div><h3 className="text-base font-semibold text-on-surface">转入加密资料库</h3><p className="text-xs tm-muted">先复制和校验；只有你勾选后才会删除原票据。</p></div>
          <div className="rounded-xl border border-outline-variant/30 bg-surface-container">
            {legacyTickets.slice(0, 8).map((ticket) => <div className="flex items-center gap-3 border-b border-outline-variant/20 px-4 py-3 last:border-b-0" key={ticket.id}><FileText className="size-5 shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{ticket.title || ticket.fileName}</span><Button onClick={() => onMigrate(ticket)} variant="subtle">预览转入</Button></div>)}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function TravelerForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<TravelerRole>('self')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [nationality, setNationality] = useState('')
  const [busy, setBusy] = useState(false)
  return <Card variant="grouped" className="space-y-3"><h3 className="font-semibold">新旅客</h3><FormField label="显示名称" onChange={setDisplayName} required value={displayName} /><label className="block"><span className={FIELD_LABEL_CLASS}>关系</span><select className={FIELD_SELECT_CLASS} onChange={(event) => setRole(event.target.value as TravelerRole)} value={role}><option value="self">本人</option><option value="companion">同行人</option><option value="child">儿童</option><option value="other">其他</option></select></label><FormField label="出生日期" onChange={setDateOfBirth} type="date" value={dateOfBirth} /><FormField label="国籍" onChange={setNationality} value={nationality} /><Button className="w-full" loading={busy} onClick={() => { setBusy(true); void createTravelerProfile({ dateOfBirth: dateOfBirth || undefined, displayName, nationality: nationality || undefined, role }).then(onSaved).finally(() => setBusy(false)) }}>保存旅客</Button></Card>
}

function DocumentForm({ onSaved, selectedTrip, travelers, vaultId }: { onSaved: () => Promise<void>; selectedTrip?: Trip; travelers: Array<DecryptedVaultObject<TravelerProfileData>>; vaultId: string }) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<TravelDocumentKind>('visa')
  const [format, setFormat] = useState<TravelDocumentFormat>('electronic')
  const [status, setStatus] = useState<TravelDocumentStatus>('active')
  const [travelerIds, setTravelerIds] = useState<string[]>([])
  const [documentNumber, setDocumentNumber] = useState('')
  const [applicationNumber, setApplicationNumber] = useState('')
  const [issuingCountry, setIssuingCountry] = useState('')
  const [destinationCountry, setDestinationCountry] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [entryCount, setEntryCount] = useState<TravelDocumentEntryCount>('unknown')
  const [maxStayDays, setMaxStayDays] = useState('')
  const [officialUrl, setOfficialUrl] = useState('')
  const [physicalLocation, setPhysicalLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [ocrPreview, setOcrPreview] = useState<SensitiveDocumentOcrPreview | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [remind, setRemind] = useState(true)
  const [reminderTimeZone, setReminderTimeZone] = useState(getDeviceTimeZone())
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      const document = await createTravelDocument({ applicationNumber: applicationNumber || undefined, attachmentIds: [], destinationCountry: destinationCountry || undefined, documentNumber: documentNumber || undefined, entryCount, format, issuingCountry: issuingCountry || undefined, kind, maxStayDays: maxStayDays ? Number(maxStayDays) : undefined, notes: notes || undefined, officialUrl: officialUrl || undefined, physicalLocation: physicalLocation || undefined, status, title, travelerIds, validFrom: validFrom || undefined, validUntil: validUntil || undefined })
      let attachmentIds: string[] = []
      if (file) {
        const attachment = await addDocumentAttachment(document.id, file)
        attachmentIds = [attachment.id]
        await updateTravelDocument(document.id, { ...document.data, attachmentIds })
      }
      if (selectedTrip) await linkDocumentToTrip(document.id, selectedTrip.id)
      if (remind && validUntil) await scheduleDocumentExpiryReminder({ documentId: document.id, timeZone: reminderTimeZone, validUntil, vaultId })
      await onSaved()
    } finally { setBusy(false) }
  }
  async function recognize() {
    if (!file) return
    setOcrBusy(true)
    try { setOcrPreview(await extractSensitiveDocumentPreview(file)) } finally { setOcrBusy(false) }
  }
  function applyOcr() {
    for (const candidate of ocrPreview?.candidates ?? []) {
      if (candidate.field === 'documentNumber') setDocumentNumber(candidate.value)
      if (candidate.field === 'validFrom') setValidFrom(candidate.value)
      if (candidate.field === 'validUntil') setValidUntil(candidate.value)
    }
  }
  return <Card variant="grouped" className="space-y-3"><div><h3 className="font-semibold">新证件资料</h3><p className="text-xs tm-muted">原件和字段均加密；OCR 只在本机运行。</p></div><FormField label="名称" onChange={setTitle} required value={title} /><div className="grid grid-cols-2 gap-2"><label><span className={FIELD_LABEL_CLASS}>类型</span><select className={FIELD_SELECT_CLASS} onChange={(event) => setKind(event.target.value as TravelDocumentKind)} value={kind}>{Object.entries(documentKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className={FIELD_LABEL_CLASS}>载体</span><select className={FIELD_SELECT_CLASS} onChange={(event) => setFormat(event.target.value as TravelDocumentFormat)} value={format}><option value="paper">纸质</option><option value="electronic">电子</option><option value="both">纸质+电子</option></select></label></div><label><span className={FIELD_LABEL_CLASS}>状态</span><select className={FIELD_SELECT_CLASS} onChange={(event) => setStatus(event.target.value as TravelDocumentStatus)} value={status}><option value="draft">准备中</option><option value="applied">已申请</option><option value="approved">已批准</option><option value="active">有效</option><option value="rejected">被拒</option><option value="expired">已过期</option><option value="cancelled">已取消</option></select></label>{travelers.length ? <div><span className={FIELD_LABEL_CLASS}>持有人</span><div className="mt-2 flex flex-wrap gap-2">{travelers.map((traveler) => <label className="tm-chip flex items-center gap-2 px-3 py-2 text-xs" key={traveler.id}><input checked={travelerIds.includes(traveler.id)} onChange={(event) => setTravelerIds((current) => event.target.checked ? [...current, traveler.id] : current.filter((id) => id !== traveler.id))} type="checkbox" />{traveler.data.displayName}</label>)}</div></div> : null}<div className="grid grid-cols-2 gap-2"><FormField label="签发国家/地区" onChange={setIssuingCountry} value={issuingCountry} /><FormField label="适用国家/地区" onChange={setDestinationCountry} value={destinationCountry} /></div><div className="grid grid-cols-2 gap-2"><FormField label="证件号码" onChange={setDocumentNumber} value={documentNumber} /><FormField label="申请编号" onChange={setApplicationNumber} value={applicationNumber} /></div><div className="grid grid-cols-2 gap-2"><FormField label="生效日期" onChange={setValidFrom} type="date" value={validFrom} /><FormField label="有效期至" onChange={setValidUntil} type="date" value={validUntil} /></div><div className="grid grid-cols-2 gap-2"><label><span className={FIELD_LABEL_CLASS}>入境次数</span><select className={FIELD_SELECT_CLASS} onChange={(event) => setEntryCount(event.target.value as TravelDocumentEntryCount)} value={entryCount}><option value="unknown">未注明</option><option value="single">单次</option><option value="double">两次</option><option value="multiple">多次</option><option value="unlimited">不限</option></select></label><FormField label="最长停留天数" onChange={setMaxStayDays} type="number" value={maxStayDays} /></div><FormField label="官方查询链接" onChange={setOfficialUrl} value={officialUrl} /><FormField label="纸质原件位置" onChange={setPhysicalLocation} value={physicalLocation} /><label><span className={FIELD_LABEL_CLASS}>加密原件</span><input accept="image/*,.pdf,application/pdf" className={FIELD_INPUT_CLASS} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setOcrPreview(null) }} type="file" /></label>{file ? <Button icon={<RefreshCw className="size-4" />} loading={ocrBusy} onClick={() => void recognize()} variant="secondary">本机识别字段</Button> : null}{ocrPreview ? <div className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3"><div className="flex items-center justify-between"><span className="text-sm font-semibold">识别预览</span><Button onClick={applyOcr} variant="subtle">应用候选字段</Button></div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs tm-muted">{ocrPreview.extractedText || '未识别到文本'}</pre></div> : null}<label><span className={FIELD_LABEL_CLASS}>备注</span><textarea className={`${FIELD_TEXTAREA_CLASS} min-h-20`} onChange={(event) => setNotes(event.target.value)} value={notes} /></label>{validUntil ? <div className="space-y-2 rounded-xl border border-outline-variant/30 p-3"><label className="flex items-center gap-2 text-sm"><input checked={remind} onChange={(event) => setRemind(event.target.checked)} type="checkbox" /><Bell className="size-4" />提前 30 天提醒</label>{remind ? <TimeZoneSelect label="提醒时区" onChange={setReminderTimeZone} value={reminderTimeZone} /> : null}</div> : null}<Button className="w-full" loading={busy} onClick={() => void save()}>加密保存</Button></Card>
}

function DocumentRow({ document, linked, onDelete }: { document: DecryptedVaultObject<TravelDocumentData>; linked: boolean; onDelete: () => void }) {
  const [opening, setOpening] = useState(false)
  async function downloadAttachment() {
    const attachmentId = document.data.attachmentIds[0]
    if (!attachmentId) return
    setOpening(true)
    try {
      const file = await openDocumentAttachment(attachmentId)
      downloadBlob(file, file.name)
    } finally { setOpening(false) }
  }
  return <div className="rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-3"><div className="flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary-container"><FileLock2 className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="truncate font-semibold text-on-surface">{document.data.title}</h4>{linked ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">本次旅行</span> : null}</div><p className="mt-1 text-xs tm-muted">{documentKindLabels[document.data.kind]}{document.data.validUntil ? ` · 有效期至 ${document.data.validUntil}` : ''}</p></div>{document.data.attachmentIds.length ? <Button aria-label="解密下载原件" className="min-h-11 px-2 text-xs" icon={<Download className="size-4" />} loading={opening} onClick={() => void downloadAttachment()} variant="subtle">原件</Button> : null}<button aria-label="删除资料" className="flex size-11 items-center justify-center rounded-xl text-error tm-focus" onClick={onDelete} type="button"><Trash2 className="size-4" /></button></div></div>
}

function TransportPanel({ bookings, onChanged, onDelete, segmentsByBooking, selectedBookingId, selectedTrip, travelers, vaultUnlocked }: { bookings: TransportBooking[]; onChanged: () => Promise<void>; onDelete: (id: string) => void; segmentsByBooking: Record<string, TransportSegment[]>; selectedBookingId?: string | null; selectedTrip?: Trip; travelers: Array<DecryptedVaultObject<TravelerProfileData>>; vaultUnlocked: boolean }) {
  const [showForm, setShowForm] = useState(false)
  useEffect(() => {
    if (!selectedBookingId || !bookings.some((booking) => booking.id === selectedBookingId)) return
    window.setTimeout(() => document.getElementById(`transport-booking-${selectedBookingId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
  }, [bookings, selectedBookingId])
  if (!selectedTrip) return <EmptyState body="大交通订单需要归属具体旅行。" icon={<TrainFront className="size-6" />} title="先选择旅行" />
  return <div className="space-y-4" data-testid="travel-document-transport-section" id="travel-document-transport-section"><Button className="w-full" icon={<Plus className="size-4" />} onClick={() => setShowForm((value) => !value)}>添加大交通订单</Button>{showForm ? <TransportForm onSaved={async () => { setShowForm(false); await onChanged() }} travelers={travelers} trip={selectedTrip} vaultUnlocked={vaultUnlocked} /> : null}{bookings.length === 0 ? <EmptyState body="往返、多程和联程订单会按交通段展示。" icon={<BriefcaseBusiness className="size-6" />} title="还没有交通订单" /> : <div className="space-y-3">{bookings.map((booking) => <BookingRow booking={booking} highlighted={booking.id === selectedBookingId} key={booking.id} onDelete={() => onDelete(booking.id)} segments={segmentsByBooking[booking.id] ?? []} />)}</div>}</div>
}

function TransportForm({ onSaved, travelers, trip, vaultUnlocked }: { onSaved: () => Promise<void>; travelers: Array<DecryptedVaultObject<TravelerProfileData>>; trip: Trip; vaultUnlocked: boolean }) {
  const zone = resolveTripTimeZone(trip)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<TransportBookingKind>('flight')
  const [providerName, setProviderName] = useState('')
  const [segments, setSegments] = useState<DraftSegment[]>([makeDraftSegment('flight', trip.startDate, zone)])
  const [pnr, setPnr] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [travelerIds, setTravelerIds] = useState<string[]>([])
  const [externalLabel, setExternalLabel] = useState('承运方官网')
  const [externalUrl, setExternalUrl] = useState('')
  const [externalKind, setExternalKind] = useState<ExternalActionKind>('official')
  const [createItineraryItems, setCreateItineraryItems] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPreview, setImportPreview] = useState<TransportImportPreview | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const updateSegment = (index: number, patch: Partial<DraftSegment>) => setSegments((current) => current.map((segment, currentIndex) => currentIndex === index ? { ...segment, ...patch } : segment))
  async function save() {
    const externalActions = externalUrl ? [{ id: crypto.randomUUID(), kind: externalKind, label: externalLabel || '外部链接', url: externalUrl }] : []
    if (externalActions.some((action) => !isSafeExternalAction(action))) throw new Error('外部链接必须使用 HTTPS。')
    setBusy(true)
    try {
      const secret = pnr || orderNumber || travelerIds.length ? { orderNumber: orderNumber || undefined, pnr: pnr || undefined, travelerIds } : undefined
      if (secret && !vaultUnlocked) throw new Error('PNR、订单号和乘客属于敏感信息，请先解锁资料库。')
      const result = await createTransportBooking({ booking: { externalActions, kind, providerName: providerName || undefined, sourceLabel: 'manual', status: 'confirmed', title, tripId: trip.id }, secret, segments })
      for (const segment of result.segments) {
        await scheduleTransportReminder({ kind: 'departure', minutesBefore: 120, segment })
        if (segment.kind === 'flight') await scheduleTransportReminder({ kind: 'check_in', minutesBefore: 24 * 60, segment })
      }
      if (createItineraryItems) await addSegmentsToItinerary(result.segments, trip)
      await onSaved()
    } finally { setBusy(false) }
  }
  async function recognizeImport() {
    if (!importFile && !importText.trim()) return
    setImportBusy(true)
    try { setImportPreview(await extractTransportImportPreview({ file: importFile ?? undefined, pastedText: importText })) } finally { setImportBusy(false) }
  }
  function applyImportPreview() {
    if (!importPreview) return
    const nextKind = importPreview.kind
    setKind(nextKind)
    setTitle(importPreview.title)
    setProviderName(importPreview.providerName ?? '')
    setSegments([{
      ...makeDraftSegment(nextKind, importPreview.departureDate ?? trip.startDate, zone),
      arrivalDate: importPreview.arrivalDate ?? importPreview.departureDate ?? trip.startDate,
      arrivalPlace: importPreview.arrivalPlace ?? '',
      arrivalTime: importPreview.arrivalTime,
      departurePlace: importPreview.departurePlace ?? '',
      departureTime: importPreview.departureTime,
      serviceNumber: importPreview.serviceNumber,
    }])
    setShowImport(false)
  }
  function changeKind(nextKind: TransportBookingKind) { setKind(nextKind); setSegments((current) => current.map((segment) => ({ ...segment, kind: nextKind }))) }
  return <Card variant="grouped" className="space-y-3"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">新交通订单</h3><p className="text-xs tm-muted">票面班次保持原值；外部动态不会覆盖订单。</p></div><Button icon={<FileText className="size-4" />} onClick={() => setShowImport((value) => !value)} variant="secondary">本机导入</Button></div>{showImport ? <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3"><label><span className={FIELD_LABEL_CLASS}>粘贴票据文本</span><textarea className={`${FIELD_TEXTAREA_CLASS} min-h-24`} onChange={(event) => setImportText(event.target.value)} value={importText} /></label><label><span className={FIELD_LABEL_CLASS}>或选择票据文件</span><input accept="image/*,.pdf,.txt,.eml,.html" className={FIELD_INPUT_CLASS} onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} type="file" /></label><Button className="w-full" loading={importBusy} onClick={() => void recognizeImport()} variant="secondary">生成本机预览</Button>{importPreview ? <div className="space-y-2 rounded-lg border border-outline-variant/30 bg-surface p-3"><p className="text-sm font-semibold">{importPreview.title}</p><p className="text-xs tm-muted">{bookingKindLabels[importPreview.kind]} · {importPreview.departureDate || '日期待补充'} · {importPreview.departurePlace || '出发地待补充'} → {importPreview.arrivalPlace || '到达地待补充'}</p>{importPreview.warnings.map((warning) => <p className="text-xs text-amber-700" key={warning}>{warning}</p>)}<Button className="w-full" onClick={applyImportPreview}>应用到表单</Button></div> : null}</div> : null}<FormField label="订单名称" onChange={setTitle} required value={title} /><div className="grid grid-cols-2 gap-2"><label><span className={FIELD_LABEL_CLASS}>交通类型</span><select className={FIELD_SELECT_CLASS} onChange={(event) => changeKind(event.target.value as TransportBookingKind)} value={kind}>{Object.entries(bookingKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><FormField label="承运方/平台" onChange={setProviderName} value={providerName} /></div>{segments.map((segment, index) => <SegmentForm index={index} key={index} onChange={(patch) => updateSegment(index, patch)} onRemove={segments.length > 1 ? () => setSegments((current) => current.filter((_, currentIndex) => currentIndex !== index)) : undefined} segment={segment} />)}<Button className="w-full" icon={<Plus className="size-4" />} onClick={() => setSegments((current) => [...current, makeDraftSegment(kind, current.at(-1)?.arrivalDate ?? trip.startDate, current.at(-1)?.arrivalTimeZone ?? zone)])} variant="secondary">增加交通段</Button><div className="border-t border-outline-variant/20 pt-3"><p className="mb-2 text-sm font-semibold">敏感订单信息（加密）</p><div className="grid grid-cols-2 gap-2"><FormField label="PNR/预订编号" onChange={setPnr} value={pnr} /><FormField label="订单号" onChange={setOrderNumber} value={orderNumber} /></div>{travelers.length ? <div className="mt-2 flex flex-wrap gap-2">{travelers.map((traveler) => <label className="tm-chip flex items-center gap-2 px-3 py-2 text-xs" key={traveler.id}><input checked={travelerIds.includes(traveler.id)} onChange={(event) => setTravelerIds((current) => event.target.checked ? [...current, traveler.id] : current.filter((id) => id !== traveler.id))} type="checkbox" />{traveler.data.displayName}</label>)}</div> : null}</div><div className="border-t border-outline-variant/20 pt-3"><p className="mb-2 text-sm font-semibold">外部跳转</p><div className="grid grid-cols-2 gap-2"><label><span className={FIELD_LABEL_CLASS}>操作</span><select className={FIELD_SELECT_CLASS} onChange={(event) => setExternalKind(event.target.value as ExternalActionKind)} value={externalKind}><option value="official">官网</option><option value="check_in">值机</option><option value="manage_booking">管理订单</option><option value="railway">铁路</option><option value="hanglv">航旅纵横</option><option value="other">其他</option></select></label><FormField label="显示名称" onChange={setExternalLabel} value={externalLabel} /></div><FormField label="HTTPS 链接" onChange={setExternalUrl} value={externalUrl} /></div><label className="flex items-start gap-2 rounded-xl border border-outline-variant/30 p-3 text-sm"><input checked={createItineraryItems} className="mt-1" onChange={(event) => setCreateItineraryItems(event.target.checked)} type="checkbox" /><span><strong className="block">确认后同步创建行程点</strong><span className="text-xs tm-muted">仅写入已有对应日期；每段交通仍保留两地当地时间与时区。</span></span></label><Button className="w-full" loading={busy} onClick={() => void save()}>保存订单并建立提醒</Button></Card>
}

function SegmentForm({ index, onChange, onRemove, segment }: { index: number; onChange: (patch: Partial<DraftSegment>) => void; onRemove?: () => void; segment: DraftSegment }) {
  return <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3"><div className="flex items-center justify-between"><span className="text-sm font-semibold">第 {index + 1} 段</span>{onRemove ? <button aria-label="删除交通段" className="flex size-11 items-center justify-center rounded-xl tm-focus" onClick={onRemove} type="button"><Trash2 className="size-4 text-error" /></button> : null}</div><div className="grid grid-cols-2 gap-2"><FormField label="承运方" onChange={(value) => onChange({ carrier: value })} value={segment.carrier ?? ''} /><FormField label="航班/车次" onChange={(value) => onChange({ serviceNumber: value })} value={segment.serviceNumber ?? ''} /></div><div className="grid grid-cols-2 gap-2"><FormField label="出发地" onChange={(value) => onChange({ departurePlace: value })} required value={segment.departurePlace} /><FormField label="到达地" onChange={(value) => onChange({ arrivalPlace: value })} required value={segment.arrivalPlace} /></div><div className="grid grid-cols-2 gap-2"><FormField label="出发日期" onChange={(value) => onChange({ departureDate: value })} type="date" value={segment.departureDate} /><FormField label="出发时间" onChange={(value) => onChange({ departureTime: value })} type="time" value={segment.departureTime ?? ''} /></div><TimeZoneSelect label="出发时区" onChange={(value) => onChange({ departureTimeZone: value })} value={segment.departureTimeZone} /><div className="grid grid-cols-2 gap-2"><FormField label="到达日期" onChange={(value) => onChange({ arrivalDate: value })} type="date" value={segment.arrivalDate} /><FormField label="到达时间" onChange={(value) => onChange({ arrivalTime: value })} type="time" value={segment.arrivalTime ?? ''} /></div><TimeZoneSelect label="到达时区" onChange={(value) => onChange({ arrivalTimeZone: value })} value={segment.arrivalTimeZone} /></div>
}

function BookingRow({ booking, highlighted, onDelete, segments }: { booking: TransportBooking; highlighted?: boolean; onDelete: () => void; segments: TransportSegment[] }) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  async function checkStatus() {
    const segment = segments.find((item) => item.kind === 'flight')
    if (!segment) return
    const status = await createDisabledFlightStatusProvider().getStatus(segment)
    setStatusMessage(status.warnings[0])
  }
  return <div className={`rounded-xl border bg-surface-container p-4 ${highlighted ? 'border-primary ring-2 ring-primary/20' : 'border-outline-variant/30'}`} id={`transport-booking-${booking.id}`}><div className="flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><TrainFront className="size-5" /></div><div className="min-w-0 flex-1"><h4 className="font-semibold text-on-surface">{booking.title}</h4><p className="text-xs tm-muted">{bookingKindLabels[booking.kind]} · {segments.length} 段 · {booking.status}</p></div><button aria-label="删除订单" className="flex size-11 items-center justify-center rounded-xl text-error tm-focus" onClick={onDelete} type="button"><Trash2 className="size-4" /></button></div><div className="mt-3 space-y-2 border-t border-outline-variant/20 pt-3">{segments.map((segment) => <div className="text-sm" key={segment.id}><span className="font-medium">{segment.departureDate} {segment.departureTime || '--:--'} · {segment.departurePlace}</span><span className="mx-2 tm-muted">→</span><span>{segment.arrivalDate} {segment.arrivalTime || '--:--'} · {segment.arrivalPlace}</span><p className="text-xs tm-muted">{segment.carrier || '承运方待补充'} {segment.serviceNumber || ''} · {segment.departureTimeZone} → {segment.arrivalTimeZone}</p></div>)}</div>{booking.externalActions.length ? <div className="mt-3 flex flex-wrap gap-2">{booking.externalActions.map((action) => <a className="tm-chip inline-flex min-h-11 items-center gap-2 px-3 text-xs font-semibold" href={action.url} key={action.id} rel="noreferrer" target="_blank"><ExternalLink className="size-4" />{action.label}</a>)}</div> : null}{booking.kind === 'flight' ? <Button className="mt-3 w-full" onClick={() => void checkStatus()} variant="secondary">检查航班动态接口</Button> : null}{statusMessage ? <p className="mt-2 text-xs text-amber-700">{statusMessage}</p> : null}</div>
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button className={`flex min-h-11 items-center justify-center gap-1 rounded-lg text-xs font-semibold ${active ? 'bg-primary-container text-on-primary-container shadow-sm' : 'text-on-surface-variant'}`} onClick={onClick} type="button">{icon}{label}</button>
}

function Notice({ children, tone }: { children: React.ReactNode; tone: 'error' | 'success' }) {
  return <div className={`rounded-xl px-4 py-3 text-sm font-medium ${tone === 'error' ? 'bg-error-container text-on-error-container' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>{children}</div>
}

function makeDraftSegment(kind: TransportBookingKind, date: string, timeZone = getDeviceTimeZone()): DraftSegment {
  return { arrivalDate: date, arrivalPlace: '', arrivalTimeZone: timeZone, departureDate: date, departurePlace: '', departureTimeZone: timeZone, kind, status: 'scheduled' }
}

async function addSegmentsToItinerary(segments: TransportSegment[], trip: Trip) {
  const days = await listDaysByTrip(trip.id)
  for (const segment of segments) {
    const day = days.find((candidate) => candidate.date === segment.departureDate)
    if (!day) continue
    const existing = await listItemsByDay(day.id)
    await createItineraryItem({
      dayId: day.id,
      endDate: segment.arrivalDate,
      endTime: segment.arrivalTime,
      endTimeZone: segment.arrivalTimeZone,
      locationName: segment.departurePlace,
      notes: `${segment.departurePlace} → ${segment.arrivalPlace}${segment.serviceNumber ? ` · ${segment.serviceNumber}` : ''}`,
      sortOrder: Math.max(0, ...existing.map((item) => item.sortOrder)) + 1,
      startTime: segment.departureTime,
      startTimeZone: segment.departureTimeZone,
      ticketIds: [],
      title: `${bookingKindLabels[segment.kind]}：${segment.departurePlace} → ${segment.arrivalPlace}`,
      transportMode: segment.kind === 'cruise' || segment.kind === 'ferry' ? 'other' : segment.kind,
      tripId: trip.id,
    })
  }
}

function normalizeTab(value: string | null): CenterTab {
  return value === 'transport' || value === 'attachments' ? value : 'documents'
}

function travelerRoleLabel(role: TravelerRole) {
  return role === 'self' ? '本人' : role === 'child' ? '儿童' : role === 'companion' ? '同行人' : '其他'
}

function inferDocumentKind(ticket: TicketMeta): TravelDocumentKind {
  if (ticket.ticketCategory === 'flight_ticket' || ticket.ticketCategory === 'train_ticket') return 'discount_card'
  return ticket.ticketCategory === 'other' ? 'other' : 'insurance'
}

function toMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : '操作失败，请稍后重试。'
}

function scrollToDocumentCenterElement(id: string) {
  window.setTimeout(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 0)
}
