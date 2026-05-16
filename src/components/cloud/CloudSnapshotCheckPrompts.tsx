import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Cloud, Download, Upload } from 'lucide-react'
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
    </section>
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

  return (
    <article
      className="space-y-3 rounded-2xl border border-sky-100 bg-sky-50/70 px-3 py-3"
      data-testid="cloud-snapshot-check-card"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/80 text-sky-600">
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
      <div className={result.status === 'possible_conflict' ? 'grid gap-2' : 'grid grid-cols-2 gap-2'}>
        {result.status === 'local_newer' || result.status === 'possible_conflict' ? (
          <Button
            className="min-h-9 px-3 text-xs"
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
            className="min-h-9 px-3 text-xs"
            data-testid="cloud-snapshot-restore"
            icon={<Download className="size-3.5" />}
            loading={busy}
            onClick={onRestore}
          >
            恢复为新旅行
          </Button>
        ) : null}
        <Button
          className={`min-h-9 px-3 text-xs ${result.status === 'possible_conflict' ? 'w-full' : ''}`}
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
      detail: '恢复会创建一个新的本地旅行，不会覆盖当前数据。',
      icon: <Cloud className="size-4" />,
      title: '发现云端有较新的备份',
    }
  }

  if (result.status === 'local_newer') {
    return {
      detail: '你可以手动上传当前本地快照，云端不会自动覆盖。',
      icon: <Upload className="size-4" />,
      title: '本地版本较新，可以上传到云端',
    }
  }

  return {
    detail: '建议先查看云端备份，再决定上传本地快照或恢复云端为新旅行。',
    icon: <AlertTriangle className="size-4" />,
    title: '本地和云端可能都有更新，请手动选择',
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
