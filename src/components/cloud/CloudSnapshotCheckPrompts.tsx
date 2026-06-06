import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, Cloud, Download, Info, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import {
  completeTripAutoSnapshotSuccess,
  getTripAutoSnapshotStatus,
  markTripAutoSnapshotSynced,
} from '../../lib/autoSnapshotBackup'
import {
  getCurrentSession,
  getSupabaseConfigStatus,
  restoreCloudBackup,
  uploadTripCloudBackup,
} from '../../lib/cloudBackup'
import {
  buildCloudSnapshotVersionContextRows,
  dismissCloudSnapshotPrompt,
  getCloudSnapshotCheckState,
  refreshCloudSnapshotChecks,
  subscribeCloudSnapshotChecks,
  suppressCloudSnapshotPrompt,
  type CloudSnapshotCheckResult,
} from '../../lib/cloudSnapshotCheck'
import { getCloudSnapshotPromptCopy } from '../../lib/cloudSnapshotPromptCopy'
import { navigateTo } from '../../lib/routes'

type CloudSnapshotCheckPromptsProps = {
  maxItems?: number
  tripId?: string
  variant?: 'trip' | 'settings'
}

export function CloudSnapshotCheckPrompts({
  maxItems = 5,
  tripId,
  variant = 'trip',
}: CloudSnapshotCheckPromptsProps) {
  const [results, setResults] = useState(() => getCloudSnapshotCheckState().results)
  const [busySignature, setBusySignature] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<CloudSnapshotCheckResult | null>(null)
  const [uploadConfirmTarget, setUploadConfirmTarget] = useState<CloudSnapshotCheckResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => subscribeCloudSnapshotChecks((state) => setResults(state.results)), [])

  const visibleResults = useMemo(() => {
    const filtered = tripId ? results.filter((result) => result.tripId === tripId) : results
    return filtered.slice(0, maxItems)
  }, [maxItems, results, tripId])
  const hiddenCount = tripId ? 0 : Math.max(0, results.length - visibleResults.length)

  if (visibleResults.length === 0) {
    return null
  }

  async function handleUpload(result: CloudSnapshotCheckResult) {
    setUploadConfirmTarget(result)
  }

  async function handleRestoreConfirmed() {
    if (!restoreTarget) {
      return
    }

    const target = restoreTarget
    setBusySignature(target.signature)
    setError(null)
    setMessage(null)
    try {
      await ensureCloudSnapshotActionReady()
      const result = await restoreCloudBackup(target.backupId)
      const exportedAt = Date.parse(result.exportedAt)
      markTripAutoSnapshotSynced(target.tripId, Number.isFinite(exportedAt) ? exportedAt : Date.now())
      suppressCloudSnapshotPrompt(target.signature)
      setRestoreTarget(null)
      await refreshCloudSnapshotChecks()
      navigateTo('trip', { tripId: result.tripId })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '同步账号数据到此设备失败。')
    } finally {
      setBusySignature(null)
    }
  }

  function handleDismiss(result: CloudSnapshotCheckResult) {
    dismissCloudSnapshotPrompt(result.signature)
  }

  async function handleUploadConfirmed() {
    if (!uploadConfirmTarget) {
      return
    }

    const target = uploadConfirmTarget
    setBusySignature(target.signature)
    setError(null)
    setMessage(null)
    try {
      await ensureCloudSnapshotActionReady()
      const result = await uploadTripCloudBackup(target.tripId)
      const autoBackupStatus = getTripAutoSnapshotStatus(target.tripId)
      const exportedAt = Date.parse(result.exportedAt)
      if (autoBackupStatus?.dirtyAt) {
        completeTripAutoSnapshotSuccess(
          target.tripId,
          autoBackupStatus.dirtyAt,
          Number.isFinite(exportedAt) ? exportedAt : Date.now(),
        )
      } else {
        markTripAutoSnapshotSynced(target.tripId, Number.isFinite(exportedAt) ? exportedAt : Date.now())
      }
      setMessage('此设备版本已同步到账号。')
      setUploadConfirmTarget(null)
      await refreshCloudSnapshotChecks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '立即同步失败。')
    } finally {
      setBusySignature(null)
    }
  }

  return (
    <section className="space-y-2" data-testid="cloud-snapshot-check-prompts">
      {message ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700 dark:text-emerald-300">{message}</p>
      ) : null}
      {error ? (
        <p className="break-words rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-300 [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}
      {visibleResults.map((result) => (
        <CloudSnapshotPromptCard
          busy={busySignature === result.signature}
          key={result.signature}
          onDismiss={() => handleDismiss(result)}
          onRestore={() => setRestoreTarget(result)}
          onUpload={() => void handleUpload(result)}
          result={result}
          variant={variant}
        />
      ))}
      {hiddenCount > 0 ? (
        <p className="rounded-xl bg-surface-container-low px-3 py-2 text-xs leading-5 text-on-surface-variant">
          还有 {hiddenCount} 个云端同步提醒，请在云端同步列表中查看。
        </p>
      ) : null}
      <ConfirmDialog
        body={buildCloudRestoreConfirmBody(restoreTarget)}
        confirmLabel={getRestoreActionLabel()}
        icon={<Download className="size-5" />}
        loading={Boolean(busySignature && restoreTarget?.signature === busySignature)}
        onCancel={() => {
          if (!busySignature) {
            setRestoreTarget(null)
          }
        }}
        onConfirm={() => void handleRestoreConfirmed()}
        open={Boolean(restoreTarget)}
        testId="cloud-save-confirm-dialog"
        title="同步账号数据到此设备？"
      />
      <ConfirmDialog
        body={buildCloudUploadConfirmBody(uploadConfirmTarget)}
        confirmLabel={getUploadActionLabel(uploadConfirmTarget?.status)}
        icon={<Upload className="size-5" />}
        loading={Boolean(busySignature && uploadConfirmTarget?.signature === busySignature)}
        onCancel={() => {
          if (!busySignature) {
            setUploadConfirmTarget(null)
          }
        }}
        onConfirm={() => void handleUploadConfirmed()}
        open={Boolean(uploadConfirmTarget)}
        testId="cloud-save-confirm-dialog"
        title={uploadConfirmTarget?.status === 'possible_conflict' ? '将此设备版本同步到账号？' : '立即同步到账号？'}
      />
    </section>
  )
}

