import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Download,
  KeyRound,
  LoaderCircle,
  LogOut,
  Mail,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
  WifiOff,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import { SectionHeader } from '../ui/SectionHeader'
import { SkeletonLine } from '../ui/SkeletonLine'
import { CloudSnapshotCheckPrompts } from './CloudSnapshotCheckPrompts'
import { ObjectSyncConflictPanel } from './ObjectSyncConflictPanel'
import { listTrips } from '../../db'
import { formatFileSize } from '../../lib/tickets'
import {
  deleteCloudBackup,
  getCurrentUser,
  getSupabaseConfigStatus,
  listCloudBackups,
  restoreCloudBackup,
  signInWithEmailOtp,
  signOut,
  uploadTripCloudBackup,
  verifyEmailOtp,
  type CloudBackupSummary,
  type RestoreCloudBackupResult,
} from '../../lib/cloudBackup'
import { listPendingObjectSyncConflicts } from '../../lib/cloudObjectSync'
import { subscribeTravelDataChanged } from '../../lib/dataEvents'
import { getSupabaseClient, type User } from '../../lib/supabaseClient'
import {
  type AutoSnapshotBackupEntry,
  completeTripAutoSnapshotSuccess,
  getTripAutoSnapshotStatus,
  isAutoSnapshotBackupEnabled,
  listAutoSnapshotBackupEntries,
  markTripAutoSnapshotSynced,
  requestTripAutoSnapshotRetry,
  setAutoSnapshotBackupEnabled,
  subscribeAutoSnapshotBackup,
} from '../../lib/autoSnapshotBackup'
import { groupCloudBackupsForDisplay } from '../../lib/cloudBackupDisplay'
import {
  getCloudSnapshotCheckState,
  subscribeCloudSnapshotChecks,
} from '../../lib/cloudSnapshotCheck'
import {
  getCloudAccountSyncStatusView,
  type CloudAccountSyncStatus,
  type CloudAccountSyncTone,
} from '../../lib/cloudAccountSyncStatus'
import {
  getCloudLoginOnboardingCopy,
  getCloudSyncQueueSummary,
  type CloudLoginOnboardingCopy,
  type CloudSyncQueueSummary,
} from '../../lib/cloudSyncQueueSummary'
import { navigateTo } from '../../lib/routes'
import type { Trip } from '../../types'

type CloudBackupPanelProps = {
  trip: Trip | null
}

const CLOUD_PANEL_STATUS_MESSAGE_KEY = 'tripmap:cloud-panel-status-message'
const CLOUD_PANEL_STATUS_MESSAGE_TTL_MS = 60_000

