import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, FileUp, Inbox, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import {
  applyExistingTripImportPreview,
  buildExistingTripImportPreview,
  type ExistingTripImportDiff,
  type ExistingTripImportItemFields,
  type ExistingTripImportItemPatch,
  type ExistingTripImportAppliedChange,
  type ExistingTripImportPreview,
} from '../../lib/ai/existingTripImport'
import {
  buildExistingTripImportRequestSources,
  DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
  extractExistingTripImportSources,
  OPTIONAL_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
  type ExistingTripImportExtractionProgress,
  type ExistingTripImportOcrLanguage,
} from '../../lib/ai/existingTripImportExtraction'
import {
  addTravelInboxErrorEntry,
  addTravelInboxExtraction,
  buildTravelInboxApplyFiles,
  buildTravelInboxSourceSummaries,
  buildTravelInboxProviderTicketSummaries,
  buildTravelInboxTicketSummaries,
  deleteTravelInboxEntries,
  deleteTravelInboxPreview,
  describeTravelInboxSourceKind,
  getActiveTravelInboxPreview,
  inferTravelInboxSourceKind,
  isTravelInboxAutoRecognizeEnabled,
  listTravelInboxEntriesByTrip,
  markTravelInboxEntriesError,
  markTravelInboxEntriesRecognizing,
  replaceTravelInboxEntryWithExtraction,
  saveTravelInboxPreview,
  setTravelInboxAutoRecognizeEnabled,
  summarizeTravelInboxPreview,
  updateTravelInboxPreviewRecord,
} from '../../lib/ai/travelInbox'
import {
  PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
  type ProviderProxyExistingTripImportRequest,
} from '../../lib/ai/providerProxyContract'
import {
  fetchProviderProxyExistingTripImport,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../../lib/providerProxyClient'
import { db } from '../../db/database'
import { navigateTo } from '../../lib/routes'
import { SYNC_QUEUE_SUCCESS_COPY } from '../../lib/tripSyncQueue'
import { ticketCategoryOptions, ticketCategoryLabels } from '../../lib/tickets'
import type { Day, ItineraryItem, TicketCategory, TicketMeta, TravelInboxEntry, TravelInboxPreviewRecord, Trip } from '../../types'

type TravelInboxPanelProps = {
  allItems: ItineraryItem[]
  days: Day[]
  onApplied: () => Promise<void>
  tickets: TicketMeta[]
  trip: Trip
}

const languageLabels: Record<ExistingTripImportOcrLanguage, string> = {
  ara: '阿拉伯文',
  chi_sim: '简中',
  chi_tra: '繁中',
  eng: '英文',
  fra: '法文',
  jpn: '日文',
  kor: '韩文',
  por: '葡萄牙文',
  rus: '俄文',
  spa: '西班牙文',
  tha: '泰文',
}

const TRAVEL_INBOX_APPLIED_CHANGES_KEY_PREFIX = 'tripmap:travel-inbox:applied-changes:'

export function TravelInboxPanel({
  allItems,
  days,
  onApplied,
  tickets,
  trip,
}: TravelInboxPanelProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [entries, setEntries] = useState<TravelInboxEntry[]>([])
  const [previewRecord, setPreviewRecord] = useState<TravelInboxPreviewRecord | null>(null)
  const [checkedDiffIds, setCheckedDiffIds] = useState<string[]>([])
  const [pastedText, setPastedText] = useState('')
  const [languages, setLanguages] = useState<ExistingTripImportOcrLanguage[]>(DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES)
  const [autoRecognize, setAutoRecognize] = useState(() => isTravelInboxAutoRecognizeEnabled())
  const [progress, setProgress] = useState<ExistingTripImportExtractionProgress | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [confirmRecognizeOpen, setConfirmRecognizeOpen] = useState(false)
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [appliedChanges, setAppliedChanges] = useState<ExistingTripImportAppliedChange[]>(() => readTravelInboxAppliedChanges(trip.id))
  const [warnings, setWarnings] = useState<string[]>([])

  const preview = previewRecord?.preview as ExistingTripImportPreview | undefined
  const selectedCount = preview?.diffs.filter((diff) => checkedDiffIds.includes(diff.id)).length ?? 0
  const readyEntries = entries.filter((entry) => entry.status === 'ready' || entry.status === 'previewed')
  const failedEntries = entries.filter((entry) => entry.status === 'error')
  const summary = preview ? summarizeTravelInboxPreview(preview) : null
  const readyDiffs = useMemo(() => preview?.diffs.filter((diff) => !needsReview(diff, preview)) ?? [], [preview])
  const reviewDiffs = useMemo(() => preview?.diffs.filter((diff) => needsReview(diff, preview)) ?? [], [preview])

  const loadInbox = useCallback(async () => {
    try {
      const [nextEntries, activePreview] = await Promise.all([
        listTravelInboxEntriesByTrip(trip.id),
        getActiveTravelInboxPreview(trip.id),
      ])
      setEntries(nextEntries)
      setPreviewRecord(activePreview ?? null)
      setCheckedDiffIds(activePreview?.checkedDiffIds ?? [])
    } catch {
      setEntries([])
      setPreviewRecord(null)
      setCheckedDiffIds([])
    }
  }, [trip.id])

  useEffect(() => {
    queueMicrotask(() => void loadInbox())
  }, [loadInbox])

  async function processPastedText() {
    if (!pastedText.trim()) return
    await processExtraction({ pastedText })
    setPastedText('')
  }

  async function processFiles(files: File[]) {
    for (const file of files.slice(0, 8)) {
      await processExtraction({ files: [file], sourceFile: file })
    }
    if (files.length > 8) {
      setWarnings((current) => [...current, `最多处理 8 个文件，已跳过 ${files.length - 8} 个文件。`])
    }
  }

  async function processExtraction({
    files,
    pastedText: text,
    sourceFile,
  }: {
    files?: File[]
    pastedText?: string
    sourceFile?: File
  }) {
    setIsExtracting(true)
    setProgress(null)
    setError(null)
    setSuccessMessage(null)
    setAppliedChanges([])
    persistTravelInboxAppliedChanges(trip.id, [])
    try {
      const extraction = await extractExistingTripImportSources({
        files,
        languages,
        onProgress: setProgress,
        pastedText: text,
      })
      let addedEntries: TravelInboxEntry[] = []
      if (extraction.sources.length > 0) {
        const result = await addTravelInboxExtraction({ extraction, tripId: trip.id })
        addedEntries = result.entries
      } else if (sourceFile) {
        const message = extraction.warnings[0] ?? '未提取到可识别文本。'
        const entry = await addTravelInboxErrorEntry({
          blob: sourceFile,
          error: message,
          fileName: sourceFile.name,
          mimeType: sourceFile.type || inferMimeType(sourceFile.name),
          size: sourceFile.size,
          tripId: trip.id,
        })
        addedEntries = [entry]
      } else if (text?.trim()) {
        setError('粘贴文本未提取到可识别内容。')
      }
      setWarnings((current) => [...current, ...extraction.warnings].slice(-8))
      await loadInbox()
      if (autoRecognize && providerConfig.configured && addedEntries.some((entry) => entry.extractedText.trim())) {
        await recognizeEntries(addedEntries)
      }
    } catch (caught) {
      if (sourceFile) {
        await addTravelInboxErrorEntry({
          blob: sourceFile,
          error: caught instanceof Error ? caught.message : '本地提取失败。',
          fileName: sourceFile.name,
          mimeType: sourceFile.type || inferMimeType(sourceFile.name),
          size: sourceFile.size,
          tripId: trip.id,
        })
        await loadInbox()
      } else {
        setError(caught instanceof Error ? caught.message : '本地提取失败。')
      }
    } finally {
      setIsExtracting(false)
      setProgress(null)
    }
  }

  async function retryEntry(entry: TravelInboxEntry) {
    const blobRecord = await db.travelInboxBlobs.get(entry.id)
    if (!blobRecord?.blob || !entry.fileName) {
      setError('该收件项没有可重试的源文件。')
      return
    }
    setIsExtracting(true)
    setError(null)
    try {
      const file = new File([blobRecord.blob], entry.fileName, { type: entry.mimeType || blobRecord.blob.type })
      const extraction = await extractExistingTripImportSources({
        files: [file],
        languages,
        onProgress: setProgress,
      })
      const next = await replaceTravelInboxEntryWithExtraction({ entryId: entry.id, extraction })
      if (!next) {
        throw new Error(extraction.warnings[0] ?? '重试后仍未提取到可识别文本。')
      }
      await loadInbox()
      if (autoRecognize && providerConfig.configured) {
        await recognizeEntries([next])
      }
    } catch (caught) {
      await markTravelInboxEntriesError([entry.id], caught instanceof Error ? caught.message : '重试失败。')
      await loadInbox()
    } finally {
      setIsExtracting(false)
      setProgress(null)
    }
  }

  async function recognizeEntries(targetEntries: TravelInboxEntry[]) {
    const sourceEntries = targetEntries.filter((entry) => entry.extractedText.trim())
    if (!sourceEntries.length) {
      setError('没有可发送给 AI 识别的文本。')
      return
    }
    if (!providerConfig.proxyUrl) {
      setError('当前未配置 provider proxy。')
      return
    }
    setIsRecognizing(true)
    setError(null)
    setSuccessMessage(null)
    await markTravelInboxEntriesRecognizing(sourceEntries.map((entry) => entry.id), true)
    try {
      const sourceSummaries = buildTravelInboxSourceSummaries(sourceEntries)
      const ticketSummaries = buildTravelInboxTicketSummaries(tickets)
      const response = await fetchProviderProxyExistingTripImport(
        buildProviderRequest({ allItems, days, sourceSummaries, ticketSummaries, trip }),
        providerConfig.proxyUrl,
      )
      const nextPreview = buildExistingTripImportPreview({
        context: { days, items: allItems, ticketSummaries, trip },
        providerResult: response.result,
        sourceSummaries,
      })
      const checked = nextPreview.diffs.filter((diff) => diff.checked).map((diff) => diff.id)
      const record = await saveTravelInboxPreview({
        checkedDiffIds: checked,
        entryIds: sourceEntries.map((entry) => entry.id),
        preview: nextPreview,
        tripId: trip.id,
      })
      setPreviewRecord(record)
      setCheckedDiffIds(checked)
      setWarnings((current) => [
        ...current,
        ...(response.warnings ?? []),
        ...nextPreview.warnings,
      ].slice(-10))
      await loadInbox()
    } catch (caught) {
      const message = caught instanceof ProviderProxyClientError
        ? caught.message
        : caught instanceof Error ? caught.message : 'AI 识别导入失败。'
      await markTravelInboxEntriesError(sourceEntries.map((entry) => entry.id), message)
      setError(message)
      await loadInbox()
    } finally {
      setIsRecognizing(false)
    }
  }

  async function handleConfirmRecognize() {
    setConfirmRecognizeOpen(false)
    await recognizeEntries(readyEntries)
  }

  async function handleApply() {
    if (!preview || !previewRecord) return
    setIsApplying(true)
    setError(null)
    try {
      const filesBySourceId = await buildTravelInboxApplyFiles(previewRecord.entryIds)
      const result = await applyExistingTripImportPreview({
        checkedDiffIds: new Set(checkedDiffIds),
        expectedBaselineFingerprint: preview.baselineFingerprint,
        filesBySourceId,
        preview,
        tripId: trip.id,
      })
      if (!result.ok) {
        setError(result.errors.join('\n'))
        return
      }
      setConfirmApplyOpen(false)
      if (result.appliedCount > 0) {
        await deleteTravelInboxEntries(previewRecord.entryIds)
        persistTravelInboxAppliedChanges(trip.id, result.appliedChanges)
        setAppliedChanges(result.appliedChanges)
        setSuccessMessage(`已应用 ${result.appliedCount} 项收件箱建议。${SYNC_QUEUE_SUCCESS_COPY}`)
      } else {
        persistTravelInboxAppliedChanges(trip.id, [])
        setAppliedChanges([])
        setSuccessMessage('没有应用任何建议。')
      }
      setPreviewRecord(null)
      setCheckedDiffIds([])
      await onApplied()
      await loadInbox()
    } finally {
      setIsApplying(false)
    }
  }

  function toggleLanguage(language: ExistingTripImportOcrLanguage) {
    setLanguages((current) => current.includes(language)
      ? current.filter((item) => item !== language)
      : [...current, language])
  }

  function toggleAutoRecognize(checked: boolean) {
    setAutoRecognize(checked)
    setTravelInboxAutoRecognizeEnabled(checked)
  }

  function toggleDiff(diffId: string, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...checkedDiffIds, diffId]))
      : checkedDiffIds.filter((id) => id !== diffId)
    void commitChecked(next)
  }

  async function commitChecked(nextCheckedDiffIds: string[]) {
    setCheckedDiffIds(nextCheckedDiffIds)
    if (previewRecord) {
      await updateTravelInboxPreviewRecord({ ...previewRecord, checkedDiffIds: nextCheckedDiffIds })
    }
  }

  async function commitPreview(nextPreview: ExistingTripImportPreview) {
    if (!previewRecord) return
    const nextRecord = { ...previewRecord, preview: nextPreview }
    setPreviewRecord(nextRecord)
    await updateTravelInboxPreviewRecord(nextRecord)
  }

  function updateCreateItemDate(diffId: string, value: string) {
    if (!preview) return
    const nextPreview = {
      ...preview,
      diffs: preview.diffs.map((diff) => {
        if (diff.id !== diffId || diff.type !== 'create_item') return diff
        if (value.startsWith('day:')) {
          const day = days.find((candidate) => candidate.id === value.slice('day:'.length))
          return day ? { ...diff, data: { ...diff.data, date: day.date, targetDayId: day.id, tempDayKey: undefined } } : diff
        }
        if (value.startsWith('temp:')) {
          const createDay = preview.diffs.find((candidate) => candidate.type === 'create_day' && candidate.data.tempDayKey === value.slice('temp:'.length))
          return createDay?.type === 'create_day'
            ? { ...diff, data: { ...diff.data, date: createDay.data.date, targetDayId: undefined, tempDayKey: createDay.data.tempDayKey } }
            : diff
        }
        return diff
      }),
    }
    void commitPreview(nextPreview)
  }

  function convertCreateItemToMerge(diffId: string, targetItemId: string) {
    if (!preview) return
    const targetItem = allItems.find((item) => item.id === targetItemId)
    if (!targetItem) return
    const nextPreview = {
      ...preview,
      diffs: preview.diffs.map((diff) => {
        if (diff.id !== diffId || diff.type !== 'create_item') return diff
        const patch = buildMergePatchForPreview(targetItem, diff.data.fields)
        return {
          ...diff,
          data: { patch, targetItemId },
          id: diff.id,
          reason: `${diff.reason} 用户已改为合并到现有行程点。`,
          summary: `合并到「${targetItem.title}」`,
          type: 'merge_item_fields' as const,
        }
      }),
    }
    void commitPreview(nextPreview)
  }

  function updateBindTicketTarget(diffId: string, value: string) {
    if (!preview) return
    const nextPreview = {
      ...preview,
      diffs: preview.diffs.map((diff) => {
        if (diff.id !== diffId) return diff
        if (diff.type === 'bind_ticket') {
          if (value.startsWith('item:')) {
            return { ...diff, data: { ...diff.data, targetItemId: value.slice('item:'.length), targetTempItemKey: undefined } }
          }
          if (value.startsWith('temp:')) {
            return { ...diff, data: { ...diff.data, targetItemId: undefined, targetTempItemKey: value.slice('temp:'.length) } }
          }
          return { ...diff, data: { ...diff.data, targetItemId: undefined, targetTempItemKey: undefined } }
        }
        if (diff.type === 'bind_existing_ticket') {
          if (value.startsWith('item:')) {
            return { ...diff, data: { ...diff.data, targetItemId: value.slice('item:'.length), targetTempItemKey: undefined } }
          }
          if (value.startsWith('temp:')) {
            return { ...diff, data: { ...diff.data, targetItemId: undefined, targetTempItemKey: value.slice('temp:'.length) } }
          }
          return { ...diff, data: { ...diff.data, targetItemId: undefined, targetTempItemKey: undefined } }
        }
        return diff
      }),
    }
    void commitPreview(nextPreview)
  }

  function updateCreateTicketFields(diffId: string, patch: { ticketCategory?: TicketCategory; title?: string }) {
    if (!preview) return
    const nextPreview = {
      ...preview,
      diffs: preview.diffs.map((diff) => {
        if (diff.id !== diffId || diff.type !== 'create_ticket') return diff
        return {
          ...diff,
          data: {
            ...diff.data,
            ticketCategory: patch.ticketCategory ?? diff.data.ticketCategory,
            title: patch.title ?? diff.data.title,
          },
          summary: patch.title ? `新增票据「${patch.title}」` : diff.summary,
        }
      }),
    }
    void commitPreview(nextPreview)
  }

  function updateMergeTicketFields(diffId: string, patch: { ticketCategory?: TicketCategory; title?: string }) {
    if (!preview) return
    const nextPreview = {
      ...preview,
      diffs: preview.diffs.map((diff) => {
        if (diff.id !== diffId || diff.type !== 'merge_ticket_meta') return diff
        return {
          ...diff,
          data: {
            ...diff.data,
            patch: {
              ...diff.data.patch,
              ticketCategory: patch.ticketCategory ?? diff.data.patch.ticketCategory,
              title: patch.title ?? diff.data.patch.title,
            },
          },
        }
      }),
    }
    void commitPreview(nextPreview)
  }

  return (
    <Card className="space-y-4" data-testid="travel-inbox-panel" variant="grouped">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Inbox className="size-4" />
            </div>
            <h3 className="text-base font-semibold text-on-surface">旅行收件箱 · 智能整理中心</h3>
          </div>
          <p className="mt-1 text-sm leading-6 tm-muted">
            粘贴邮件、PDF、截图或票据，本地提取/OCR 后自动整理成行程点、票据、备注和绑定建议。
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-container-high px-3 py-1 text-xs font-medium tm-muted">
          {providerConfig.configured ? 'provider proxy 已配置' : 'provider proxy 未配置'}
        </span>
      </div>

      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-high p-3">
        <label className="flex items-start gap-3 text-sm text-on-surface">
          <input
            checked={autoRecognize}
            className="mt-1 size-4"
            onChange={(event) => toggleAutoRecognize(event.target.checked)}
            type="checkbox"
          />
          <span className="min-w-0">
            <span className="block font-semibold">提取后自动 AI 识别</span>
            <span className="mt-0.5 block text-xs leading-5 tm-muted">默认关闭。开启后只会发送提取文本，不上传原始文件。</span>
          </span>
        </label>
      </div>

      <textarea
        className="min-h-24 w-full resize-y rounded-xl border border-outline-variant/40 bg-surface-container-high px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
        onChange={(event) => setPastedText(event.target.value)}
        placeholder="粘贴订单邮件、酒店确认、门票短信或行程备注..."
        value={pastedText}
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
        <div className="min-w-0 rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-high p-3">
          <input
            ref={fileInputRef}
            accept=".txt,.eml,.html,.htm,.pdf,image/*,.json,.zip"
            className="sr-only"
            multiple
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? [])
              event.currentTarget.value = ''
              void processFiles(selected)
            }}
            type="file"
          />
          <button
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-primary tm-focus"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <FileUp className="size-4" />
            添加文件
          </button>
          <p className="mt-1 text-center text-xs tm-muted">支持 .txt/.eml/.html/.pdf/image/*/.json/.zip，单文件 20MB。</p>
        </div>
        <Button
          disabled={!pastedText.trim() || isExtracting}
          icon={isExtracting ? <Loader2 className="size-4 animate-spin" /> : <Inbox className="size-4" />}
          loading={isExtracting}
          onClick={() => void processPastedText()}
          variant="secondary"
        >
          加入收件箱
        </Button>
        <Button
          disabled={!readyEntries.length || isRecognizing || !providerConfig.configured}
          icon={isRecognizing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          loading={isRecognizing}
          onClick={() => autoRecognize ? void recognizeEntries(readyEntries) : setConfirmRecognizeOpen(true)}
        >
          {isRecognizing ? '自动整理中' : autoRecognize ? '重新整理' : '整理材料'}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold tm-muted">OCR 语言</p>
        <div className="flex flex-wrap gap-2">
          {[...DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES, ...OPTIONAL_EXISTING_TRIP_IMPORT_OCR_LANGUAGES].map((language) => (
            <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-high px-3 text-xs font-medium text-on-surface" key={language}>
              <input
                checked={languages.includes(language)}
                className="size-4"
                onChange={() => toggleLanguage(language)}
                type="checkbox"
              />
              {languageLabels[language]}
            </label>
          ))}
        </div>
      </div>

      {progress ? (
        <p className="rounded-lg bg-surface-container-high px-3 py-2 text-sm tm-muted">
          {progress.fileName ? `${progress.fileName}：` : ''}{progress.message}
        </p>
      ) : null}

      {entries.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-on-surface">待处理收件</p>
            <span className="text-xs tm-muted">{entries.length} 项 · {failedEntries.length} 项需处理</span>
          </div>
          <div className="space-y-2">
            {entries.map((entry) => (
              <div className="rounded-xl border border-outline-variant/30 bg-surface-container-high p-3" key={entry.id}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">
                      {entry.label || entry.fileName || describeTravelInboxSourceKind(entry.sourceKind)}
                    </p>
                    <p className="mt-1 text-xs leading-5 tm-muted">
                      {describeTravelInboxSourceKind(entry.sourceKind)} · {describeEntryStatus(entry)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {entry.status === 'error' ? (
                      <button className="inline-flex items-center gap-1 text-xs font-semibold text-primary" onClick={() => void retryEntry(entry)} type="button">
                        <RefreshCw className="size-3" />
                        重试 OCR
                      </button>
                    ) : null}
                    <button className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-300" onClick={() => void deleteTravelInboxEntries([entry.id]).then(loadInbox)} type="button">
                      <Trash2 className="size-3" />
                      删除
                    </button>
                  </div>
                </div>
                {entry.error ? <p className="mt-2 rounded-lg bg-error-container p-2 text-xs text-on-error-container">{entry.error}</p> : null}
                {entry.warnings.length > 0 ? (
                  <div className="mt-2 rounded-lg bg-amber-50/80 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                    {entry.warnings.slice(0, 3).map((warning) => <p className="break-words [overflow-wrap:anywhere]" key={warning}>{warning}</p>)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="rounded-xl bg-surface-container-high px-3 py-3 text-sm tm-muted">还没有待处理收件。添加材料后会先在此设备本地提取，确认应用前不会写入旅行。</p>
      )}

      {warnings.length > 0 ? (
        <div className="rounded-xl bg-amber-50/80 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {warnings.slice(-6).map((warning) => (
            <p className="break-words [overflow-wrap:anywhere]" key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      {error ? <p className="rounded-xl bg-error-container p-3 text-sm text-on-error-container whitespace-pre-line">{error}</p> : null}
      {successMessage ? (
        <p className="flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-sm text-primary">
          <CheckCircle2 className="size-4" />
          {successMessage}
        </p>
      ) : null}

      {preview ? (
        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-on-surface">整理建议</p>
              <p className="text-xs tm-muted">最终确认前不会写入旅行。已选择 {selectedCount} 项。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={selectedCount === 0 || isApplying}
                icon={isApplying ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                loading={isApplying}
                onClick={() => setConfirmApplyOpen(true)}
                variant="secondary"
              >
                应用选中建议
              </Button>
              <Button
                disabled={isApplying}
                icon={<Trash2 className="size-4" />}
                onClick={() => previewRecord && void deleteTravelInboxPreview(previewRecord.id).then(loadInbox)}
                variant="ghost"
              >
                取消预览
              </Button>
            </div>
          </div>

          {summary ? (
            <div className="grid gap-2 sm:grid-cols-5">
              <SummaryPill label="新增行程点" value={summary.createItems} />
              <SummaryPill label="合并行程点" value={summary.mergeItems} />
              <SummaryPill label="保存票据" value={summary.createTickets} />
              <SummaryPill label="绑定票据" value={summary.bindTickets} />
              <SummaryPill label="追加备注" value={summary.notes} />
            </div>
          ) : null}

          <SuggestionSection
            allItems={allItems}
            checkedDiffIds={checkedDiffIds}
            days={days}
            diffs={readyDiffs}
            onBindTicketTargetChange={updateBindTicketTarget}
            onCreateItemDateChange={updateCreateItemDate}
            onCreateItemMergeTargetChange={convertCreateItemToMerge}
            onCreateTicketFieldChange={updateCreateTicketFields}
            onMergeTicketFieldChange={updateMergeTicketFields}
            onToggleDiff={toggleDiff}
            preview={preview}
            title="可一键应用"
          />
          <SuggestionSection
            allItems={allItems}
            checkedDiffIds={checkedDiffIds}
            days={days}
            diffs={reviewDiffs}
            onBindTicketTargetChange={updateBindTicketTarget}
            onCreateItemDateChange={updateCreateItemDate}
            onCreateItemMergeTargetChange={convertCreateItemToMerge}
            onCreateTicketFieldChange={updateCreateTicketFields}
            onMergeTicketFieldChange={updateMergeTicketFields}
            onToggleDiff={toggleDiff}
            preview={preview}
            title="需确认"
          />
        </section>
      ) : null}

      {appliedChanges.length > 0 ? (
        <section className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3" data-testid="travel-inbox-applied-changes">
          <p className="text-sm font-semibold text-on-surface">写入了什么</p>
          <div className="space-y-2">
            {appliedChanges.map((change, index) => (
              <div className="flex flex-col gap-2 rounded-lg bg-surface-container-high px-3 py-2 sm:flex-row sm:items-center sm:justify-between" key={`${change.kind}:${change.id}:${index}`}>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{formatAppliedChange(change)}</p>
                  <p className="text-xs tm-muted">{change.title}</p>
                </div>
                {canOpenAppliedChange(change) ? (
                  <button className="inline-flex items-center gap-1 text-xs font-semibold text-primary" onClick={() => openAppliedChange(trip.id, change)} type="button">
                    查看
                    <ArrowRight className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        body={`本地提取/OCR 不上传文件。确认后会发送 ${readyEntries.length} 段提取文本给 provider proxy 的 ${PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION}，最多 1 次 AI 请求；确认应用前不会写入旅行。`}
        confirmLabel="确认识别"
        loading={isRecognizing}
        onCancel={() => setConfirmRecognizeOpen(false)}
        onConfirm={() => void handleConfirmRecognize()}
        open={confirmRecognizeOpen}
        testId="travel-inbox-recognize-confirm"
        title="发送收件箱文本给 AI 识别？"
      />
      <ConfirmDialog
        body={`将应用 ${selectedCount} 项已勾选建议，创建/更新当前旅行的日期、行程点、票据和备注。写入后会进入自动同步队列；收件箱原文和源文件缓存会从待处理区清理。`}
        confirmLabel="确认应用"
        loading={isApplying}
        onCancel={() => setConfirmApplyOpen(false)}
        onConfirm={() => void handleApply()}
        open={confirmApplyOpen}
        testId="travel-inbox-apply-confirm"
        title="应用收件箱预览？"
      />
    </Card>
  )
}

function buildProviderRequest({
  allItems,
  days,
  sourceSummaries,
  ticketSummaries,
  trip,
}: {
  allItems: ItineraryItem[]
  days: Day[]
  sourceSummaries: ReturnType<typeof buildTravelInboxSourceSummaries>
  ticketSummaries: ReturnType<typeof buildTravelInboxTicketSummaries>
  trip: Trip
}): ProviderProxyExistingTripImportRequest {
  const dayById = new Map(days.map((day) => [day.id, day]))
  return {
    days: days.map((day) => ({
      date: day.date,
      id: day.id,
      sortOrder: day.sortOrder,
      title: day.title,
    })),
    existingTicketSummaries: buildTravelInboxProviderTicketSummaries(ticketSummaries),
    items: allItems.map((item) => ({
      address: item.address,
      date: dayById.get(item.dayId)?.date ?? trip.startDate,
      dayId: item.dayId,
      endTime: item.endTime,
      id: item.id,
      locationName: item.locationName,
      previousTransportDurationMinutes: item.previousTransportDurationMinutes,
      previousTransportMode: item.previousTransportMode,
      previousTransportNote: item.previousTransportNote,
      startTime: item.startTime,
      ticketCount: item.ticketIds.length,
      title: item.title,
      transportMode: item.transportMode,
    })),
    locale: 'zh-CN',
    operation: PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
    sources: buildExistingTripImportRequestSources(sourceSummaries),
    trip: {
      destination: trip.destination,
      endDate: trip.endDate,
      id: trip.id,
      startDate: trip.startDate,
      title: trip.title,
    },
  }
}

function SuggestionSection({
  allItems,
  checkedDiffIds,
  days,
  diffs,
  onBindTicketTargetChange,
  onCreateItemDateChange,
  onCreateItemMergeTargetChange,
  onCreateTicketFieldChange,
  onMergeTicketFieldChange,
  onToggleDiff,
  preview,
  title,
}: {
  allItems: ItineraryItem[]
  checkedDiffIds: string[]
  days: Day[]
  diffs: ExistingTripImportDiff[]
  onBindTicketTargetChange: (diffId: string, value: string) => void
  onCreateItemDateChange: (diffId: string, value: string) => void
  onCreateItemMergeTargetChange: (diffId: string, targetItemId: string) => void
  onCreateTicketFieldChange: (diffId: string, patch: { ticketCategory?: TicketCategory; title?: string }) => void
  onMergeTicketFieldChange: (diffId: string, patch: { ticketCategory?: TicketCategory; title?: string }) => void
  onToggleDiff: (diffId: string, checked: boolean) => void
  preview: ExistingTripImportPreview
  title: string
}) {
  if (diffs.length === 0) return null
  return (
    <section className="rounded-xl border border-outline-variant/30 bg-surface-container-high p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-on-surface">{title}</h4>
        <span className="text-xs tm-muted">{diffs.filter((diff) => checkedDiffIds.includes(diff.id)).length}/{diffs.length} 已选</span>
      </div>
      <div className="space-y-2">
        {diffs.map((diff) => (
          <div className="grid grid-cols-[auto_1fr] gap-3 rounded-lg bg-surface-container px-3 py-2" key={diff.id}>
            <input
              checked={checkedDiffIds.includes(diff.id)}
              className="mt-1 size-4"
              onChange={(event) => onToggleDiff(diff.id, event.target.checked)}
              type="checkbox"
            />
            <DiffPreview
              allItems={allItems}
              days={days}
              diff={diff}
              onBindTicketTargetChange={onBindTicketTargetChange}
              onCreateItemDateChange={onCreateItemDateChange}
              onCreateItemMergeTargetChange={onCreateItemMergeTargetChange}
              onCreateTicketFieldChange={onCreateTicketFieldChange}
              onMergeTicketFieldChange={onMergeTicketFieldChange}
              preview={preview}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function DiffPreview({
  allItems,
  days,
  diff,
  onBindTicketTargetChange,
  onCreateItemDateChange,
  onCreateItemMergeTargetChange,
  onCreateTicketFieldChange,
  onMergeTicketFieldChange,
  preview,
}: {
  allItems: ItineraryItem[]
  days: Day[]
  diff: ExistingTripImportDiff
  onBindTicketTargetChange: (diffId: string, value: string) => void
  onCreateItemDateChange: (diffId: string, value: string) => void
  onCreateItemMergeTargetChange: (diffId: string, targetItemId: string) => void
  onCreateTicketFieldChange: (diffId: string, patch: { ticketCategory?: TicketCategory; title?: string }) => void
  onMergeTicketFieldChange: (diffId: string, patch: { ticketCategory?: TicketCategory; title?: string }) => void
  preview: ExistingTripImportPreview
}) {
  const sourceLabels = diff.sourceIds
    .map((sourceId) => preview.sourceSummaries.find((source) => source.id === sourceId)?.label)
    .filter((label): label is string => Boolean(label))
  const createItemDiffs = preview.diffs.filter((candidate) => candidate.type === 'create_item')
  const createDayDiffs = preview.diffs.filter((candidate) => candidate.type === 'create_day')
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{diff.summary}</p>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{formatConfidence(diff.confidence)}</span>
      </div>
      <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">{diff.reason}</p>
      <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">{describeDiff(diff)}</p>
      {sourceLabels.length > 0 ? (
        <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">来源：{sourceLabels.join('、')}</p>
      ) : null}

      {diff.type === 'create_item' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="min-w-0 text-xs font-semibold tm-muted">
            目标日期
            <select
              className="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-2 py-2 text-xs text-on-surface"
              onChange={(event) => onCreateItemDateChange(diff.id, event.target.value)}
              value={diff.data.targetDayId ? `day:${diff.data.targetDayId}` : `temp:${diff.data.tempDayKey ?? ''}`}
            >
              {days.map((day) => <option key={day.id} value={`day:${day.id}`}>{day.date} · {day.title}</option>)}
              {createDayDiffs.map((candidate) => candidate.type === 'create_day'
                ? <option key={candidate.data.tempDayKey} value={`temp:${candidate.data.tempDayKey}`}>{candidate.data.date} · 新增日期</option>
                : null)}
            </select>
          </label>
          <label className="min-w-0 text-xs font-semibold tm-muted">
            处理方式
            <select
              className="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-2 py-2 text-xs text-on-surface"
              onChange={(event) => {
                if (event.target.value.startsWith('merge:')) {
                  onCreateItemMergeTargetChange(diff.id, event.target.value.slice('merge:'.length))
                }
              }}
              value="create"
            >
              <option value="create">新增行程点</option>
              {allItems.map((item) => <option key={item.id} value={`merge:${item.id}`}>合并到：{item.title}</option>)}
            </select>
          </label>
        </div>
      ) : null}

      {diff.type === 'create_ticket' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="min-w-0 text-xs font-semibold tm-muted">
            票据名称
            <input
              className="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-2 py-2 text-xs text-on-surface"
              onBlur={(event) => {
                const title = event.target.value.trim()
                if (title) onCreateTicketFieldChange(diff.id, { title })
              }}
              defaultValue={diff.data.title}
            />
          </label>
          <label className="min-w-0 text-xs font-semibold tm-muted">
            票据分类
            <select
              className="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-2 py-2 text-xs text-on-surface"
              onChange={(event) => onCreateTicketFieldChange(diff.id, { ticketCategory: event.target.value as TicketCategory })}
              value={diff.data.ticketCategory ?? 'other'}
            >
              {ticketCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
      ) : null}

      {diff.type === 'merge_ticket_meta' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="min-w-0 text-xs font-semibold tm-muted">
            建议名称
            <input
              className="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-2 py-2 text-xs text-on-surface"
              onBlur={(event) => {
                const title = event.target.value.trim()
                if (title) onMergeTicketFieldChange(diff.id, { title })
              }}
              defaultValue={diff.data.patch.title ?? ''}
              placeholder="保持现有名称"
            />
          </label>
          <label className="min-w-0 text-xs font-semibold tm-muted">
            票据分类
            <select
              className="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-2 py-2 text-xs text-on-surface"
              onChange={(event) => onMergeTicketFieldChange(diff.id, { ticketCategory: event.target.value as TicketCategory })}
              value={diff.data.patch.ticketCategory ?? 'other'}
            >
              {ticketCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
      ) : null}

      {diff.type === 'bind_ticket' || diff.type === 'bind_existing_ticket' ? (
        <label className="block min-w-0 text-xs font-semibold tm-muted">
          绑定目标
          <select
            className="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-2 py-2 text-xs text-on-surface"
            onChange={(event) => onBindTicketTargetChange(diff.id, event.target.value)}
            value={diff.data.targetItemId ? `item:${diff.data.targetItemId}` : diff.data.targetTempItemKey ? `temp:${diff.data.targetTempItemKey}` : 'none'}
          >
            <option value="none">暂不绑定</option>
            {allItems.map((item) => <option key={item.id} value={`item:${item.id}`}>{item.title}</option>)}
            {createItemDiffs.map((candidate) => candidate.type === 'create_item'
              ? <option key={candidate.data.tempItemKey} value={`temp:${candidate.data.tempItemKey}`}>新行程点：{candidate.data.fields.title}</option>
              : null)}
          </select>
        </label>
      ) : null}
    </div>
  )
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-container-high px-3 py-2">
      <p className="text-[11px] font-semibold tm-muted">{label}</p>
      <p className="text-lg font-semibold text-on-surface">{value}</p>
    </div>
  )
}

function needsReview(diff: ExistingTripImportDiff, preview: ExistingTripImportPreview) {
  if (diff.confidence === 'low' || !diff.checked || diff.type === 'update_trip_dates') {
    return true
  }
  if (diff.type === 'create_ticket') {
    return !preview.diffs.some((candidate) =>
      candidate.type === 'bind_ticket' &&
      candidate.data.tempTicketKey === diff.data.tempTicketKey &&
      Boolean(candidate.data.targetItemId || candidate.data.targetTempItemKey)
    )
  }
  return false
}

function buildMergePatchForPreview(target: ItineraryItem, fields: ExistingTripImportItemFields): ExistingTripImportItemPatch {
  const patch: ExistingTripImportItemPatch = {}
  for (const key of ['address', 'endTime', 'locationName', 'notes', 'previousTransportMode', 'previousTransportDurationMinutes', 'previousTransportNote', 'startTime', 'transportMode'] as const) {
    if (fields[key] !== undefined && target[key] === undefined) {
      patch[key] = fields[key] as never
    }
  }
  return patch
}

function getTravelInboxAppliedChangesStorageKey(tripId: string) {
  return `${TRAVEL_INBOX_APPLIED_CHANGES_KEY_PREFIX}${tripId}`
}

function readTravelInboxAppliedChanges(tripId: string): ExistingTripImportAppliedChange[] {
  try {
    if (typeof window === 'undefined') return []
    const raw = window.sessionStorage.getItem(getTravelInboxAppliedChangesStorageKey(tripId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isTravelInboxAppliedChange) : []
  } catch {
    return []
  }
}

function persistTravelInboxAppliedChanges(tripId: string, changes: ExistingTripImportAppliedChange[]) {
  try {
    if (typeof window === 'undefined') return
    const key = getTravelInboxAppliedChangesStorageKey(tripId)
    if (changes.length === 0) {
      window.sessionStorage.removeItem(key)
      return
    }
    window.sessionStorage.setItem(key, JSON.stringify(changes))
  } catch {
    // Session storage is best-effort; the in-memory result list still renders until remount.
  }
}

function isTravelInboxAppliedChange(input: unknown): input is ExistingTripImportAppliedChange {
  if (!input || typeof input !== 'object') return false
  const record = input as Record<string, unknown>
  const action = record.action
  const kind = record.kind
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    (action === 'appended' || action === 'bound' || action === 'created' || action === 'merged' || action === 'updated') &&
    (kind === 'day' || kind === 'item' || kind === 'note' || kind === 'ticket' || kind === 'trip') &&
    (record.dayId === undefined || typeof record.dayId === 'string') &&
    (record.itemId === undefined || typeof record.itemId === 'string') &&
    (record.ticketId === undefined || typeof record.ticketId === 'string')
  )
}

function describeEntryStatus(entry: TravelInboxEntry) {
  if (entry.status === 'error') return '提取失败，可重试'
  if (entry.status === 'recognizing') return 'AI 识别中'
  if (entry.status === 'previewed') return '已生成预览'
  return '待识别'
}

function formatConfidence(confidence: ExistingTripImportDiff['confidence']) {
  if (confidence === 'high') return '高置信'
  if (confidence === 'low') return '低置信'
  return '中置信'
}

function describeDiff(diff: ExistingTripImportDiff) {
  if (diff.type === 'create_item') {
    return [diff.data.fields.startTime, diff.data.fields.title, diff.data.fields.locationName].filter(Boolean).join(' · ')
  }
  if (diff.type === 'merge_item_fields') {
    return `填补字段：${Object.keys(diff.data.patch).join('、') || '无'}`
  }
  if (diff.type === 'append_item_note' || diff.type === 'append_trip_note') {
    return diff.data.note
  }
  if (diff.type === 'create_ticket') {
    const category = ticketCategoryLabels[diff.data.ticketCategory ?? 'other']
    return diff.data.fileName ? `保存${category}：${diff.data.fileName}` : `创建${category}记录`
  }
  if (diff.type === 'merge_ticket_meta') {
    return [
      diff.data.patch.title ? `命名为「${diff.data.patch.title}」` : '',
      diff.data.patch.ticketCategory ? `分类：${ticketCategoryLabels[diff.data.patch.ticketCategory]}` : '',
      diff.data.patch.note ? '追加备注' : '',
    ].filter(Boolean).join(' · ') || '更新票据元数据'
  }
  if (diff.type === 'bind_ticket' || diff.type === 'bind_existing_ticket') {
    return '将票据绑定到目标行程点'
  }
  if (diff.type === 'update_trip_dates') {
    return `${diff.data.startDate} 至 ${diff.data.endDate}`
  }
  if (diff.type === 'create_day') {
    return diff.data.date
  }
  return ''
}

function canOpenAppliedChange(change: ExistingTripImportAppliedChange) {
  return (change.kind === 'item' && Boolean(change.dayId && change.itemId)) || change.kind === 'ticket'
}

function openAppliedChange(tripId: string, change: ExistingTripImportAppliedChange) {
  if (change.kind === 'item' && change.dayId && change.itemId) {
    navigateTo('item', { dayId: change.dayId, itemId: change.itemId, tripId })
    return
  }
  if (change.kind === 'ticket') {
    navigateTo('tickets', change.itemId ? { itemId: change.itemId, tripId } : { tripId })
  }
}

function formatAppliedChange(change: ExistingTripImportAppliedChange) {
  const actionLabels: Record<ExistingTripImportAppliedChange['action'], string> = {
    appended: '追加',
    bound: '绑定',
    created: '新增',
    merged: '合并',
    updated: '更新',
  }
  const kindLabels: Record<ExistingTripImportAppliedChange['kind'], string> = {
    day: '日期',
    item: '行程点',
    note: '备注',
    ticket: '票据',
    trip: '旅行',
  }
  return `${actionLabels[change.action]}${kindLabels[change.kind]}`
}

function inferMimeType(fileName: string) {
  const kind = inferTravelInboxSourceKind(fileName)
  if (kind === 'pdf') return 'application/pdf'
  if (kind === 'trip_plan' && fileName.toLowerCase().endsWith('.json')) return 'application/json'
  if (kind === 'trip_plan') return 'application/zip'
  if (kind === 'html') return 'text/html'
  if (kind === 'email') return 'message/rfc822'
  if (kind === 'text_file') return 'text/plain'
  return 'application/octet-stream'
}
