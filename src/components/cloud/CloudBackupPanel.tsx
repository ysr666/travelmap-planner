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
import { CloudSnapshotCheckPrompts } from './CloudSnapshotCheckPrompts'
import {
  deleteCloudBackup,
  formatCloudBackupSize,
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
import { navigateTo } from '../../lib/routes'
import type { Trip } from '../../types'

type CloudBackupPanelProps = {
  trip: Trip | null
}

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
  const [message, setMessage] = useState<string | null>(null)
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
      setError(caught instanceof Error ? caught.message : '读取云端保存状态失败。')
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
    try {
      await verifyEmailOtp(trimmedEmail, token)
      setOtp('')
      setMessage('已登录云端保存账号。')
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
      setMessage('已退出云端保存账号。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '退出登录失败。')
    } finally {
      setIsSigningOut(false)
    }
  }

  function handleUploadRequest() {
    if (!trip) {
      setError('请先进入某个旅行，再上传本地数据。')
      return
    }

    setUploadConfirmOpen(true)
  }

  async function handleUploadConfirmed() {
    if (!trip) {
      setError('请先进入某个旅行，再上传本地数据。')
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
      setMessage('本地版本已上传，云端保存已覆盖更新。')
      setUploadConfirmOpen(false)
      setWarnings(result.warnings)
      await refreshCloudBackups()
    } catch (caught) {
      setUploadConfirmOpen(false)
      setError(caught instanceof Error ? caught.message : '覆盖云端保存失败。')
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
        setMessage('云端版本已覆盖当前本地旅行。请先检查下列提醒。')
      } else {
        setMessage('云端版本已覆盖当前本地旅行。')
        setRestoreResult(null)
      }
      await refreshCloudBackups()
      navigateTo('trip', { tripId: result.tripId })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '使用云端版本覆盖本地失败。')
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
      setMessage('云端保存已删除。本地旅行不受影响。')
      setWarnings(result.warnings)
      await refreshCloudBackups()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除云端保存失败。')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <section className="space-y-3" data-testid="cloud-backup-section">
      <SectionHeader title="云端保存" />
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:text-sky-300">
            <Cloud className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-on-surface">Supabase 云端保存</h3>
            <p className="mt-1 text-sm leading-6 text-on-surface-variant">
              云端保存适合跨设备延续同一旅行。IndexedDB 仍是主数据源；自动同步会按最新版本覆盖另一端，不做字段级合并。
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <CloudInfoPill
            icon={<Upload className="size-4" />}
            text="上传本地数据会覆盖当前旅行的云端保存，包含旅行数据和 copy 票据附件。"
          />
          <CloudInfoPill
            icon={<ShieldAlert className="size-4" />}
            text="第一版未做端到端加密。护照、签证、银行卡等高度敏感文件请谨慎上传。"
            tone="warning"
          />
          <CloudInfoPill
            icon={<ShieldAlert className="size-4" />}
            text="真实上传/恢复前，请确认 Supabase RLS、Storage policy 和 Auth Redirect URL 已配置。"
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
        />

        <CloudSnapshotCheckPrompts maxItems={5} variant="settings" />

        {!configStatus.configured ? (
          <div
            className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-800 dark:text-amber-300"
            data-testid="supabase-unconfigured-message"
          >
            <p className="font-semibold">云端保存未配置</p>
            <p className="mt-1">
              请配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。未配置时，本地 zip 备份和 IndexedDB
              功能仍可正常使用。
            </p>
          </div>
        ) : isLoading ? (
          <div aria-busy="true" className="space-y-2" data-testid="cloud-loading-state" role="status">
            <p className="text-sm font-semibold text-on-surface-variant">正在读取云端保存状态...</p>
            <SkeletonLine />
            <SkeletonLine className="w-2/3" />
          </div>
        ) : user ? (
          <div className="space-y-3">
            <CloudStatusMessage error={error} message={message} warnings={warnings} />
            {restoreResult ? <CloudRestoreSuccessCard result={restoreResult} /> : null}
            <div
              className="rounded-xl bg-surface-container-low px-3 py-3 text-sm leading-6 text-on-surface-variant"
              data-testid="cloud-current-user"
            >
              <p className="text-xs font-semibold text-outline">当前账号</p>
              <p className="break-words font-semibold text-on-surface [overflow-wrap:anywhere]">
                {user.email || user.id}
              </p>
            </div>

            <div className="grid gap-2">
              <Button
                className="w-full"
                data-testid="cloud-upload-current-trip"
                disabled={!trip}
                icon={<Upload className="size-4" />}
                loading={isUploading}
                onClick={handleUploadRequest}
              >
                更新云端保存
              </Button>
              {!trip ? (
                <p className="rounded-xl bg-surface-container-low px-3 py-2 text-xs leading-5 text-on-surface-variant">
                  请先进入某个旅行，再上传本地数据。
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
                data-testid="cloud-email-input"
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
                data-testid="cloud-otp-input"
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
        confirmLabel="更新云端保存"
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
        title="更新当前旅行的云端保存？"
      />
      <ConfirmDialog
        body={buildCloudBackupRestoreConfirmBody(restoreTarget)}
        confirmLabel="用云端覆盖本地"
        icon={<Download className="size-5" />}
        loading={isRestoring}
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => void handleRestoreConfirmed()}
        open={Boolean(restoreTarget)}
        testId="cloud-save-confirm-dialog"
        title="用云端覆盖本地？"
      />
      <ConfirmDialog
        body="删除这个云端保存不会删除本地旅行，也不会影响其他云端保存。"
        confirmLabel="删除云端保存"
        icon={<Trash2 className="size-5" />}
        loading={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteConfirmed()}
        open={Boolean(deleteTarget)}
        title="删除云端保存？"
      />
    </section>
  )
}

function CloudRestoreSuccessCard({ result }: { result: RestoreCloudBackupResult }) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-900 dark:text-emerald-300"
      data-testid="cloud-restore-success"
    >
      <div>
        <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">已恢复：{result.title}</p>
        <p className="mt-1 text-xs leading-5 text-emerald-800 dark:text-emerald-300">
          云端版本已覆盖当前本地旅行，不会创建新的旅行副本。
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
      ? '打开 PWA 后自动拉取云端状态；本机关键修改会排队上传，版本较新的一端会自动覆盖另一端。'
      : '登录云端保存账号后，会自动拉取云端状态并排队上传本机关键修改。'

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
          className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition ${
            enabled && configured ? 'bg-sky-500' : 'bg-surface-container-high'
          } disabled:cursor-not-allowed disabled:opacity-60`}
          data-testid="auto-cloud-backup-toggle"
          disabled={!configured}
          onClick={onToggle}
          role="switch"
          type="button"
        >
          <span
            className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition ${
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
}: {
  configured: boolean
  enabled: boolean
  signedIn: boolean
}) {
  const [entries, setEntries] = useState<AutoSnapshotBackupEntry[]>(() => listAutoSnapshotBackupEntries())
  const [checkState, setCheckState] = useState(() => getCloudSnapshotCheckState())
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' || !('onLine' in navigator) ? true : navigator.onLine
  ))

  useEffect(() => {
    return subscribeAutoSnapshotBackup(() => {
      setEntries(listAutoSnapshotBackupEntries())
    })
  }, [])

  useEffect(() => subscribeCloudSnapshotChecks(setCheckState), [])

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

  if (!configured) {
    return null
  }

  const errorEntries = entries.filter((entry) => entry.status === 'error' && entry.dirtyAt)
  const uploadingCount = entries.filter((entry) => entry.status === 'uploading').length
  const queuedCount = entries.filter((entry) => entry.status === 'dirty' && entry.dirtyAt).length
  const retryableEntries = errorEntries
  const view = getCloudAutoSyncStatusView({
    enabled,
    errorCount: errorEntries.length,
    checkError: checkState.error,
    isChecking: checkState.isChecking,
    isOnline,
    queuedCount,
    signedIn,
    uploadingCount,
  })

  function handleRetry() {
    for (const entry of retryableEntries) {
      requestTripAutoSnapshotRetry(entry.tripId)
    }
  }

  return (
    <div
      className={`rounded-2xl border px-3 py-3 ${view.className}`}
      data-testid="cloud-auto-sync-status"
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white/70 dark:bg-surface-container-highest/60">
          {view.icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{view.title}</p>
          <p className="mt-1 break-words text-xs leading-5 [overflow-wrap:anywhere]">{view.detail}</p>
          <p className="mt-1 break-words text-xs leading-5 opacity-80 [overflow-wrap:anywhere]">
            按最新版本自动覆盖，不做字段级合并，也不创建额外云端快照。
          </p>
        </div>
      </div>
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

function getCloudAutoSyncStatusView({
  enabled,
  errorCount,
  checkError,
  isChecking,
  isOnline,
  queuedCount,
  signedIn,
  uploadingCount,
}: {
  enabled: boolean
  errorCount: number
  checkError: string | null
  isChecking: boolean
  isOnline: boolean
  queuedCount: number
  signedIn: boolean
  uploadingCount: number
}) {
  if (!enabled) {
    return {
      className: 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant',
      detail: '开启后，登录状态下会自动拉取云端状态并按最新版本同步。',
      icon: <Cloud className="size-4" />,
      title: '云端自动同步已关闭',
    }
  }

  if (!signedIn) {
    return {
      className: 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant',
      detail: '登录云端保存账号后，会自动检查云端版本并处理待同步修改。',
      icon: <Cloud className="size-4" />,
      title: '等待登录后同步',
    }
  }

  if (!isOnline) {
    return {
      className: 'border-amber-100 bg-amber-50 text-amber-800 dark:text-amber-300',
      detail: '本地修改会留在队列中，网络恢复后自动重试。',
      icon: <WifiOff className="size-4" />,
      title: '当前离线，同步已暂停',
    }
  }

  if (checkError) {
    return {
      className: 'border-red-100 bg-red-50 text-red-600 dark:text-red-300',
      detail: checkError,
      icon: <AlertTriangle className="size-4" />,
      title: '同步检查失败',
    }
  }

  if (errorCount > 0) {
    return {
      className: 'border-red-100 bg-red-50 text-red-600 dark:text-red-300',
      detail: `${errorCount} 个旅行同步失败，可稍后重试。`,
      icon: <AlertTriangle className="size-4" />,
      title: '同步失败',
    }
  }

  if (uploadingCount > 0 || isChecking) {
    return {
      className: 'border-sky-100 bg-sky-50 text-sky-700 dark:text-sky-300',
      detail: uploadingCount > 0 ? `正在同步 ${uploadingCount} 个旅行。` : '正在检查云端状态。',
      icon: <LoaderCircle className="size-4 animate-spin" />,
      title: '正在云端同步',
    }
  }

  if (queuedCount > 0) {
    return {
      className: 'border-sky-100 bg-sky-50 text-sky-700 dark:text-sky-300',
      detail: `${queuedCount} 个本机修改等待上传，会在后台自动处理。`,
      icon: <Cloud className="size-4" />,
      title: '同步已排队',
    }
  }

  return {
    className: 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:text-emerald-300',
    detail: '打开 PWA 会检查云端版本，本机关键修改会自动进入同步队列。',
    icon: <CheckCircle2 className="size-4" />,
    title: '云端自动同步已就绪',
  }
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
        body="更新当前旅行的云端保存后，这里会显示可用于覆盖本地的云端版本。"
        icon={<Cloud className="size-6" />}
        title="还没有云端保存"
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
              {group.destination || '目的地未填写'} · {group.isGrouped ? `${group.backups.length} 条历史备份` : '当前旅行的云端保存'}
            </p>
            {group.isGrouped ? (
              <p className="break-words text-xs leading-5 text-amber-700 [overflow-wrap:anywhere] dark:text-amber-300">
                旧版本可能留下多条云端保存；这些记录仅为兼容保留，不会自动清理。
              </p>
            ) : null}
          </div>
          <div className="divide-y divide-slate-100">
            {group.backups.map((backup, index) => (
              <article className="space-y-3 px-3 py-3" data-testid="cloud-backup-card" key={backup.id}>
                <div className="grid gap-2 text-xs">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="shrink-0 font-semibold text-sky-600 dark:text-sky-300 dark:text-sky-300">云端保存</span>
                    <span className="min-w-0 text-right font-medium text-on-surface dark:text-on-surface">
                      {group.isGrouped ? `旧版备份 ${group.backups.length - index}` : '当前旅行的云端保存'}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="shrink-0 font-semibold text-outline dark:text-on-surface-variant">云端版本时间</span>
                    <span className="min-w-0 text-right text-on-surface-variant dark:text-outline-variant">
                      {formatCloudDate(backup.exportedAt || backup.createdAt)}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <span className="shrink-0 font-semibold text-outline dark:text-on-surface-variant">附件数量</span>
                    <span className="min-w-0 text-right text-on-surface-variant dark:text-outline-variant">
                      {backup.filesCount} 个附件 · {formatCloudBackupSize(backup.totalSizeBytes)}
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
                    aria-label="用这个云端保存覆盖本地旅行"
                    className="px-2 text-xs"
                    data-testid="cloud-restore-backup"
                    icon={<Download className="size-4" />}
                    onClick={() => onRestore(backup)}
                    variant="secondary"
                  >
                    用云端覆盖本地
                  </Button>
                  <Button
                    className="px-2 text-xs text-red-600 dark:text-red-300"
                    data-testid="cloud-delete-backup"
                    icon={<Trash2 className="size-4" />}
                    onClick={() => onDelete(backup)}
                    variant="secondary"
                  >
                    删除云端保存
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

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-surface-container ${className}`} />
}

function buildCloudBackupUploadConfirmBody() {
  return [
    '将用当前本地版本更新云端保存。',
    '云端原有版本会被覆盖。',
    '不会创建新的云端快照列表。',
    '不会自动合并云端修改。',
  ].join('\n')
}

function buildCloudBackupRestoreConfirmBody(backup: CloudBackupSummary | null) {
  const cloudTime = backup ? formatCloudDate(backup.exportedAt || backup.createdAt) : null
  const versionLine = cloudTime ? `\n\n云端版本时间：${cloudTime}` : ''

  return [
    '将用云端版本覆盖当前本地旅行。',
    '当前未上传的本地修改可能被覆盖。',
    '不会创建新的本地旅行副本。',
    '这是按方向覆盖，不会自动合并本地和云端修改。',
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