export function CloudBackupPanel({ trip }: CloudBackupPanelProps) {
  const configStatus = getSupabaseConfigStatus()
  const [user, setUser] = useState<User | null>(null)
  const [backups, setBackups] = useState<CloudBackupSummary[]>([])
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(configStatus.configured)
  const [isSendingOtp, setIsSendingOtp] = useState(false)
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<CloudBackupSummary | null>(null)
  const [restoreResult, setRestoreResult] = useState<RestoreCloudBackupResult | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CloudBackupSummary | null>(null)
  const [message, setMessage] = useState<string | null>(() => readPersistedCloudPanelMessage(trip?.id))
  const [loginOnboarding, setLoginOnboarding] = useState<CloudLoginOnboardingCopy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [autoBackupEnabled, setAutoBackupEnabledState] = useState(() => isAutoSnapshotBackupEnabled())

  const refreshCloudBackups = useCallback(async () => {
    if (!configStatus.configured) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const currentUser = await getCurrentUser()
      setUser(currentUser)
      if (currentUser) {
        setBackups(await listCloudBackups())
      } else {
        setBackups([])
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取云端同步状态失败。')
    } finally {
      setIsLoading(false)
    }
  }, [configStatus.configured])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshCloudBackups(), 0)
    return () => window.clearTimeout(timeout)
  }, [refreshCloudBackups])

  useEffect(() => {
    if (!configStatus.configured) {
      return undefined
    }

    const client = getSupabaseClient()
    if (!client) {
      return undefined
    }

    const { data } = client.auth.onAuthStateChange(() => {
      void refreshCloudBackups()
    })

    return () => data.subscription.unsubscribe()
  }, [configStatus.configured, refreshCloudBackups])

  useEffect(() => {
    return subscribeAutoSnapshotBackup((detail) => {
      if (detail.kind === 'settings') {
        setAutoBackupEnabledState(isAutoSnapshotBackupEnabled())
      }
    })
  }, [])

  function handleAutoBackupToggle() {
    if (!configStatus.configured) {
      return
    }

    const nextValue = !autoBackupEnabled
    setAutoSnapshotBackupEnabled(nextValue)
    setAutoBackupEnabledState(nextValue)
    setMessage(nextValue ? '云端自动同步已开启。' : '云端自动同步已关闭。')
    setError(null)
  }

  async function handleSendOtp() {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('请输入邮箱。')
      return
    }

    setIsSendingOtp(true)
    setError(null)
    setMessage(null)
    try {
      await signInWithEmailOtp(trimmedEmail)
      setMessage('登录链接/验证码已发送，请检查邮箱。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送登录邮件失败。')
    } finally {
      setIsSendingOtp(false)
    }
  }

  async function handleVerifyOtp() {
    const trimmedEmail = email.trim()
    const token = otp.trim()
    if (!trimmedEmail || !token) {
      setError('请输入邮箱和验证码。')
      return
    }

    setIsVerifyingOtp(true)
    setError(null)
    setMessage(null)
    setLoginOnboarding(null)
    try {
      await verifyEmailOtp(trimmedEmail, token)
      setOtp('')
      const [localTrips, accountBackups, queueSummary] = await Promise.all([
        listTrips().catch(() => []),
        listCloudBackups().catch(() => []),
        getCloudSyncQueueSummary(trip?.id).catch(() => null),
      ])
      const accountTripIds = new Set(accountBackups.map((backup) => backup.originalTripId || backup.id))
      const onboarding = getCloudLoginOnboardingCopy({
        accountTripCount: accountTripIds.size,
        localTripCount: localTrips.length,
        pendingQueueCount: queueSummary?.syncItemCount ?? 0,
      })
      setLoginOnboarding(onboarding)
      setMessage(`${onboarding.title}：${onboarding.detail}`)
      await refreshCloudBackups()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '验证码验证失败。')
    } finally {
      setIsVerifyingOtp(false)
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true)
    setError(null)
    setMessage(null)
    try {
      await signOut()
      setUser(null)
      setBackups([])
      setRestoreResult(null)
      setLoginOnboarding(null)
      setMessage('已退出账号。此设备仍可离线查看已缓存内容；登录后可继续同步。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '退出登录失败。')
    } finally {
      setIsSigningOut(false)
    }
  }

  function handleUploadRequest() {
    if (!trip) {
      setError('请先进入某个旅行，再立即同步。')
      return
    }

    setUploadConfirmOpen(true)
  }

  async function handleUploadConfirmed() {
    if (!trip) {
      setError('请先进入某个旅行，再立即同步。')
      setUploadConfirmOpen(false)
      return
    }

    setIsUploading(true)
    setError(null)
    setMessage(null)
    setRestoreResult(null)
    setWarnings([])
    try {
      const result = await uploadTripCloudBackup(trip.id)
      const autoBackupStatus = getTripAutoSnapshotStatus(trip.id)
      const exportedAt = Date.parse(result.exportedAt)
      if (autoBackupStatus?.dirtyAt) {
        completeTripAutoSnapshotSuccess(
          trip.id,
          autoBackupStatus.dirtyAt,
          Number.isFinite(exportedAt) ? exportedAt : Date.now(),
        )
      } else {
        markTripAutoSnapshotSynced(trip.id, Number.isFinite(exportedAt) ? exportedAt : Date.now())
      }
      setUploadConfirmOpen(false)
      setWarnings(result.warnings)
      persistCloudPanelMessage(trip.id, '此设备版本已同步到账号。')
      await refreshCloudBackups()
      setMessage('此设备版本已同步到账号。')
    } catch (caught) {
      setUploadConfirmOpen(false)
      setError(caught instanceof Error ? caught.message : '立即同步失败。')
    } finally {
      setIsUploading(false)
    }
  }

  async function handleRestoreConfirmed() {
    if (!restoreTarget) {
      return
    }

    setIsRestoring(true)
    setError(null)
    setMessage(null)
    setRestoreResult(null)
    setWarnings([])
    try {
      const result = await restoreCloudBackup(restoreTarget.id)
      const exportedAt = Date.parse(result.exportedAt)
      markTripAutoSnapshotSynced(result.tripId, Number.isFinite(exportedAt) ? exportedAt : Date.now())
      setRestoreTarget(null)
      setWarnings(result.warnings)
      if (result.warnings.length > 0) {
        setRestoreResult(result)
        setMessage('账号数据已同步到此设备。请先检查下列提醒。')
      } else {
        setMessage('账号数据已同步到此设备。')
        setRestoreResult(null)
      }
      await refreshCloudBackups()
      navigateTo('trip', { tripId: result.tripId })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '同步账号数据到此设备失败。')
    } finally {
      setIsRestoring(false)
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) {
      return
    }

    setIsDeleting(true)
    setError(null)
    setMessage(null)
    setRestoreResult(null)
    setWarnings([])
    try {
      const result = await deleteCloudBackup(deleteTarget.id)
      setDeleteTarget(null)
      setMessage('云端同步记录已删除。此设备旅行不受影响。')
      setWarnings(result.warnings)
      await refreshCloudBackups()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除云端同步记录失败。')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <section className="space-y-3" data-testid="cloud-backup-section">
      <SectionHeader title="云端同步" />
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:text-sky-300">
            <Cloud className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-on-surface">Supabase 云端同步</h3>
            <p className="mt-1 text-sm leading-6 text-on-surface-variant">
              登录后，旅行数据和票据文件会进入自动同步队列，方便跨设备延续同一旅行。不同对象和不同字段会自动合并；同一字段冲突会先让你确认。
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <CloudInfoPill
            icon={<Upload className="size-4" />}
            text="立即同步会用此设备旅行更新账号数据，包含旅行数据和已保存票据文件。"
          />
          <CloudInfoPill
            icon={<ShieldAlert className="size-4" />}
            text="第一版未做端到端加密。护照、签证、银行卡等高度敏感文件请谨慎上传。"
            tone="warning"
          />
          <CloudInfoPill
            icon={<ShieldAlert className="size-4" />}
            text="真实同步/恢复前，请确认 Supabase RLS、Storage policy 和 Auth Redirect URL 已配置。"
          />
        </div>

        <AutoCloudBackupSetting
          configured={configStatus.configured}
          enabled={autoBackupEnabled}
          onToggle={handleAutoBackupToggle}
          signedIn={Boolean(user)}
        />
        <CloudAutoSyncStatusPanel
          configured={configStatus.configured}
          enabled={autoBackupEnabled}
          signedIn={Boolean(user)}
          tripId={trip?.id}
        />

        <CloudSnapshotCheckPrompts maxItems={5} variant="settings" />
        <ObjectSyncConflictPanel tripId={trip?.id} />

        {!configStatus.configured ? (
          <div
            className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-800 dark:text-amber-300"
            data-testid="supabase-unconfigured-message"
          >
            <p className="font-semibold">云端同步未配置</p>
            <p className="mt-1">
              请配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。未配置时，离线缓存和 zip 归档功能仍可正常使用。
            </p>
          </div>
        ) : isLoading ? (
          <div aria-busy="true" className="space-y-2" role="status">
            <p className="text-sm font-semibold text-on-surface-variant">正在读取云端同步状态...</p>
            <SkeletonLine />
            <SkeletonLine className="w-2/3" />
          </div>
        ) : user ? (
          <div className="space-y-3">
            <CloudStatusMessage error={error} message={message} warnings={warnings} />
            {restoreResult ? <CloudRestoreSuccessCard result={restoreResult} /> : null}
            <div
              className="rounded-xl bg-surface-container-low px-3 py-3 text-sm leading-6 text-on-surface-variant"
            >
              <p className="text-xs font-semibold text-outline">当前账号</p>
              <p className="break-words font-semibold text-on-surface [overflow-wrap:anywhere]">
                {user.email || user.id}
              </p>
            </div>
            {loginOnboarding ? <CloudLoginOnboardingNotice copy={loginOnboarding} /> : null}

            <div className="grid gap-2">
              <Button
                className="w-full"
                data-testid="cloud-upload-current-trip"
                disabled={!trip}
                icon={<Upload className="size-4" />}
                loading={isUploading}
                onClick={handleUploadRequest}
              >
                立即同步
              </Button>
              {!trip ? (
                <p className="rounded-xl bg-surface-container-low px-3 py-2 text-xs leading-5 text-on-surface-variant">
                  请先进入某个旅行，再立即同步。
                </p>
              ) : null}
              <Button
                className="w-full"
                icon={<LogOut className="size-4" />}
                loading={isSigningOut}
                onClick={() => void handleSignOut()}
                variant="secondary"
              >
                退出登录
              </Button>
            </div>

            <CloudBackupList
              backups={backups}
              onDelete={setDeleteTarget}
              onRestore={setRestoreTarget}
            />
          </div>
        ) : (
          <div className="space-y-3" data-testid="cloud-login-form">
            <CloudStatusMessage error={error} message={message} warnings={warnings} />
            <label className="block">
              <span className="text-sm font-semibold text-on-surface">邮箱</span>
              <input
                aria-label="Supabase 登录邮箱"
                className="mt-2 h-11 w-full min-w-0 rounded-xl border border-outline-variant/30 bg-white px-3 text-sm text-on-surface outline-none focus:border-sky-200"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
                value={email}
              />
            </label>
            <Button
              className="w-full"
              icon={<Mail className="size-4" />}
              loading={isSendingOtp}
              onClick={() => void handleSendOtp()}
            >
              发送登录链接/验证码
            </Button>
            <label className="block">
              <span className="text-sm font-semibold text-on-surface">验证码</span>
              <input
                aria-label="Supabase 登录验证码"
                className="mt-2 h-11 w-full min-w-0 rounded-xl border border-outline-variant/30 bg-white px-3 text-sm text-on-surface outline-none focus:border-sky-200"
                inputMode="numeric"
                onChange={(event) => setOtp(event.target.value)}
                placeholder="邮箱中的验证码"
                type="text"
                value={otp}
              />
            </label>
            <Button
              className="w-full"
              icon={<KeyRound className="size-4" />}
              loading={isVerifyingOtp}
              onClick={() => void handleVerifyOtp()}
              variant="secondary"
            >
              验证登录
            </Button>
          </div>
        )}
      </Card>

      <ConfirmDialog
        body={buildCloudBackupUploadConfirmBody()}
        confirmLabel="立即同步"
        icon={<Upload className="size-5" />}
        loading={isUploading}
        onCancel={() => {
          if (!isUploading) {
            setUploadConfirmOpen(false)
          }
        }}
        onConfirm={() => void handleUploadConfirmed()}
        open={uploadConfirmOpen}
        testId="cloud-save-confirm-dialog"
        title="立即同步当前旅行？"
      />
      <ConfirmDialog
        body={buildCloudBackupRestoreConfirmBody(restoreTarget)}
        confirmLabel="同步账号数据到此设备"
        icon={<Download className="size-5" />}
        loading={isRestoring}
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => void handleRestoreConfirmed()}
        open={Boolean(restoreTarget)}
        testId="cloud-save-confirm-dialog"
        title="同步账号数据到此设备？"
      />
      <ConfirmDialog
        body="删除这个云端同步记录不会删除此设备旅行，也不会影响其他云端记录。"
        confirmLabel="删除云端记录"
        icon={<Trash2 className="size-5" />}
        loading={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteConfirmed()}
        open={Boolean(deleteTarget)}
        title="删除云端同步记录？"
      />
    </section>
  )
}

