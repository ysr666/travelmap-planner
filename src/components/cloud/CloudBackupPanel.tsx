import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Download,
  KeyRound,
  LogOut,
  Mail,
  ShieldAlert,
  Trash2,
  Upload,
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
  completeTripAutoSnapshotSuccess,
  getTripAutoSnapshotStatus,
  isAutoSnapshotBackupEnabled,
  setAutoSnapshotBackupEnabled,
  subscribeAutoSnapshotBackup,
} from '../../lib/autoSnapshotBackup'
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
      setError(caught instanceof Error ? caught.message : '读取云端备份状态失败。')
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
    setMessage(nextValue ? '自动云端备份已开启。' : '自动云端备份已关闭。')
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
      setMessage('已登录云端备份。')
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
      setMessage('已退出云端备份账号。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '退出登录失败。')
    } finally {
      setIsSigningOut(false)
    }
  }

  async function handleUpload() {
    if (!trip) {
      setError('请先进入某个旅行，再上传云端备份。')
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
      if (autoBackupStatus?.dirtyAt) {
        completeTripAutoSnapshotSuccess(trip.id, autoBackupStatus.dirtyAt)
      }
      setMessage('当前旅行已上传到云端备份。')
      setWarnings(result.warnings)
      await refreshCloudBackups()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '上传云端备份失败。')
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
      setRestoreTarget(null)
      if (result.warnings.length > 0) {
        setRestoreResult(result)
        setMessage('云端备份已恢复为新的本地旅行。请先检查下列提醒。')
      } else {
        navigateTo('trip', { tripId: result.tripId })
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '恢复云端备份失败。')
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
      setMessage('云端备份已删除。本地旅行不受影响。')
      setWarnings(result.warnings)
      await refreshCloudBackups()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除云端备份失败。')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <section className="space-y-3" data-testid="cloud-backup-section">
      <SectionHeader title="云端备份" />
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <Cloud className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-950">Supabase 云端快照</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              云端备份适合跨设备恢复。IndexedDB 仍是主数据源，不会实时同步，也不会自动合并多设备修改。
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <CloudInfoPill
            icon={<Upload className="size-4" />}
            text="云端备份会上传旅行数据和 copy 票据附件到 Supabase。"
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

        <CloudSnapshotCheckPrompts maxItems={5} variant="settings" />

        {!configStatus.configured ? (
          <div
            className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-800"
            data-testid="supabase-unconfigured-message"
          >
            <p className="font-semibold">云端备份未配置</p>
            <p className="mt-1">
              请配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。未配置时，本地 zip 备份和 IndexedDB
              功能仍可正常使用。
            </p>
          </div>
        ) : isLoading ? (
          <div aria-busy="true" className="space-y-2" data-testid="cloud-loading-state" role="status">
            <p className="text-sm font-semibold text-slate-500">正在读取云端备份状态...</p>
            <SkeletonLine />
            <SkeletonLine className="w-2/3" />
          </div>
        ) : user ? (
          <div className="space-y-3">
            <CloudStatusMessage error={error} message={message} warnings={warnings} />
            {restoreResult ? <CloudRestoreSuccessCard result={restoreResult} /> : null}
            <div
              className="rounded-xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-600"
              data-testid="cloud-current-user"
            >
              <p className="text-xs font-semibold text-slate-400">当前账号</p>
              <p className="break-words font-semibold text-slate-900 [overflow-wrap:anywhere]">
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
                onClick={() => void handleUpload()}
              >
                上传当前旅行到云端
              </Button>
              {!trip ? (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                  请先进入某个旅行，再上传云端备份。
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
              <span className="text-sm font-semibold text-slate-700">邮箱</span>
              <input
                aria-label="Supabase 登录邮箱"
                className="mt-2 h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-200"
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
              <span className="text-sm font-semibold text-slate-700">验证码</span>
              <input
                aria-label="Supabase 登录验证码"
                className="mt-2 h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-200"
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
        body="恢复会创建一个新的本地旅行，不会覆盖当前本地数据。"
        confirmLabel="确认恢复"
        icon={<Download className="size-5" />}
        loading={isRestoring}
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => void handleRestoreConfirmed()}
        open={Boolean(restoreTarget)}
        title="恢复云端备份？"
      />
      <ConfirmDialog
        body="删除云端备份不会删除本地旅行。"
        confirmLabel="确认删除"
        icon={<Trash2 className="size-5" />}
        loading={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteConfirmed()}
        open={Boolean(deleteTarget)}
        title="删除云端备份？"
      />
    </section>
  )
}

function CloudRestoreSuccessCard({ result }: { result: RestoreCloudBackupResult }) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-900"
      data-testid="cloud-restore-success"
    >
      <div>
        <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">已恢复：{result.title}</p>
        <p className="mt-1 text-xs leading-5 text-emerald-800">
          恢复已创建新的本地旅行，不会覆盖现有数据。以下提醒建议进入后核对。
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
        进入恢复的旅行工作台
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
      ? '开启后，本机数据变化会延迟上传旅行云端快照。不会自动恢复或合并冲突。'
      : '可以先保存设置；登录云端备份账号后才会开始自动上传。'

  return (
    <div
      className="rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-3"
      data-testid="auto-cloud-backup-setting"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-950">自动云端备份</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
            {helperText}
          </p>
        </div>
        <button
          aria-checked={enabled && configured}
          aria-label="自动云端备份"
          className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition ${
            enabled && configured ? 'bg-sky-500' : 'bg-slate-200'
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
        body="上传当前旅行后，这里会显示可恢复的云端快照。"
        icon={<Cloud className="size-6" />}
        title="还没有云端备份"
      />
    )
  }

  return (
    <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100" data-testid="cloud-backup-list">
      {backups.map((backup) => (
        <article className="space-y-3 px-3 py-3" data-testid="cloud-backup-card" key={backup.id}>
          <div className="min-w-0">
            <h4 className="break-words text-sm font-semibold text-slate-950 [overflow-wrap:anywhere]">
              {backup.title}
            </h4>
            <p className="mt-1 break-words text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
              {backup.destination || '目的地未填写'} · {formatCloudDate(backup.exportedAt)}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              {backup.filesCount} 个文件 · {formatCloudBackupSize(backup.totalSizeBytes)}
            </p>
          </div>
          {backup.warnings.length > 0 ? (
            <div
              className="break-words rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 [overflow-wrap:anywhere]"
              data-testid="cloud-backup-warning-list"
            >
              {backup.warnings[0]}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button
              aria-label="恢复这个云端备份为新的本地旅行"
              className="px-3"
              data-testid="cloud-restore-backup"
              icon={<Download className="size-4" />}
              onClick={() => onRestore(backup)}
              variant="secondary"
            >
              恢复
            </Button>
            <Button
              className="px-3 text-red-600"
              data-testid="cloud-delete-backup"
              icon={<Trash2 className="size-4" />}
              onClick={() => onDelete(backup)}
              variant="secondary"
            >
              删除
            </Button>
          </div>
        </article>
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
  const styles = tone === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600'
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
    error: 'border-red-100 bg-red-50 text-red-600',
    success: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-100 bg-amber-50 text-amber-800',
  }[tone]

  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm leading-6 ${styles}`}>
      <span className="mt-1 shrink-0">{icon}</span>
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{text}</span>
    </div>
  )
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
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
