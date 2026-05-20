import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, Cloud, Download, Info, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import {
  completeTripAutoSnapshotSuccess,
  getTripAutoSnapshotStatus,
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
    if (result.status === 'possible_conflict') {
      setUploadConfirmTarget(result)
      return
    }
    setBusySignature(result.signature)
    setError(null)
    setMessage(null)
    try {
      await ensureCloudSnapshotActionReady()
      await uploadTripCloudBackup(result.tripId)
      const autoBackupStatus = getTripAutoSnapshotStatus(result.tripId)
      if (autoBackupStatus?.dirtyAt) {
        completeTripAutoSnapshotSuccess(result.tripId, autoBackupStatus.dirtyAt)
      }
      setMessage('本地快照已上传，已创建新的云端快照。')
      await refreshCloudSnapshotChecks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '上传本地快照失败。')
    } finally {
      setBusySignature(null)
    }
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
      suppressCloudSnapshotPrompt(target.signature)
      setRestoreTarget(null)
      await refreshCloudSnapshotChecks()
      navigateTo('trip', { tripId: result.tripId })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '恢复云端快照失败。')
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
      await uploadTripCloudBackup(target.tripId)
      const autoBackupStatus = getTripAutoSnapshotStatus(target.tripId)
      if (autoBackupStatus?.dirtyAt) {
        completeTripAutoSnapshotSuccess(target.tripId, autoBackupStatus.dirtyAt)
      }
      setMessage('本地快照已上传，已创建新的云端快照。')
      setUploadConfirmTarget(null)
      await refreshCloudSnapshotChecks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '上传本地快照失败。')
    } finally {
      setBusySignature(null)
    }
  }

  return (
    <section className="space-y-2" data-testid="cloud-snapshot-check-prompts">
      {message ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700">{message}</p>
      ) : null}
      {error ? (
        <p className="break-words rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 [overflow-wrap:anywhere]">
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
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
          还有 {hiddenCount} 个云端快照提醒，请在云端快照列表中查看。
        </p>
      ) : null}
      <ConfirmDialog
        body="恢复会创建一个新的本地旅行副本，不会覆盖当前本地旅行，也不会删除云端快照。恢复后 Home 可能出现两个同名旅行，恢复副本会带有来源标识。"
        confirmLabel="恢复为新旅行副本"
        icon={<Download className="size-5" />}
        loading={Boolean(busySignature && restoreTarget?.signature === busySignature)}
        onCancel={() => {
          if (!busySignature) {
            setRestoreTarget(null)
          }
        }}
        onConfirm={() => void handleRestoreConfirmed()}
        open={Boolean(restoreTarget)}
        title="恢复为新旅行副本？"
      />
      <ConfirmDialog
        body="上传会创建一个新的云端快照，不会删除旧快照，也不会把云端修改合并到当前本地旅行。如果云端快照里有你需要的数据，请先恢复为新旅行副本后再决定。"
        confirmLabel="上传本地快照"
        icon={<Upload className="size-5" />}
        loading={Boolean(busySignature && uploadConfirmTarget?.signature === busySignature)}
        onCancel={() => {
          if (!busySignature) {
            setUploadConfirmTarget(null)
          }
        }}
        onConfirm={() => void handleUploadConfirmed()}
        open={Boolean(uploadConfirmTarget)}
        title="上传本地快照？"
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
      <summary className="flex cursor-pointer items-center gap-1 text-slate-400 transition hover:text-slate-600 select-none marker:hidden [&::-webkit-details-marker]:hidden">
        <Info className="size-3" />
        <span>为什么会出现此提醒？</span>
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-2 space-y-1 pl-4">
        {rows.map((row) => (
          <p key={row.label} className="leading-5 text-slate-500">
            {row.label}：{row.value}（{row.description}）
          </p>
        ))}
        <p className="pt-1 leading-5 text-slate-400">
          系统只会提醒版本差异，不会自动覆盖、合并或删除任何数据。若本地或云端版本变化，提醒可能再次出现。
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
    <div className="grid gap-1.5 rounded-xl bg-white/75 p-2 text-xs ring-1 ring-slate-100 dark:bg-slate-900/60 dark:ring-slate-700/70">
      {rows.map((row) => (
        <div className="flex min-w-0 items-start justify-between gap-2" key={row.label}>
          <span className="shrink-0 font-semibold text-slate-500 dark:text-slate-400">{row.label}</span>
          <span className="min-w-0 text-right font-medium text-slate-800 dark:text-slate-100">{row.value}</span>
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
          ? 'space-y-2 rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2.5 shadow-[0_6px_18px_rgba(47,65,88,0.04)]'
          : 'space-y-3 rounded-2xl border border-sky-100 bg-sky-50/70 px-3 py-3'
      }
      data-testid="cloud-snapshot-check-card"
    >
      <div className="flex items-start gap-2">
        <div
          className={`mt-0.5 flex shrink-0 items-center justify-center rounded-lg text-sky-600 ${
            isTripVariant ? 'size-6 bg-sky-50' : 'size-7 bg-white/80'
          }`}
        >
          {view.icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-slate-950 [overflow-wrap:anywhere]">{view.title}</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
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
            上传本地快照
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
            恢复为新旅行副本
          </Button>
        ) : null}
        <Button
          className={`${isTripVariant ? 'min-h-8' : 'min-h-9'} px-3 text-xs ${result.status === 'possible_conflict' ? 'w-full' : ''}`}
          data-testid="cloud-snapshot-view-backups"
          onClick={() => navigateTo('settings', { section: 'cloud' })}
          variant="secondary"
        >
          查看云端快照
        </Button>
      </div>
      <button
        className="text-xs font-semibold text-slate-400 transition hover:text-slate-600"
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
    throw new Error('云端快照未配置，请先配置 Supabase 环境变量。')
  }

  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    throw new Error('当前离线，无法访问云端快照。')
  }

  const session = await getCurrentSession().catch(() => null)
  if (!session) {
    throw new Error('请先登录云端快照账号。')
  }
}