function CloudRestoreSuccessCard({ result }: { result: RestoreCloudBackupResult }) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-900 dark:text-emerald-300"
    >
      <div>
        <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">已恢复：{result.title}</p>
        <p className="mt-1 text-xs leading-5 text-emerald-800 dark:text-emerald-300">
          账号数据已同步到此设备，不会创建重复旅行。
        </p>
      </div>
      <ul className="list-inside list-disc space-y-1 text-xs leading-5">
        {result.warnings.map((warning) => (
          <li className="break-words [overflow-wrap:anywhere]" key={warning}>
            {warning}
          </li>
        ))}
      </ul>
      <Button className="w-full" onClick={() => navigateTo('trip', { tripId: result.tripId })}>
        进入更新后的旅行
      </Button>
    </div>
  )
}

function CloudLoginOnboardingNotice({ copy }: { copy: CloudLoginOnboardingCopy }) {
  const toneClassName = copy.tone === 'success'
    ? 'border-emerald-100 bg-emerald-50 text-emerald-900 dark:text-emerald-300'
    : copy.tone === 'warning'
      ? 'border-amber-100 bg-amber-50 text-amber-900 dark:text-amber-200'
      : 'border-sky-100 bg-sky-50 text-sky-900 dark:text-sky-200'

  return (
    <div
      className={`rounded-2xl border px-3 py-3 text-sm leading-6 ${toneClassName}`}
    >
      <p className="font-semibold">{copy.title}</p>
      <p className="mt-1 break-words text-xs leading-5 [overflow-wrap:anywhere]">{copy.detail}</p>
    </div>
  )
}