function VersionContextDetail({ result }: { result: CloudSnapshotCheckResult }) {
  const rows = buildCloudSnapshotVersionContextRows(result)
  if (rows.length === 0) {
    return null
  }

  return (
    <details className="group text-xs">
      <summary className="flex cursor-pointer items-center gap-1 text-outline transition hover:text-on-surface-variant select-none marker:hidden [&::-webkit-details-marker]:hidden">
        <Info className="size-3" />
        <span>为什么会出现此提醒？</span>
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-2 space-y-1 pl-4">
        {rows.map((row) => (
          <p key={row.label} className="leading-5 text-on-surface-variant">
            {row.label}：{row.value}（{row.description}）
          </p>
        ))}
        <p className="pt-1 leading-5 text-outline">
          系统不会做字段级合并或自动删除账号数据；若此设备或账号数据变化，提醒可能再次出现。
        </p>
      </div>
    </details>
  )
}

function VersionContextSummary({ result }: { result: CloudSnapshotCheckResult }) {
  const rows = buildCloudSnapshotVersionContextRows(result)
  if (rows.length === 0) {
    return null
  }

  return (
    <div className="grid gap-1.5 rounded-xl bg-white/75 p-2 text-xs ring-1 ring-outline-variant/30 dark:bg-surface-container-highest/60 dark:ring-outline-variant/30/70">
      {rows.map((row) => (
        <div className="flex min-w-0 items-start justify-between gap-2" key={row.label}>
          <span className="shrink-0 font-semibold text-on-surface-variant dark:text-outline">{row.label}</span>
          <span className="min-w-0 text-right font-medium text-on-surface dark:text-on-surface">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

function CloudSnapshotPromptCard({
  busy,
  onDismiss,
  onRestore,
  onUpload,
  result,
  variant,
}: {
  busy: boolean
  onDismiss: () => void
  onRestore: () => void
  onUpload: () => void
  result: CloudSnapshotCheckResult
  variant: 'trip' | 'settings'
}) {
  const view = getPromptView(result)
  const isTripVariant = variant === 'trip'

  return (
    <article
      className={
        isTripVariant
          ? 'space-y-2 rounded-2xl border border-outline-variant/30/70 bg-white/90 px-3 py-2.5 shadow-[0_6px_18px_rgba(47,65,88,0.04)]'
          : 'space-y-3 rounded-2xl border border-sky-100 bg-sky-50/70 px-3 py-3'
      }
      data-testid={isTripVariant ? 'trip-home-cloud-save-card' : 'cloud-snapshot-check-card'}
    >
      <div className="flex items-start gap-2">
        <div
          className={`mt-0.5 flex shrink-0 items-center justify-center rounded-lg text-sky-600 dark:text-sky-300 ${
            isTripVariant ? 'size-6 bg-sky-50' : 'size-7 bg-white/80'
          }`}
        >
          {view.icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{view.title}</p>
          <p className="mt-1 break-words text-xs leading-5 text-on-surface-variant [overflow-wrap:anywhere]">
            {variant === 'settings' ? `${result.tripTitle} · ` : ''}
            {view.detail}
          </p>
        </div>
      </div>
      <VersionContextSummary result={result} />
      <VersionContextDetail result={result} />
      <div className={result.status === 'possible_conflict' ? 'grid gap-2' : 'grid grid-cols-2 gap-2'}>
        {result.status === 'local_newer' || result.status === 'possible_conflict' ? (
          <Button
            className={`${isTripVariant ? 'min-h-8' : 'min-h-9'} px-3 text-xs`}
            data-testid="cloud-snapshot-upload"
            icon={<Upload className="size-3.5" />}
            loading={busy}
            onClick={onUpload}
          >
            {getUploadActionLabel(result.status)}
          </Button>
        ) : null}
        {result.status === 'cloud_newer' || result.status === 'possible_conflict' ? (
          <Button
            className={`${isTripVariant ? 'min-h-8' : 'min-h-9'} px-3 text-xs`}
            data-testid="cloud-snapshot-restore"
            icon={<Download className="size-3.5" />}
            loading={busy}
            onClick={onRestore}
          >
            {getRestoreActionLabel()}
          </Button>
        ) : null}
        <Button
          className={`${isTripVariant ? 'min-h-8' : 'min-h-9'} px-3 text-xs ${result.status === 'possible_conflict' ? 'w-full' : ''}`}
          data-testid="cloud-snapshot-view-backups"
          onClick={() => navigateTo('settings', { section: 'cloud' })}
          variant="secondary"
        >
          查看云端同步
        </Button>
      </div>
      <button
        className="text-xs font-semibold text-outline transition hover:text-on-surface-variant"
        data-testid="cloud-snapshot-dismiss"
        onClick={onDismiss}
        type="button"
      >
        暂不处理
      </button>
    </article>
  )
}

function getPromptView(result: CloudSnapshotCheckResult) {
  const copy = getCloudSnapshotPromptCopy(result.status)

  if (result.status === 'cloud_newer') {
    return {
      detail: copy.detail,
      icon: <Cloud className="size-4" />,
      title: copy.title,
    }
  }

  if (result.status === 'local_newer') {
    return {
      detail: copy.detail,
      icon: <Upload className="size-4" />,
      title: copy.title,
    }
  }

  return {
    detail: copy.detail,
    icon: <AlertTriangle className="size-4" />,
    title: copy.title,
  }
}

async function ensureCloudSnapshotActionReady() {
  if (!getSupabaseConfigStatus().configured) {
    throw new Error('云端同步未配置，请先配置 Supabase 环境变量。')
  }

  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    throw new Error('当前离线，无法访问云端同步。')
  }

  const session = await getCurrentSession().catch(() => null)
  if (!session) {
    throw new Error('请先登录账号。')
  }
}

function getUploadActionLabel(status: CloudSnapshotCheckResult['status'] | undefined) {
  return status === 'possible_conflict' ? '将此设备版本同步到账号' : '立即同步'
}

function getRestoreActionLabel() {
  return '同步账号数据到此设备'
}

function buildCloudUploadConfirmBody(result: CloudSnapshotCheckResult | null) {
  return [
    '将用此设备版本立即同步到账号。',
    '账号中原有版本会被覆盖。',
    '不会创建新的云端记录列表。',
    '不会自动合并账号中的修改。',
    '这是按方向覆盖，不会自动合并此设备和账号中的修改。',
  ].join('\n') + buildVersionTimestampText(result)
}

function buildCloudRestoreConfirmBody(result: CloudSnapshotCheckResult | null) {
  return [
    '将用账号数据更新此设备旅行。',
    '此设备未同步的修改可能被覆盖。',
    '不会创建重复旅行。',
    '这是按方向覆盖，不会自动合并此设备和账号中的修改。',
    '建议确认方向后再继续。',
  ].join('\n') + buildVersionTimestampText(result)
}

function buildVersionTimestampText(result: CloudSnapshotCheckResult | null) {
  if (!result) {
    return ''
  }

  const rows = buildCloudSnapshotVersionContextRows(result).filter((row) => (
    row.label === '此设备版本' || row.label === '账号数据版本'
  ))
  if (rows.length === 0) {
    return ''
  }

  return `\n\n${rows.map((row) => `${row.label}时间：${row.value}`).join('\n')}`
}
