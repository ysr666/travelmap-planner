import { useEffect, useState, type ReactNode } from 'react'
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
  LockOpen,
  Plus,
  RefreshCw,
  ShieldCheck,
  TrainFront,
  Trash2,
  UserRoundPlus,
} from 'lucide-react'
import { createItineraryItem, listDaysByTrip, listItemsByDay } from '../../db'
import { createDisabledFlightStatusProvider } from '../../lib/flightStatusProvider'
import { extractSensitiveDocumentPreview, type SensitiveDocumentOcrPreview } from '../../lib/sensitiveDocumentOcr'
import { getDeviceTimeZone, resolveTripTimeZone } from '../../lib/timeZone'
import {
  addDocumentAttachment,
  createTransportBooking,
  createTravelDocument,
  createTravelerProfile,
  isSafeExternalAction,
  linkDocumentToTrip,
  openDocumentAttachment,
  updateTravelDocument,
  type DecryptedVaultObject,
} from '../../lib/travelDocumentCenter'
import { downloadBlob } from '../../lib/backup'
import { scheduleDocumentExpiryReminder, scheduleTransportReminder } from '../../lib/travelReminders'
import { extractTransportImportPreview, type TransportImportPreview } from '../../lib/transportImport'
import type {
  ExternalActionKind,
  TicketMeta,
  TransportBooking,
  TransportBookingKind,
  TransportSegment,
  TravelCenterSyncConflict,
  TravelDocumentData,
  TravelDocumentEntryCount,
  TravelDocumentFormat,
  TravelDocumentKind,
  TravelDocumentStatus,
  TravelerProfileData,
  TravelerRole,
  Trip,
} from '../../types'
import {
  RestoreTripIntelligenceSuggestionButton,
  TripIntelligenceSuggestionControls,
} from '../trip/TripIntelligenceSuggestionControls'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import {
  FIELD_INPUT_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_SELECT_CLASS,
  FIELD_TEXTAREA_CLASS,
  FormField,
} from '../ui/FormField'
import { TimeZoneSelect } from '../ui/TimeZoneSelect'
import type { TripIntelligenceSuggestion } from '../../lib/tripIntelligence'

type CenterTab = 'documents' | 'transport' | 'attachments'
type DraftSegment = Omit<
  TransportSegment,
  'id' | 'bookingId' | 'tripId' | 'sortOrder' | 'createdAt' | 'updatedAt'
>

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

export function CloudControls({ busy, conflicts, onEnablePush, onResolve, onSync }: {
  busy: boolean
  conflicts: TravelCenterSyncConflict[]
  onEnablePush: () => void
  onResolve: (id: string, choice: 'local' | 'remote') => Promise<void>
  onSync: () => void
}) {
  return <section className="space-y-3" data-testid="travel-document-sync-section" id="travel-document-sync-section"><div className="grid grid-cols-2 gap-2"><Button icon={<Cloud className="size-4" />} loading={busy} onClick={onSync} variant="secondary">同步资料</Button><Button icon={<Bell className="size-4" />} disabled={busy} onClick={onEnablePush} variant="secondary">启用通知</Button></div>{conflicts.length ? <div className="space-y-2 rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/25"><h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">资料同步冲突</h3><p className="text-xs text-amber-800 dark:text-amber-300">加密对象按整项选择，不会尝试合并密文字段。</p>{conflicts.map((conflict) => <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2" key={conflict.id}><span className="min-w-0 flex-1 truncate text-xs">{conflict.objectType} · {conflict.objectId}</span><button className="min-h-11 rounded-xl px-2 text-xs font-semibold text-primary tm-focus" onClick={() => void onResolve(conflict.id, 'local')} type="button">保留本机</button><button className="min-h-11 rounded-xl px-2 text-xs font-semibold text-primary tm-focus" onClick={() => void onResolve(conflict.id, 'remote')} type="button">使用云端</button></div>)}</div> : null}</section>
}

export function DocumentIntelligencePanel({
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
        </div>
        <span className="rounded-full bg-primary-container px-2 py-1 text-xs font-semibold text-on-primary-container">{suggestions.length} 项</span>
      </div>
      <details className="group rounded-lg border border-outline-variant/30 bg-surface-container-low">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-primary marker:hidden select-none [&::-webkit-details-marker]:hidden tm-focus">
          <span>查看建议</span>
          <span className="text-xs tm-muted group-open:hidden">展开</span>
          <span className="hidden text-xs tm-muted group-open:inline">收起</span>
        </summary>
        <div className="space-y-2 border-t border-outline-variant/20 p-2">
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
              <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold tm-muted">已隐藏资料建议（{hiddenSuggestions.length}）</summary>
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
      </details>
    </Card>
  )
}

