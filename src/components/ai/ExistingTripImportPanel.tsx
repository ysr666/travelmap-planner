import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileUp, Loader2, Sparkles, Ticket, Wand2 } from 'lucide-react'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import {
  applyExistingTripImportPreview,
  buildExistingTripImportPreview,
  type ExistingTripImportApplyFile,
  type ExistingTripImportDiff,
  type ExistingTripImportDiffCategory,
  type ExistingTripImportPreview,
  type ExistingTripImportSourceSummary,
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
  PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
  type ProviderProxyExistingTripImportRequest,
} from '../../lib/ai/providerProxyContract'
import {
  fetchProviderProxyExistingTripImport,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../../lib/providerProxyClient'
import { SYNC_QUEUE_SUCCESS_COPY } from '../../lib/tripSyncQueue'
import type { Day, ItineraryItem, Trip } from '../../types'

type ExistingTripImportPanelProps = {
  allItems: ItineraryItem[]
  days: Day[]
  onApplied: () => Promise<void>
  trip: Trip
}

const categoryLabels: Record<ExistingTripImportDiffCategory, string> = {
  dates: '日期范围',
  items: '行程点',
  notes: '备注',
  tickets: '票据',
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

export function ExistingTripImportPanel({
  allItems,
  days,
  onApplied,
  trip,
}: ExistingTripImportPanelProps) {
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [pastedText, setPastedText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [languages, setLanguages] = useState<ExistingTripImportOcrLanguage[]>(DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES)
  const [confirmRecognizeOpen, setConfirmRecognizeOpen] = useState(false)
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [progress, setProgress] = useState<ExistingTripImportExtractionProgress | null>(null)
  const [sources, setSources] = useState<ExistingTripImportSourceSummary[]>([])
  const [filesBySourceId, setFilesBySourceId] = useState<Map<string, ExistingTripImportApplyFile>>(new Map())
  const [preview, setPreview] = useState<ExistingTripImportPreview | null>(null)
  const [checkedDiffIds, setCheckedDiffIds] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const selectedCount = preview?.diffs.filter((diff) => checkedDiffIds.includes(diff.id)).length ?? 0
  const canStart = Boolean((pastedText.trim() || files.length > 0) && !isExtracting && !isRecognizing)
  const groupedDiffs = useMemo(() => groupDiffs(preview?.diffs ?? []), [preview])

  async function prepareRecognition() {
    setError(null)
    setSuccessMessage(null)
    setPreview(null)
    setCheckedDiffIds([])
    setWarnings([])
    if (!providerConfig.proxyUrl) {
      setError('当前未配置 provider proxy。')
      return
    }
    setIsExtracting(true)
    setProgress(null)
    try {
      const extraction = await extractExistingTripImportSources({
        files,
        languages,
        onProgress: setProgress,
        pastedText,
      })
      setSources(extraction.sources)
      setFilesBySourceId(extraction.filesBySourceId)
      setWarnings(extraction.warnings)
      if (!extraction.sources.length) {
        setError('没有可识别的文本。')
        return
      }
      setConfirmRecognizeOpen(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '本地提取失败。')
    } finally {
      setIsExtracting(false)
    }
  }

  async function handleConfirmRecognize() {
    if (!providerConfig.proxyUrl) {
      setConfirmRecognizeOpen(false)
      setError('当前未配置 provider proxy。')
      return
    }
    setConfirmRecognizeOpen(false)
    setIsRecognizing(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const request = buildProviderRequest({ allItems, days, sources, trip })
      const response = await fetchProviderProxyExistingTripImport(request, providerConfig.proxyUrl)
      const nextPreview = buildExistingTripImportPreview({
        context: { days, items: allItems, trip },
        providerResult: response.result,
        sourceSummaries: sources,
      })
      setPreview(nextPreview)
      setCheckedDiffIds(nextPreview.diffs.filter((diff) => diff.checked).map((diff) => diff.id))
      setWarnings([
        ...warnings,
        ...(response.warnings ?? []),
        ...nextPreview.warnings,
      ])
    } catch (caught) {
      if (caught instanceof ProviderProxyClientError) {
        setError(caught.message)
      } else {
        setError(caught instanceof Error ? caught.message : 'AI 识别导入失败。')
      }
    } finally {
      setIsRecognizing(false)
    }
  }

  async function handleApply() {
    if (!preview) return
    setIsApplying(true)
    setError(null)
    try {
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
      setSuccessMessage(result.appliedCount > 0 ? `已应用 ${result.appliedCount} 项导入建议。${SYNC_QUEUE_SUCCESS_COPY}` : '没有应用任何建议。')
      setPreview(null)
      setCheckedDiffIds([])
      await onApplied()
    } finally {
      setIsApplying(false)
    }
  }

  function toggleLanguage(language: ExistingTripImportOcrLanguage) {
    setLanguages((current) => current.includes(language)
      ? current.filter((item) => item !== language)
      : [...current, language])
  }

  function toggleCategory(category: ExistingTripImportDiffCategory, checked: boolean) {
    const ids = (preview?.diffs ?? []).filter((diff) => diff.category === category).map((diff) => diff.id)
    setCheckedDiffIds((current) => checked
      ? Array.from(new Set([...current, ...ids]))
      : current.filter((id) => !ids.includes(id)))
  }

  function toggleDiff(diffId: string, checked: boolean) {
    setCheckedDiffIds((current) => checked
      ? Array.from(new Set([...current, diffId]))
      : current.filter((id) => id !== diffId))
  }

  return (
    <Card className="space-y-4" data-testid="existing-trip-import-panel" variant="grouped">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Wand2 className="size-4" />
            </div>
            <h3 className="text-base font-semibold text-on-surface">AI 识别导入</h3>
          </div>
          <p className="mt-1 text-sm leading-6 tm-muted">
            粘贴行程、订单邮件或上传 PDF/图片/票据，本地提取后再确认发送文本生成追加/合并预览。
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-container-high px-3 py-1 text-xs font-medium tm-muted">
          {providerConfig.configured ? 'provider proxy 已配置' : 'provider proxy 未配置'}
        </span>
      </div>

      <textarea
        className="min-h-28 w-full resize-y rounded-xl border border-outline-variant/40 bg-surface-container-high px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
        onChange={(event) => setPastedText(event.target.value)}
        placeholder="粘贴行程文本、订单邮件、酒店确认、票据说明..."
        value={pastedText}
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0 rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-high p-3">
          <input
            ref={fileInputRef}
            accept=".txt,.eml,.html,.htm,.pdf,image/*,.json,.zip"
            className="sr-only"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            type="file"
          />
          <button
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-primary tm-focus"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <FileUp className="size-4" />
            上传文件
          </button>
          {files.length > 0 ? (
            <div className="mt-2 space-y-1 text-xs tm-muted">
              {files.slice(0, 8).map((file) => (
                <p className="break-words [overflow-wrap:anywhere]" key={`${file.name}:${file.size}`}>{file.name}</p>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-center text-xs tm-muted">支持 .txt/.eml/.html/.pdf/image/*/.json/.zip，单文件 20MB。</p>
          )}
        </div>
        <Button
          disabled={!canStart || !providerConfig.configured}
          icon={isExtracting || isRecognizing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          loading={isExtracting || isRecognizing}
          onClick={prepareRecognition}
        >
          识别并预览
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

      {warnings.length > 0 ? (
        <div className="rounded-xl bg-amber-50/80 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {warnings.slice(0, 6).map((warning) => (
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
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-on-surface">导入预览</p>
              <p className="text-xs tm-muted">最终确认前不会写入本地旅行。已选择 {selectedCount} 项。</p>
            </div>
            <Button
              disabled={selectedCount === 0 || isApplying}
              icon={<Ticket className="size-4" />}
              onClick={() => setConfirmApplyOpen(true)}
              variant="secondary"
            >
              应用选中建议
            </Button>
          </div>
          {Object.entries(groupedDiffs).map(([category, diffs]) => diffs.length ? (
            <section className="rounded-xl border border-outline-variant/30 bg-surface-container-high p-3" key={category}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-on-surface">{categoryLabels[category as ExistingTripImportDiffCategory]}</h4>
                <div className="flex gap-2">
                  <button className="text-xs font-semibold text-primary" onClick={() => toggleCategory(category as ExistingTripImportDiffCategory, true)} type="button">全选</button>
                  <button className="text-xs font-semibold tm-muted" onClick={() => toggleCategory(category as ExistingTripImportDiffCategory, false)} type="button">取消</button>
                </div>
              </div>
              <div className="space-y-2">
                {diffs.map((diff) => (
                  <label className="grid grid-cols-[auto_1fr] gap-3 rounded-lg bg-surface-container px-3 py-2" key={diff.id}>
                    <input
                      checked={checkedDiffIds.includes(diff.id)}
                      className="mt-1 size-4"
                      onChange={(event) => toggleDiff(diff.id, event.target.checked)}
                      type="checkbox"
                    />
                    <DiffPreview diff={diff} sources={preview.sourceSummaries} />
                  </label>
                ))}
              </div>
            </section>
          ) : null)}
        </div>
      ) : null}

      <ConfirmDialog
        body={`本地提取/OCR 不上传文件。确认后会发送 ${sources.length} 段提取文本给 provider proxy 的 ${PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION}，最多 1 次 AI 请求；确认应用前不会写入 DB。`}
        confirmLabel="确认识别"
        onCancel={() => setConfirmRecognizeOpen(false)}
        onConfirm={handleConfirmRecognize}
        open={confirmRecognizeOpen}
        testId="existing-trip-import-recognize-confirm"
        title="发送提取文本给 AI 识别？"
      />
      <ConfirmDialog
        body={`将应用 ${selectedCount} 项已勾选建议，创建/更新当前旅行的日期、行程点、票据和备注。应用前会检查本地行程是否变化；确认写入后，登录状态下会自动同步。`}
        confirmLabel="确认应用"
        loading={isApplying}
        onCancel={() => setConfirmApplyOpen(false)}
        onConfirm={handleApply}
        open={confirmApplyOpen}
        testId="existing-trip-import-apply-confirm"
        title="应用导入预览？"
      />
    </Card>
  )
}

function buildProviderRequest({
  allItems,
  days,
  sources,
  trip,
}: {
  allItems: ItineraryItem[]
  days: Day[]
  sources: ExistingTripImportSourceSummary[]
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
    sources: buildExistingTripImportRequestSources(sources),
    trip: {
      destination: trip.destination,
      endDate: trip.endDate,
      id: trip.id,
      startDate: trip.startDate,
      title: trip.title,
    },
  }
}

function groupDiffs(diffs: ExistingTripImportDiff[]) {
  return diffs.reduce<Record<ExistingTripImportDiffCategory, ExistingTripImportDiff[]>>((groups, diff) => {
    groups[diff.category].push(diff)
    return groups
  }, { dates: [], items: [], notes: [], tickets: [] })
}

function DiffPreview({
  diff,
  sources,
}: {
  diff: ExistingTripImportDiff
  sources: ExistingTripImportSourceSummary[]
}) {
  const sourceLabels = diff.sourceIds
    .map((sourceId) => sources.find((source) => source.id === sourceId)?.label)
    .filter((label): label is string => Boolean(label))
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{diff.summary}</p>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{formatConfidence(diff.confidence)}</span>
      </div>
      <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">{diff.reason}</p>
      <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
        {describeDiff(diff)}
      </p>
      {sourceLabels.length > 0 ? (
        <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
          来源：{sourceLabels.join('、')}
        </p>
      ) : null}
    </div>
  )
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
    return diff.data.fileName ? `保存票据：${diff.data.fileName}` : '创建未绑定票据记录'
  }
  if (diff.type === 'merge_ticket_meta') {
    return [
      diff.data.patch.title ? `命名为「${diff.data.patch.title}」` : '',
      diff.data.patch.ticketCategory ? '更新票据分类' : '',
      diff.data.patch.note ? '追加票据备注' : '',
    ].filter(Boolean).join(' · ') || '更新票据元数据'
  }
  if (diff.type === 'bind_ticket') {
    return '将票据绑定到目标行程点'
  }
  if (diff.type === 'bind_existing_ticket') {
    return '将现有票据绑定到目标行程点'
  }
  if (diff.type === 'update_trip_dates') {
    return `${diff.data.startDate} 至 ${diff.data.endDate}`
  }
  if (diff.type === 'create_day') {
    return diff.data.date
  }
  return ''
}
