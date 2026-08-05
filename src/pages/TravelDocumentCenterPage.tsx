import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Inbox, Lock } from 'lucide-react'
import { deleteTicket, listTicketsByTrip, listTrips } from '../db'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { FIELD_LABEL_CLASS, FIELD_SELECT_CLASS } from '../components/ui/FormField'
import { TicketLibraryPage } from './TicketLibraryPage'
import {
  CenterTabControls,
  CloudControls,
  DocumentIntelligencePanel,
  DocumentsPanel,
  Notice,
  TransportPanel,
  VaultAccessPanel,
} from '../components/documents/TravelDocumentCenterSections'
import { getRouteParams, navigateTo } from '../lib/routes'
import { todayInTimeZone } from '../lib/timeSemantics'
import { getDeviceTimeZone } from '../lib/timeZone'
import {
  deleteTransportBooking,
  deleteTravelDocument,
  encryptExistingTicketAsDocument,
  getTravelVaultStatus,
  initializeTravelVault,
  linkDocumentToTrip,
  listDocumentTripLinks,
  listTransportBookings,
  listTransportSegments,
  listTravelDocuments,
  listTravelerProfiles,
  lockTravelVault,
  unlockTravelVault,
  type DecryptedVaultObject,
} from '../lib/travelDocumentCenter'
import { exportEncryptedVaultBackup, importEncryptedVaultBackup } from '../lib/vaultBackup'
import { downloadBlob } from '../lib/backup'
import { listUpcomingReminders } from '../lib/travelReminders'
import type {
  TicketMeta,
  ReminderSchedule,
  TransportBooking,
  TransportSegment,
  TravelCenterSyncConflict,
  TravelDocumentData,
  TravelDocumentKind,
  TravelerProfileData,
  Trip,
} from '../types'
import { listTravelCenterSyncConflicts, resolveTravelCenterSyncConflict, syncTravelCenter } from '../lib/cloudTravelCenter'
import { enableTravelWebPush, showDueLocalReminders } from '../lib/webPush'
import { buildTripIntelligenceModel, type TripIntelligenceSuggestion } from '../lib/tripIntelligence'
import { useTripIntelligencePersistence } from '../hooks/useTripIntelligencePersistence'

type CenterTab = 'documents' | 'transport' | 'attachments'

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
    <div className="space-y-4 pb-4">
      <section className="space-y-2">
        {activeTab !== 'attachments' ? (
          <CenterTabControls activeTab={activeTab} onChange={changeTab} />
        ) : null}
      </section>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      <div
        aria-labelledby={`document-center-tab-${activeTab}`}
        className="space-y-4"
        id={`document-center-panel-${activeTab}`}
        role="tabpanel"
      >
        {activeTab !== 'attachments' ? (
          <div className="space-y-3">
            {vaultUnlocked ? (
              <div className="flex justify-end">
                <button aria-label="锁定资料库" className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant tm-focus" onClick={() => void handleLock()} type="button">
                  <Lock className="size-5" />
                </button>
              </div>
            ) : null}
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
          </div>
        ) : null}

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
          selectedTripId ? (
            <TicketLibraryPage
              contextControls={<CenterTabControls activeTab={activeTab} onChange={changeTab} />}
              embedded
              headerAction={(
                <button
                  aria-label="来源与导入"
                  className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant tm-focus"
                  onClick={() => navigateTo('inbox', selectedTripId ? { tripId: selectedTripId } : undefined)}
                  title="来源与导入"
                  type="button"
                >
                  <Inbox className="size-5" />
                </button>
              )}
              tripIdOverride={selectedTripId}
            />
          ) : (
            <EmptyState body="先创建旅行，再添加票据。" icon={<FileText className="size-6" />} title="还没有旅行" />
          )
        ) : null}
      </div>

      <details className="group rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2" open={syncConflicts.length > 0}>
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-on-surface marker:hidden [&::-webkit-details-marker]:hidden">
          <span>资料工具</span>
          {syncConflicts.length > 0 ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">{syncConflicts.length}</span> : null}
        </summary>
        <div className="mt-3 space-y-4 border-t border-outline-variant/20 pt-3">
          {trips.length > 1 ? (
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>当前旅行</span>
              <select className={FIELD_SELECT_CLASS} onChange={(event) => setSelectedTripId(event.target.value)} value={selectedTripId}>
                {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}
              </select>
            </label>
          ) : null}
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
          <CloudControls
            busy={busy}
            conflicts={syncConflicts}
            onEnablePush={() => void handleEnablePush()}
            onResolve={handleResolveConflict}
            onSync={() => void handleCloudSync()}
          />
        </div>
      </details>

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

function normalizeTab(value: string | null): CenterTab {
  return value === 'documents' || value === 'transport' ? value : 'attachments'
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