function AutoCloudBackupSetting({
  configured,
  enabled,
  onToggle,
  signedIn,
}: {
  configured: boolean
  enabled: boolean
  onToggle: () => void
  signedIn: boolean
}) {
  const helperText = !configured
    ? '配置 Supabase 后才能开启。'
    : signedIn
      ? '打开 PWA 后自动检查账号数据；此设备关键修改会排队同步，并先做对象级增量合并。'
      : '登录账号后，会自动检查账号数据并排队同步此设备关键修改。'

  return (
    <div
      className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 px-3 py-3"
      data-testid="auto-cloud-backup-setting"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-on-surface">云端自动同步</p>
          <p className="mt-1 break-words text-xs leading-5 text-on-surface-variant [overflow-wrap:anywhere]">
            {helperText}
          </p>
        </div>
        <button
          aria-checked={enabled && configured}
          aria-label="云端自动同步"
          className={`relative mt-0.5 h-11 w-12 shrink-0 rounded-full transition ${
            enabled && configured ? 'bg-sky-500' : 'bg-surface-container-high'
          } disabled:cursor-not-allowed disabled:opacity-60`}
          data-testid="auto-cloud-backup-toggle"
          disabled={!configured}
          onClick={onToggle}
          role="switch"
          type="button"
        >
          <span
            className={`absolute top-3 size-5 rounded-full bg-white shadow-sm transition ${
              enabled && configured ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>
    </div>
  )
}

function CloudAutoSyncStatusPanel({
  configured,
  enabled,
  signedIn,
  tripId,
}: {
  configured: boolean
  enabled: boolean
  signedIn: boolean
  tripId?: string
}) {
  const [entries, setEntries] = useState<AutoSnapshotBackupEntry[]>(() => listAutoSnapshotBackupEntries())
  const [checkState, setCheckState] = useState(() => getCloudSnapshotCheckState())
  const [objectConflictCount, setObjectConflictCount] = useState(0)
  const [queueSummary, setQueueSummary] = useState<CloudSyncQueueSummary | null>(null)
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' || !('onLine' in navigator) ? true : navigator.onLine
  ))

  useEffect(() => {
    return subscribeAutoSnapshotBackup(() => {
      setEntries(listAutoSnapshotBackupEntries())
      void refreshQueueSummary(tripId, setQueueSummary)
    })
  }, [tripId])

  useEffect(() => subscribeCloudSnapshotChecks(setCheckState), [])

  useEffect(() => {
    let cancelled = false
    async function refreshObjectConflictCount() {
      try {
        const conflicts = await listPendingObjectSyncConflicts(tripId)
        if (!cancelled) {
          setObjectConflictCount(conflicts.length)
        }
      } catch {
        if (!cancelled) {
          setObjectConflictCount(0)
        }
      }
    }
    void refreshObjectConflictCount()
    const unsubscribe = subscribeTravelDataChanged(() => {
      void refreshObjectConflictCount()
      void refreshQueueSummary(tripId, setQueueSummary)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [tripId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshQueueSummary(tripId, setQueueSummary), 0)
    return () => window.clearTimeout(timeout)
  }, [tripId])

  useEffect(() => {
    const updateOnlineState = () => {
      setIsOnline(typeof navigator === 'undefined' || !('onLine' in navigator) ? true : navigator.onLine)
    }
    window.addEventListener('online', updateOnlineState)
    window.addEventListener('offline', updateOnlineState)
    return () => {
      window.removeEventListener('online', updateOnlineState)
      window.removeEventListener('offline', updateOnlineState)
    }
  }, [])

  const errorEntries = entries.filter((entry) => entry.status === 'error' && entry.dirtyAt)
  const uploadingCount = entries.filter((entry) => entry.status === 'uploading').length
  const queuedCount = entries.filter((entry) => entry.status === 'dirty' && entry.dirtyAt).length
  const retryableEntries = errorEntries
  const actionRequiredCount = checkState.results.length + objectConflictCount
  const view = getCloudAccountSyncStatusView({
    actionRequiredCount,
    configured,
    enabled,
    errorCount: errorEntries.length,
    checkError: checkState.error,
    isChecking: checkState.isChecking,
    isOnline,
    queuedCount,
    signedIn,
    syncingCount: uploadingCount,
  })

  function handleRetry() {
    for (const entry of retryableEntries) {
      requestTripAutoSnapshotRetry(entry.tripId)
    }
  }

  function handleShowSyncPrompts() {
    document.querySelector('[data-testid="cloud-snapshot-check-prompts"]')?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }

  return (
    <div
      className={`rounded-2xl border px-3 py-3 ${getCloudSyncStatusClassName(view.tone)}`}
      data-sync-status={view.status}
      data-testid="cloud-auto-sync-status"
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white/70 dark:bg-surface-container-highest/60">
          {getCloudSyncStatusIcon(view.status)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{view.title}</p>
          <p className="mt-1 break-words text-xs leading-5 [overflow-wrap:anywhere]">{view.detail}</p>
          <p className="mt-1 break-words text-xs leading-5 opacity-80 [overflow-wrap:anywhere]">
            对象级增量同步会先检查账号数据；不同字段自动合并，同一字段冲突需确认。
          </p>
        </div>
      </div>
      {view.status === 'conflict' ? (
        <Button
          className="mt-3 min-h-9 w-full text-xs"
          icon={<AlertTriangle className="size-4" />}
          onClick={handleShowSyncPrompts}
          variant="secondary"
        >
          处理冲突
        </Button>
      ) : null}
      {queueSummary ? <CloudSyncQueueSummaryPanel summary={queueSummary} /> : null}
      {retryableEntries.length > 0 && enabled && signedIn && isOnline ? (
        <Button
          className="mt-3 min-h-9 w-full text-xs"
          data-testid="cloud-auto-sync-retry"
          icon={<RefreshCw className="size-4" />}
          onClick={handleRetry}
          variant="secondary"
        >
          重试失败同步
        </Button>
      ) : null}
    </div>
  )
}

async function refreshQueueSummary(
  tripId: string | undefined,
  setQueueSummary: (summary: CloudSyncQueueSummary | null) => void,
) {
  try {
    setQueueSummary(await getCloudSyncQueueSummary(tripId))
  } catch {
    setQueueSummary(null)
  }
}

function CloudSyncQueueSummaryPanel({ summary }: { summary: CloudSyncQueueSummary }) {
  const ticketWorkCount = summary.ticketPendingCount +
    summary.ticketUploadingCount +
    summary.ticketErrorCount +
    summary.ticketDeletedCount
  const lastSyncText = summary.lastSuccessAt
    ? formatCloudDate(new Date(summary.lastSuccessAt).toISOString())
    : '尚无'
  const hasDetails = summary.syncItemCount > 0 || summary.tickets.length > 0 || summary.lastAttemptAt

  return (
    <div
      className="mt-3 space-y-2 rounded-xl bg-white/70 px-3 py-3 text-xs leading-5 dark:bg-surface-container-highest/50"
      data-testid="cloud-sync-queue-summary"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <QueueMetric
          label="同步队列"
          value={summary.syncItemCount > 0 ? `还有 ${summary.syncItemCount} 项` : '暂无等待'}
        />
        <QueueMetric label="上次同步" value={lastSyncText} />
        <QueueMetric
          label="票据文件"
          value={ticketWorkCount > 0 ? `${ticketWorkCount} 个处理中` : '无上传中'}
        />
      </div>
      {hasDetails ? (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-on-surface-variant marker:text-outline tm-focus">
            查看同步明细
          </summary>
          <div className="mt-2 space-y-2">
            <div className="grid gap-1 text-on-surface-variant">
              {summary.pendingObjectCount > 0 ? <p>{summary.pendingObjectCount} 个对象等待同步</p> : null}
              {summary.syncingObjectCount > 0 ? <p>{summary.syncingObjectCount} 个对象正在同步</p> : null}
              {summary.errorObjectCount > 0 ? <p>{summary.errorObjectCount} 个对象同步失败，等待重试</p> : null}
              {summary.conflictCount > 0 ? <p>{summary.conflictCount} 个对象需要处理冲突</p> : null}
              {summary.dirtyTripCount > 0 && summary.pendingObjectCount === 0 ? (
                <p>{summary.dirtyTripCount} 个旅行修改等待自动同步</p>
              ) : null}
              {summary.lastAttemptAt ? <p>上次尝试：{formatCloudDate(new Date(summary.lastAttemptAt).toISOString())}</p> : null}
            </div>
            {summary.tickets.length > 0 ? (
              <div className="space-y-1">
                <p className="font-semibold text-on-surface">票据文件</p>
                {summary.tickets.map((ticket) => (
                  <div
                    className="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-surface-container-low px-2 py-2"
                    key={ticket.ticketId}
                  >
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{ticket.title}</span>
                    <span className="shrink-0 text-on-surface-variant">{ticket.label}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function QueueMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-container-low px-2 py-2">
      <p className="text-[11px] font-semibold text-outline">{label}</p>
      <p className="mt-0.5 break-words font-semibold text-on-surface [overflow-wrap:anywhere]">{value}</p>
    </div>
  )
}

function CloudBackupList({
  backups,
  onDelete,
  onRestore,
}: {
  backups: CloudBackupSummary[]
  onDelete: (backup: CloudBackupSummary) => void
  onRestore: (backup: CloudBackupSummary) => void
}) {
  if (backups.length === 0) {
    return (
      <EmptyState
        body="当前旅行同步到账号后，这里会显示可用于更新此设备的账号数据。"
        icon={<Cloud className="size-6" />}
        title="还没有云端同步记录"
      />
    )
  }

  const groups = groupCloudBackupsForDisplay(backups)

  return (
    <div className="space-y-3" data-testid="cloud-backup-list">
      {groups.map((group) => (
        <section
          className="overflow-hidden rounded-2xl border border-outline-variant/30 bg-white/70 dark:bg-surface-container-highest/50"
          data-testid="cloud-backup-group"
          key={group.groupKey}
        >
          <div className="space-y-1 px-3 py-3">
            <p className="text-xs font-semibold text-outline">
              {group.isGrouped ? '历史备份（旧版本）' : '当前旅行'}
            </p>
            <h4 className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere] dark:text-on-surface">
              {group.title}
            </h4>
            <p className="break-words text-xs leading-5 text-on-surface-variant [overflow-wrap:anywhere]">
              {group.destination || '目的地未填写'} · {group.isGrouped ? `${group.backups.length} 条历史备份（旧版本）` : '当前旅行的云端同步'}
            </p>
            {group.isGrouped ? (
              <p className="break-words text-xs leading-5 text-amber-700 [overflow-wrap:anywhere] dark:text-amber-300">
                旧版本可能留下多条历史备份；这些记录仅为兼容保留，不会自动清理。
              </p>
            ) : null}
          </div>
          <div className="divide-y divide-slate-100">
            {group.backups.map((backup, index) => (
              <article className="space-y-3 px-3 py-3" data-testid="cloud-backup-card" key={backup.id}>
                <div className="grid gap-2 text-xs">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="shrink-0 font-semibold text-sky-600 dark:text-sky-300 dark:text-sky-300">云端同步</span>
                    <span className="min-w-0 text-right font-medium text-on-surface dark:text-on-surface">
                      {group.isGrouped ? `旧版备份 ${group.backups.length - index}` : '当前旅行的云端同步'}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="shrink-0 font-semibold text-outline dark:text-on-surface-variant">账号数据时间</span>
                    <span className="min-w-0 text-right text-on-surface-variant dark:text-outline-variant">
                      {formatCloudDate(backup.exportedAt || backup.createdAt)}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="shrink-0 font-semibold text-outline dark:text-on-surface-variant">附件数量</span>
                    <span className="min-w-0 text-right text-on-surface-variant dark:text-outline-variant">
                      {backup.filesCount} 个附件 · {formatFileSize(backup.totalSizeBytes)}
                    </span>
                  </div>
                </div>
                {backup.warnings.length > 0 ? (
                  <div
                    className="break-words rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-300 [overflow-wrap:anywhere]"
                    data-testid="cloud-backup-warning-list"
                  >
                    {backup.warnings[0]}
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    aria-label="用这份账号数据更新此设备旅行"
                    className="px-2 text-xs"
                    data-testid="cloud-restore-backup"
                    icon={<Download className="size-4" />}
                    onClick={() => onRestore(backup)}
                    variant="secondary"
                  >
                    同步到此设备
                  </Button>
                  <Button
                    className="px-2 text-xs text-red-600 dark:text-red-300"
                    data-testid="cloud-delete-backup"
                    icon={<Trash2 className="size-4" />}
                    onClick={() => onDelete(backup)}
                    variant="secondary"
                  >
                    删除云端记录
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function getCloudSyncStatusIcon(status: CloudAccountSyncStatus) {
  if (status === 'syncing') {
    return <LoaderCircle className="size-4 animate-spin" />
  }

  if (status === 'offline') {
    return <WifiOff className="size-4" />
  }

  if (status === 'conflict' || status === 'error') {
    return <AlertTriangle className="size-4" />
  }

  if (status === 'synced') {
    return <CheckCircle2 className="size-4" />
  }

  return <Cloud className="size-4" />
}

function getCloudSyncStatusClassName(tone: CloudAccountSyncTone) {
  if (tone === 'success') {
    return 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:text-emerald-300'
  }

  if (tone === 'info') {
    return 'border-sky-100 bg-sky-50 text-sky-700 dark:text-sky-300'
  }

  if (tone === 'warning') {
    return 'border-amber-100 bg-amber-50 text-amber-800 dark:text-amber-300'
  }

  if (tone === 'danger') {
    return 'border-red-100 bg-red-50 text-red-600 dark:text-red-300'
  }

  return 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant'
}

function CloudStatusMessage({
  error,
  message,
  warnings,
}: {
  error: string | null
  message: string | null
  warnings: string[]
}) {
  return (
    <div className="space-y-2">
      {error ? (
        <CloudNotice
          icon={<AlertTriangle className="size-4" />}
          text={error}
          tone="error"
        />
      ) : null}
      {message ? (
        <CloudNotice
          icon={<CheckCircle2 className="size-4" />}
          text={message}
          tone="success"
        />
      ) : null}
      {warnings.map((warning) => (
        <CloudNotice
          icon={<AlertTriangle className="size-4" />}
          key={warning}
          text={warning}
          tone="warning"
        />
      ))}
    </div>
  )
}

function CloudInfoPill({
  icon,
  text,
  tone = 'neutral',
}: {
  icon: ReactNode
  text: string
  tone?: 'neutral' | 'warning'
}) {
  const styles = tone === 'warning' ? 'bg-amber-50 text-amber-800 dark:text-amber-300' : 'bg-surface-container-low text-on-surface-variant'
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm leading-6 ${styles}`}>
      <span className="mt-1 shrink-0">{icon}</span>
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{text}</span>
    </div>
  )
}