export function VaultAccessPanel({ busy, confirmPassphrase, exists, onConfirmPassphraseChange, onCreate, onExport, onImport, onPassphraseChange, onUnlock, passphrase, unlocked }: {
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

export function DocumentsPanel({ documents, documentTripIds, legacyTickets, onChanged, onDelete, onMigrate, selectedTrip, travelers, vaultId }: {
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

export function TransportPanel({ bookings, onChanged, onDelete, segmentsByBooking, selectedBookingId, selectedTrip, travelers, vaultUnlocked }: { bookings: TransportBooking[]; onChanged: () => Promise<void>; onDelete: (id: string) => void; segmentsByBooking: Record<string, TransportSegment[]>; selectedBookingId?: string | null; selectedTrip?: Trip; travelers: Array<DecryptedVaultObject<TravelerProfileData>>; vaultUnlocked: boolean }) {
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
  const [providerCode, setProviderCode] = useState('')
  const [bookingFieldEvidence, setBookingFieldEvidence] = useState<TransportBooking['fieldEvidence']>()
  const [segments, setSegments] = useState<DraftSegment[]>([makeDraftSegment('flight', trip.startDate, zone)])
  const [segmentSeats, setSegmentSeats] = useState<string[]>([''])
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
  const [importApplied, setImportApplied] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const updateSegment = (index: number, patch: Partial<DraftSegment>) => setSegments((current) => current.map((segment, currentIndex) => currentIndex === index
    ? { ...segment, ...patch, fieldEvidence: markSegmentPatchAsManual(segment.fieldEvidence, patch) }
    : segment))
  async function save() {
    const externalActions = externalUrl ? [{ id: crypto.randomUUID(), kind: externalKind, label: externalLabel || '外部链接', url: externalUrl }] : []
    if (externalActions.some((action) => !isSafeExternalAction(action))) throw new Error('外部链接必须使用 HTTPS。')
    setBusy(true)
    try {
      const encryptedSeats = segmentSeats.flatMap((seat, segmentIndex) => seat.trim()
        ? [{ seat: seat.trim(), segmentIndex }]
        : [])
      const secret = pnr || orderNumber || travelerIds.length || encryptedSeats.length
        ? { orderNumber: orderNumber || undefined, pnr: pnr || undefined, segmentSeats: encryptedSeats, travelerIds }
        : undefined
      if (secret && !vaultUnlocked) throw new Error('PNR、订单号、座位和乘客属于敏感信息，请先解锁资料库。')
      const result = await createTransportBooking({ booking: { externalActions, fieldEvidence: bookingFieldEvidence, kind, providerCode: providerCode || undefined, providerName: providerName || undefined, sourceLabel: importApplied ? 'local_import' : 'manual', status: 'confirmed', title, tripId: trip.id }, secret, segments })
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
    setProviderCode(importPreview.providerCode ?? '')
    setBookingFieldEvidence({
      providerCode: importPreview.fieldEvidence.providerCode,
      providerName: importPreview.fieldEvidence.providerName,
    })
    setPnr(importPreview.privateFields?.pnr ?? '')
    setOrderNumber(importPreview.privateFields?.orderNumber ?? '')
    setSegmentSeats([importPreview.privateFields?.seat ?? ''])
    setSegments([{
      ...makeDraftSegment(nextKind, importPreview.departureDate ?? trip.startDate, zone),
      arrivalCode: importPreview.arrivalCode,
      arrivalDate: importPreview.arrivalDate ?? importPreview.departureDate ?? trip.startDate,
      arrivalPlace: importPreview.arrivalPlace ?? '',
      arrivalPlatform: importPreview.arrivalPlatform,
      arrivalTerminal: importPreview.arrivalTerminal,
      arrivalTime: importPreview.arrivalTime,
      carrierCode: importPreview.providerCode,
      departureCode: importPreview.departureCode,
      departurePlace: importPreview.departurePlace ?? '',
      fieldEvidence: transportPreviewEvidence(importPreview),
      platform: importPreview.departurePlatform,
      departureTime: importPreview.departureTime,
      serviceNumber: importPreview.serviceNumber,
      terminal: importPreview.departureTerminal,
    }])
    setImportApplied(true)
    setShowImport(false)
  }
  function changeKind(nextKind: TransportBookingKind) { setKind(nextKind); setSegments((current) => current.map((segment) => ({ ...segment, kind: nextKind }))) }
  return <Card variant="grouped" className="space-y-3"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">新交通订单</h3><p className="text-xs tm-muted">票面班次保持原值；外部动态不会覆盖订单。</p></div><Button icon={<FileText className="size-4" />} onClick={() => setShowImport((value) => !value)} variant="secondary">本机导入</Button></div>{showImport ? <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3"><label><span className={FIELD_LABEL_CLASS}>粘贴票据文本</span><textarea className={`${FIELD_TEXTAREA_CLASS} min-h-24`} onChange={(event) => setImportText(event.target.value)} value={importText} /></label><label><span className={FIELD_LABEL_CLASS}>或选择票据文件</span><input accept="image/*,.pdf,.txt,.eml,.html" className={FIELD_INPUT_CLASS} onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} type="file" /></label><Button className="w-full" loading={importBusy} onClick={() => void recognizeImport()} variant="secondary">生成本机预览</Button>{importPreview ? <div className="space-y-2 rounded-lg border border-outline-variant/30 bg-surface p-3"><p className="text-sm font-semibold">{importPreview.title}</p><p className="text-xs tm-muted">{bookingKindLabels[importPreview.kind]} · {importPreview.departureDate || '日期待补充'} · {importPreview.departurePlace || '出发地待补充'} → {importPreview.arrivalPlace || '到达地待补充'}</p>{importPreview.warnings.map((warning) => <p className="text-xs text-amber-700" key={warning}>{warning}</p>)}<Button className="w-full" onClick={applyImportPreview}>应用到表单</Button></div> : null}</div> : null}<FormField label="订单名称" onChange={setTitle} required value={title} /><div className="grid grid-cols-2 gap-2"><label><span className={FIELD_LABEL_CLASS}>交通类型</span><select className={FIELD_SELECT_CLASS} onChange={(event) => changeKind(event.target.value as TransportBookingKind)} value={kind}>{Object.entries(bookingKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><FormField label="承运方/平台" onChange={(value) => { setProviderName(value); setBookingFieldEvidence((current) => ({ ...current, providerName: manualFieldEvidence() })) }} value={providerName} /></div><FormField label="承运方代码" onChange={(value) => { setProviderCode(value.toUpperCase()); setBookingFieldEvidence((current) => ({ ...current, providerCode: manualFieldEvidence() })) }} value={providerCode} />{segments.map((segment, index) => <SegmentForm index={index} key={index} onChange={(patch) => updateSegment(index, patch)} onRemove={segments.length > 1 ? () => { setSegments((current) => current.filter((_, currentIndex) => currentIndex !== index)); setSegmentSeats((current) => current.filter((_, currentIndex) => currentIndex !== index)) } : undefined} segment={segment} />)}<Button className="w-full" icon={<Plus className="size-4" />} onClick={() => { setSegments((current) => [...current, makeDraftSegment(kind, current.at(-1)?.arrivalDate ?? trip.startDate, current.at(-1)?.arrivalTimeZone ?? zone)]); setSegmentSeats((current) => [...current, '']) }} variant="secondary">增加交通段</Button><div className="border-t border-outline-variant/20 pt-3"><p className="mb-2 text-sm font-semibold">敏感订单信息（加密）</p><div className="grid grid-cols-2 gap-2"><FormField label="PNR/预订编号" onChange={setPnr} value={pnr} /><FormField label="订单号" onChange={setOrderNumber} value={orderNumber} /></div>{segmentSeats.map((seat, index) => <FormField key={index} label={`第 ${index + 1} 段座位`} onChange={(value) => setSegmentSeats((current) => current.map((entry, currentIndex) => currentIndex === index ? value : entry))} value={seat} />)}{travelers.length ? <div className="mt-2 flex flex-wrap gap-2">{travelers.map((traveler) => <label className="tm-chip flex items-center gap-2 px-3 py-2 text-xs" key={traveler.id}><input checked={travelerIds.includes(traveler.id)} onChange={(event) => setTravelerIds((current) => event.target.checked ? [...current, traveler.id] : current.filter((id) => id !== traveler.id))} type="checkbox" />{traveler.data.displayName}</label>)}</div> : null}</div><div className="border-t border-outline-variant/20 pt-3"><p className="mb-2 text-sm font-semibold">外部跳转</p><div className="grid grid-cols-2 gap-2"><label><span className={FIELD_LABEL_CLASS}>操作</span><select className={FIELD_SELECT_CLASS} onChange={(event) => setExternalKind(event.target.value as ExternalActionKind)} value={externalKind}><option value="official">官网</option><option value="check_in">值机</option><option value="manage_booking">管理订单</option><option value="railway">铁路</option><option value="hanglv">航旅纵横</option><option value="other">其他</option></select></label><FormField label="显示名称" onChange={setExternalLabel} value={externalLabel} /></div><FormField label="HTTPS 链接" onChange={setExternalUrl} value={externalUrl} /></div><label className="flex items-start gap-2 rounded-xl border border-outline-variant/30 p-3 text-sm"><input checked={createItineraryItems} className="mt-1" onChange={(event) => setCreateItineraryItems(event.target.checked)} type="checkbox" /><span><strong className="block">确认后同步创建行程点</strong><span className="text-xs tm-muted">仅写入已有对应日期；每段交通仍保留两地当地时间与时区。</span></span></label><Button className="w-full" loading={busy} onClick={() => void save()}>保存订单并建立提醒</Button></Card>
}

function SegmentForm({ index, onChange, onRemove, segment }: { index: number; onChange: (patch: Partial<DraftSegment>) => void; onRemove?: () => void; segment: DraftSegment }) {
  const departureDetailLabel = segment.kind === 'flight' ? '出发航站楼' : '出发站台'
  const arrivalDetailLabel = segment.kind === 'flight' ? '到达航站楼' : '到达站台'
  return <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3"><div className="flex items-center justify-between"><span className="text-sm font-semibold">第 {index + 1} 段</span>{onRemove ? <button aria-label="删除交通段" className="flex size-11 items-center justify-center rounded-xl tm-focus" onClick={onRemove} type="button"><Trash2 className="size-4 text-error" /></button> : null}</div><div className="grid grid-cols-2 gap-2"><FormField label="承运方" onChange={(value) => onChange({ carrier: value })} value={segment.carrier ?? ''} /><FormField label="航班/车次" onChange={(value) => onChange({ serviceNumber: value.toUpperCase() })} value={segment.serviceNumber ?? ''} /></div><div className="grid grid-cols-2 gap-2"><FormField label="承运方代码" onChange={(value) => onChange({ carrierCode: value.toUpperCase() })} value={segment.carrierCode ?? ''} /><span /></div><div className="grid grid-cols-2 gap-2"><FormField label="出发地" onChange={(value) => onChange({ departurePlace: value })} required value={segment.departurePlace} /><FormField label="到达地" onChange={(value) => onChange({ arrivalPlace: value })} required value={segment.arrivalPlace} /></div><div className="grid grid-cols-2 gap-2"><FormField label="出发代码" onChange={(value) => onChange({ departureCode: value.toUpperCase() })} value={segment.departureCode ?? ''} /><FormField label="到达代码" onChange={(value) => onChange({ arrivalCode: value.toUpperCase() })} value={segment.arrivalCode ?? ''} /></div><div className="grid grid-cols-2 gap-2"><FormField label="出发日期" onChange={(value) => onChange({ departureDate: value })} type="date" value={segment.departureDate} /><FormField label="出发时间" onChange={(value) => onChange({ departureTime: value })} type="time" value={segment.departureTime ?? ''} /></div><TimeZoneSelect label="出发时区" onChange={(value) => onChange({ departureTimeZone: value })} value={segment.departureTimeZone} /><div className="grid grid-cols-2 gap-2"><FormField label="到达日期" onChange={(value) => onChange({ arrivalDate: value })} type="date" value={segment.arrivalDate} /><FormField label="到达时间" onChange={(value) => onChange({ arrivalTime: value })} type="time" value={segment.arrivalTime ?? ''} /></div><TimeZoneSelect label="到达时区" onChange={(value) => onChange({ arrivalTimeZone: value })} value={segment.arrivalTimeZone} /><div className="grid grid-cols-2 gap-2"><FormField label={departureDetailLabel} onChange={(value) => onChange(segment.kind === 'flight' ? { terminal: value } : { platform: value })} value={segment.kind === 'flight' ? segment.terminal ?? '' : segment.platform ?? ''} /><FormField label={arrivalDetailLabel} onChange={(value) => onChange(segment.kind === 'flight' ? { arrivalTerminal: value } : { arrivalPlatform: value })} value={segment.kind === 'flight' ? segment.arrivalTerminal ?? '' : segment.arrivalPlatform ?? ''} /></div></div>
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

export function CenterTabControls({ activeTab, onChange }: { activeTab: CenterTab; onChange: (tab: CenterTab) => void }) {
  return (
    <div aria-label="资料分类" className="document-center-tabs" role="tablist">
      <TabButton active={activeTab === 'attachments'} label="票据" onClick={() => onChange('attachments')} tab="attachments" />
      <TabButton active={activeTab === 'documents'} label="证件" onClick={() => onChange('documents')} tab="documents" />
      <TabButton active={activeTab === 'transport'} label="交通" onClick={() => onChange('transport')} tab="transport" />
    </div>
  )
}

function TabButton({ active, label, onClick, tab }: { active: boolean; label: string; onClick: () => void; tab: CenterTab }) {
  return (
    <button
      aria-controls={`document-center-panel-${tab}`}
      aria-selected={active}
      className={`document-center-tab tm-focus ${active ? 'document-center-tab-active' : ''}`}
      onClick={onClick}
      id={`document-center-tab-${tab}`}
      role="tab"
      type="button"
    >
      {label}
    </button>
  )
}

export function Notice({ children, tone }: { children: ReactNode; tone: 'error' | 'success' }) {
  return <div className={`rounded-xl px-4 py-3 text-sm font-medium ${tone === 'error' ? 'bg-error-container text-on-error-container' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>{children}</div>
}

function travelerRoleLabel(role: TravelerRole) {
  return role === 'self' ? '本人' : role === 'child' ? '儿童' : role === 'companion' ? '同行人' : '其他'
}

function manualFieldEvidence() {
  return { confidence: 'high' as const, sourceType: 'manual' as const }
}

function markSegmentPatchAsManual(
  current: TransportSegment['fieldEvidence'],
  patch: Partial<DraftSegment>,
): TransportSegment['fieldEvidence'] {
  const next = { ...current }
  const trackedFields = new Set<keyof NonNullable<TransportSegment['fieldEvidence']>>([
    'arrivalCode',
    'arrivalDate',
    'arrivalGate',
    'arrivalPlace',
    'arrivalPlatform',
    'arrivalTerminal',
    'arrivalTime',
    'arrivalTimeZone',
    'carrier',
    'carrierCode',
    'departureCode',
    'departureDate',
    'departurePlace',
    'departureTime',
    'departureTimeZone',
    'gate',
    'platform',
    'serviceNumber',
    'terminal',
  ])
  for (const key of Object.keys(patch) as Array<keyof DraftSegment>) {
    if (trackedFields.has(key as keyof NonNullable<TransportSegment['fieldEvidence']>)) {
      next[key as keyof NonNullable<TransportSegment['fieldEvidence']>] = manualFieldEvidence()
    }
  }
  return next
}

function transportPreviewEvidence(preview: TransportImportPreview): TransportSegment['fieldEvidence'] {
  return {
    arrivalCode: preview.fieldEvidence.arrivalCode,
    arrivalDate: preview.fieldEvidence.arrivalDate,
    arrivalPlace: preview.fieldEvidence.arrivalPlace,
    arrivalPlatform: preview.fieldEvidence.arrivalPlatform,
    arrivalTerminal: preview.fieldEvidence.arrivalTerminal,
    arrivalTime: preview.fieldEvidence.arrivalTime,
    carrierCode: preview.fieldEvidence.providerCode,
    departureCode: preview.fieldEvidence.departureCode,
    departureDate: preview.fieldEvidence.departureDate,
    departurePlace: preview.fieldEvidence.departurePlace,
    platform: preview.fieldEvidence.departurePlatform,
    serviceNumber: preview.fieldEvidence.serviceNumber,
    terminal: preview.fieldEvidence.departureTerminal,
  }
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
