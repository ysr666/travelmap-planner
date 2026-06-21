import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Cloud, Database, KeyRound, Mail, MapPinned, ShieldCheck } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import {
  getCurrentSession,
  getCurrentUser,
  listCloudBackups,
  restoreCloudBackup,
  signInWithEmailOtp,
  verifyEmailOtp,
} from '../../lib/cloudBackup'
import { getSupabaseClient, getSupabaseConfigStatus } from '../../lib/supabaseClient'
import {
  activateAccountDatabase,
  deactivateAccountDatabase,
  hasCompletedLegacyDatabaseDecision,
  markLegacyDatabaseDecision,
  migrateLegacyDatabaseToAccount,
  summarizeAccountDatabase,
  summarizeLegacyDatabase,
  activateLegacyDatabaseForTests,
} from '../../lib/accountDatabase'
import {
  createE2eAuthUser,
  hasValidOfflineAccessLease,
  isE2eAuthBypassEnabled,
  renewOfflineAccessLease,
} from '../../lib/appAuth'

type GateState =
  | { kind: 'booting' }
  | { kind: 'signed_out'; error?: string; message?: string }
  | { kind: 'migration'; user: User; localTrips: number; localMaterials: number; cloudTrips: number }
  | { kind: 'migrating'; label: string }
  | { kind: 'ready'; user: User; offline: boolean }
  | { kind: 'error'; message: string }