function persistCloudPanelMessage(tripId: string, text: string) {
  try {
    window.localStorage.setItem(CLOUD_PANEL_STATUS_MESSAGE_KEY, JSON.stringify({
      createdAt: Date.now(),
      text,
      tripId,
    }))
  } catch {
    // The in-panel React state still shows the message when storage is unavailable.
  }
}

function readPersistedCloudPanelMessage(tripId: string | undefined) {
  if (!tripId) return null
  try {
    const raw = window.localStorage.getItem(CLOUD_PANEL_STATUS_MESSAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { createdAt?: unknown; text?: unknown; tripId?: unknown }
    if (
      parsed.tripId !== tripId ||
      typeof parsed.text !== 'string' ||
      typeof parsed.createdAt !== 'number' ||
      Date.now() - parsed.createdAt > CLOUD_PANEL_STATUS_MESSAGE_TTL_MS
    ) {
      return null
    }
    return parsed.text
  } catch {
    return null
  }
}

function CloudNotice({
  icon,
  text,
  tone,
}: {
  icon: ReactNode
  text: string
  tone: 'error' | 'success' | 'warning'
}) {
  const styles = {
    error: 'border-red-100 bg-red-50 text-red-600 dark:text-red-300',
    success: 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:text-emerald-300',
    warning: 'border-amber-100 bg-amber-50 text-amber-800 dark:text-amber-300',
  }[tone]

  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm leading-6 ${styles}`}>
      <span className="mt-1 shrink-0">{icon}</span>
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{text}</span>
    </div>
  )
}

function buildCloudBackupUploadConfirmBody() {
  return [
    '将用此设备版本立即同步到账号。',
    '账号中原有版本会被覆盖。',
    '不会创建新的云端记录列表。',
    '当前方向操作不会自动合并账号中的未选修改。',
    '对象同步仍会先做增量合并；这里处理的是整旅行方向选择。',
  ].join('\n')
}

function buildCloudBackupRestoreConfirmBody(backup: CloudBackupSummary | null) {
  const cloudTime = backup ? formatCloudDate(backup.exportedAt || backup.createdAt) : null
  const versionLine = cloudTime ? `\n\n账号数据时间：${cloudTime}` : ''

  return [
    '将用账号数据更新此设备旅行。',
    '此设备未同步的修改可能被覆盖。',
    '不会创建重复旅行。',
    '当前方向操作不会自动合并此设备中的未选修改。',
    '对象同步仍会先做增量合并；这里处理的是整旅行方向选择。',
    '建议确认方向后再继续。',
  ].join('\n') + versionLine
}

function formatCloudDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '时间未知'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
