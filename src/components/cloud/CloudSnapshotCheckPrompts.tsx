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
  dismissCloudSnapshotPrompt,
  formatVersionTimestamp,
  getCloudSnapshotCheckState,
  refreshCloudSnapshotChecks,
  subscribeCloudSnapshotChecks,
  suppressCloudSnapshotPrompt,
  type CloudSnapshotCheckResult,
} from '../../lib/cloudSnapshotCheck'
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
      setMessage('本地快照已上传到云端。')
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
      setMessage('本地快照已上传到云端。')
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
          还有 {hiddenCount} 个云端快照提醒，请在云端备份列表中查看。
        </p>
      ) : null}
      <ConfirmDialog
        body="恢复会创建一个新的本地旅行，不会覆盖当前本地数据。"
        confirmLabel="恢复为新旅行"
        icon={<Download className="size-5" />}
        loading={Boolean(busySignature && restoreTarget?.signature === busySignature)}
        onCancel={() => {
          if (!busySignature) {
            setRestoreTarget(null)
          }
        }}
        onConfirm={() => void handleRestoreConfirmed()}
        open={Boolean(restoreTarget)}
        title="恢复云端快照？"
      />
      <ConfirmDialog
        body="上传本地快照后会创建一个新的云端备份快照，不会覆盖已有的云端备份。如果云端也有你需要的数据，建议先恢复云端备份再上传。"
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
  const lines = buildVersionContextLines(result)
  if (lines.length === 0) {
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
        {lines.map((line, i) => (
          <p key={i} className="leading-5 text-slate-500">{line}</p>
        ))}
        <p className="pt-1 leading-5 text-slate-400">
          系统只会提醒您版本差异，不会自动覆盖或合并任何数据。
        </p>
      </div>
    </details>
  )
}

function buildVersionContextLines(result: CloudSnapshotCheckResult): string[] {
  const lines: string[] = []
  const localTime = formatVersionTimestamp(result.tripUpdatedAt)
  const cloudTime = formatVersionTimestamp(result.cloudVersion)
  const dirtyTime = formatVersionTimestamp(result.dirtyAt)

  if (localTime) {
    lines.push(`本地版本来自：${localTime}（旅行数据最后更新时间）`)
  }
  if (cloudTime) {
    lines.push(`云端版本来自：${cloudTime}（云端备份导出时间）`)
  }
  if (dirtyTime) {
    lines.push(`未上传修改：${dirtyTime}`)
  }
  return lines
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
            恢复为新旅行
          </Button>
        ) : null}
        <Button
          className={`${isTripVariant ? 'min-h-8' : 'min-h-9'} px-3 text-xs ${result.status === 'possible_conflict' ? 'w-full' : ''}`}
          data-testid="cloud-snapshot-view-backups"
          onClick={() => navigateTo('settings', { section: 'cloud' })}
          variant="secondary"
        >
          查看云端备份
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
  if (result.status === 'cloud_newer') {
    return {
      detail: '云端有一份比本地更新的备份，恢复后会创建一个新的本地旅行，不会覆盖当前本地数据。',
      icon: <Cloud className="size-4" />,
      title: '云端有较新的备份',
    }
  }

  if (result.status === 'local_newer') {
    return {
      detail: '本地有未同步到云端的修改，上传后会创建一个新的云端备份快照，不会覆盖已有的云端备份。',
      icon: <Upload className="size-4" />,
      title: '本地版本较新',
    }
  }

  return {
    detail: '本地有未同步的修改，同时云端也有新的备份。请手动选择保留哪一份，或先查看详情再决定。',
    icon: <AlertTriangle className="size-4" />,
    title: '本地和云端可能都有更新',
  }
}

async function ensureCloudSnapshotActionReady() {
  if (!getSupabaseConfigStatus().configured) {
    throw new Error('云端备份未配置，请先配置 Supabase 环境变量。')
  }

  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    throw new Error('当前离线，无法访问云端备份。')
  }

  const session = await getCurrentSession().catch(() => null)
  if (!session) {
    throw new Error('请先登录云端备份账号。')
  }
}