export function AppAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'booting' })
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)

  const prepareUser = useCallback(async (user: User, offline: boolean) => {
    const [decisionMade, accountSummary, legacySummary] = await Promise.all([
      hasCompletedLegacyDatabaseDecision(user.id),
      summarizeAccountDatabase(user.id),
      summarizeLegacyDatabase(),
    ])
    if (decisionMade || accountSummary.tripCount > 0 || legacySummary.tripCount === 0) {
      await activateAccountDatabase(user.id)
      if (!decisionMade && legacySummary.tripCount === 0) {
        await markLegacyDatabaseDecision(user.id, 'not_needed')
      }
      setState({ kind: 'ready', offline, user })
      return
    }

    const backups = offline ? [] : await listCloudBackups().catch(() => [])
    setState({
      cloudTrips: new Set(backups.map((backup) => backup.originalTripId || backup.id)).size,
      kind: 'migration',
      localMaterials: legacySummary.materialCount,
      localTrips: legacySummary.tripCount,
      user,
    })
  }, [])

  const initialize = useCallback(async () => {
    if (isE2eAuthBypassEnabled()) {
      activateLegacyDatabaseForTests()
      setState({ kind: 'ready', offline: false, user: createE2eAuthUser() })
      return
    }

    if (!getSupabaseConfigStatus().configured) {
      setState({ kind: 'error', message: '账号服务尚未配置，暂时无法进入旅图。' })
      return
    }

    try {
      const session = await getCurrentSession()
      if (!session?.user) {
        setState({ kind: 'signed_out' })
        return
      }

      try {
        const verifiedUser = await getCurrentUser()
        if (!verifiedUser) {
          setState({ kind: 'signed_out' })
          return
        }
        renewOfflineAccessLease(verifiedUser.id)
        await prepareUser(verifiedUser, false)
      } catch {
        if (!hasValidOfflineAccessLease(session.user.id)) {
          setState({ kind: 'signed_out', error: '登录状态需要联网验证，请连接网络后重试。' })
          return
        }
        await prepareUser(session.user, true)
      }
    } catch (caught) {
      setState({ kind: 'error', message: caught instanceof Error ? caught.message : '读取账号状态失败。' })
    }
  }, [prepareUser])

  useEffect(() => {
    const timeout = window.setTimeout(() => void initialize(), 0)
    const client = getSupabaseClient()
    if (!client || isE2eAuthBypassEnabled()) return () => window.clearTimeout(timeout)
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        deactivateAccountDatabase()
        setState({ kind: 'signed_out' })
        return
      }
      window.setTimeout(() => void initialize(), 0)
    })
    return () => {
      window.clearTimeout(timeout)
      data.subscription.unsubscribe()
    }
  }, [initialize])

  async function sendOtp() {
    const nextEmail = email.trim()
    if (!nextEmail) {
      setState({ kind: 'signed_out', error: '请输入邮箱。' })
      return
    }
    setBusy(true)
    try {
      await signInWithEmailOtp(nextEmail)
      setState({ kind: 'signed_out', message: '验证码已发送，请检查邮箱。' })
    } catch (caught) {
      setState({ kind: 'signed_out', error: caught instanceof Error ? caught.message : '发送验证码失败。' })
    } finally {
      setBusy(false)
    }
  }

  async function verifyOtp() {
    if (!email.trim() || !otp.trim()) {
      setState({ kind: 'signed_out', error: '请输入邮箱和验证码。' })
      return
    }
    setBusy(true)
    try {
      await verifyEmailOtp(email.trim(), otp.trim())
      setOtp('')
      await initialize()
    } catch (caught) {
      setState({ kind: 'signed_out', error: caught instanceof Error ? caught.message : '验证码验证失败。' })
    } finally {
      setBusy(false)
    }
  }

  async function takeOverLocalData(user: User) {
    setState({ kind: 'migrating', label: '正在把本机数据接入当前账号...' })
    try {
      await migrateLegacyDatabaseToAccount(user.id)
      setState({ kind: 'ready', offline: false, user })
    } catch (caught) {
      setState({ kind: 'error', message: caught instanceof Error ? caught.message : '接管本机数据失败。旧数据未被删除。' })
    }
  }

  async function restoreCloudOnly(user: User) {
    setState({ kind: 'migrating', label: '正在恢复当前账号的云端数据...' })
    try {
      await activateAccountDatabase(user.id)
      const backups = await listCloudBackups()
      for (const backup of backups) await restoreCloudBackup(backup.id)
      await markLegacyDatabaseDecision(user.id, 'cloud_only')
      setState({ kind: 'ready', offline: false, user })
    } catch (caught) {
      setState({ kind: 'error', message: caught instanceof Error ? caught.message : '恢复云端数据失败。旧本机数据未被删除。' })
    }
  }

  if (state.kind === 'ready') return <>{children}</>
  if (state.kind === 'migration') {
    return (
      <AuthSurface>
        <Card className="space-y-4" data-testid="account-data-migration">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 size-6 shrink-0 text-primary" />
            <div>
              <h1 className="text-xl font-bold text-on-surface">选择这个账号的数据来源</h1>
              <p className="mt-1 text-sm leading-6 text-on-surface-variant">旧本机数据不会自动归到任何账号，也不会被删除。</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DataCount label="本机旅行" value={state.localTrips} />
            <DataCount label="云端旅行" value={state.cloudTrips} />
          </div>
          <p className="text-xs leading-5 text-on-surface-variant">本机另有 {state.localMaterials} 条日程、票据、账本或资料记录。</p>
          <Button className="w-full" onClick={() => void takeOverLocalData(state.user)}>接管本机数据</Button>
          <Button className="w-full" onClick={() => void restoreCloudOnly(state.user)} variant="secondary">仅恢复云端</Button>
        </Card>
      </AuthSurface>
    )
  }
  if (state.kind === 'migrating' || state.kind === 'booting') {
    return <AuthStatus label={state.kind === 'migrating' ? state.label : '正在准备你的旅行数据...'} />
  }
  if (state.kind === 'error') {
    return (
      <AuthSurface>
        <Card className="space-y-4 text-center">
          <ShieldCheck className="mx-auto size-8 text-primary" />
          <h1 className="text-xl font-bold text-on-surface">暂时无法进入旅图</h1>
          <p className="text-sm leading-6 text-on-surface-variant">{state.message}</p>
          <Button className="w-full" onClick={() => void initialize()} variant="secondary">重试</Button>
        </Card>
      </AuthSurface>
    )
  }

  return (
    <AuthSurface>
      <div className="space-y-6">
        <div className="text-center">
          <MapPinned className="mx-auto size-10 text-primary" />
          <h1 className="mt-3 text-2xl font-bold text-on-surface">登录旅图</h1>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">旅行数据跟随账号同步。验证一次后，本设备可离线使用 30 天。</p>
        </div>
        <Card className="space-y-4" data-testid="app-auth-login">
          {state.error ? <AuthMessage tone="error">{state.error}</AuthMessage> : null}
          {state.message ? <AuthMessage>{state.message}</AuthMessage> : null}
          <label className="block">
            <span className="text-sm font-semibold text-on-surface">邮箱</span>
            <input aria-label="登录邮箱" className="mt-2 h-12 w-full rounded-xl border border-outline-variant/40 bg-surface px-3 text-on-surface outline-none focus:border-primary" inputMode="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </label>
          <Button className="w-full" icon={<Mail className="size-4" />} loading={busy} onClick={() => void sendOtp()}>发送验证码</Button>
          <label className="block">
            <span className="text-sm font-semibold text-on-surface">验证码</span>
            <input aria-label="登录验证码" className="mt-2 h-12 w-full rounded-xl border border-outline-variant/40 bg-surface px-3 text-on-surface outline-none focus:border-primary" inputMode="numeric" onChange={(event) => setOtp(event.target.value)} type="text" value={otp} />
          </label>
          <Button className="w-full" icon={<KeyRound className="size-4" />} loading={busy} onClick={() => void verifyOtp()} variant="secondary">验证并进入</Button>
        </Card>
      </div>
    </AuthSurface>
  )
}

function AuthSurface({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-dvh w-full max-w-[600px] items-center bg-background px-5 py-8"><div className="w-full">{children}</div></main>
}

function AuthStatus({ label }: { label: string }) {
  return <AuthSurface><div aria-busy="true" className="space-y-3 text-center" role="status"><Cloud className="mx-auto size-8 animate-pulse text-primary" /><p className="text-sm font-semibold text-on-surface-variant">{label}</p></div></AuthSurface>
}

function DataCount({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-surface-container-low p-3"><p className="text-xs text-on-surface-variant">{label}</p><p className="mt-1 text-xl font-bold text-on-surface">{value}</p></div>
}

function AuthMessage({ children, tone = 'info' }: { children: ReactNode; tone?: 'error' | 'info' }) {
  return <p className={`rounded-xl px-3 py-2 text-sm leading-6 ${tone === 'error' ? 'bg-error-container text-on-error-container' : 'bg-primary-container text-on-primary-container'}`}>{children}</p>
}
