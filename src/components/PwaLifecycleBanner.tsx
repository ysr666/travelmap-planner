import { useState } from 'react'
import { RefreshCw, WifiOff, X } from 'lucide-react'
import { usePwaLifecycleState } from '../hooks/usePwaLifecycleState'
import { applyPendingPwaUpdate } from '../lib/pwaLifecycle'

export function PwaLifecycleBanner({ topAppBar }: { topAppBar: boolean }) {
  const lifecycle = usePwaLifecycleState()
  const [dismissedUpdate, setDismissedUpdate] = useState(false)
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const showUpdate = lifecycle.status === 'update-ready' && !dismissedUpdate
  const showOffline = !lifecycle.isOnline

  if (!showUpdate && !showOffline && !updateError) {
    return null
  }

  async function handleApplyUpdate() {
    setIsApplyingUpdate(true)
    setUpdateError(null)
    try {
      const applied = await applyPendingPwaUpdate()
      if (!applied) {
        setUpdateError('当前没有可应用的新版本。')
      }
    } catch {
      setUpdateError('更新失败，请稍后重新打开应用。')
    } finally {
      setIsApplyingUpdate(false)
    }
  }

  const topClass = topAppBar ? 'top-16' : 'top-3'
  const toneClass = showUpdate
    ? 'border-sky-200/80 bg-sky-50/95 text-sky-900 shadow-[0_10px_28px_rgba(14,116,144,0.16)] dark:border-sky-800/70 dark:bg-sky-950/90 dark:text-sky-100'
    : 'border-amber-200/80 bg-amber-50/95 text-amber-950 shadow-[0_10px_28px_rgba(180,83,9,0.16)] dark:border-amber-800/70 dark:bg-amber-950/90 dark:text-amber-100'

  return (
    <div
      className={`absolute inset-x-3 ${topClass} z-50 rounded-xl border px-3 py-2 backdrop-blur ${toneClass}`}
      data-testid="pwa-lifecycle-banner"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/70 dark:bg-white/10">
          {showUpdate ? <RefreshCw className="size-4" /> : <WifiOff className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold">
            {showUpdate ? '发现新版本' : '当前离线'}
          </p>
          <p className="mt-0.5 text-[11px] leading-4">
            {updateError ?? (showUpdate
              ? '更新会在确认后重启应用。'
              : '已缓存旅行和票据可查看；地图、路线、搜索和云端同步需要网络。')}
          </p>
        </div>
        {showUpdate ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              className="min-h-9 rounded-lg bg-white px-2 text-[11px] font-bold text-sky-800 active:scale-[0.98] disabled:opacity-60 dark:bg-sky-200 dark:text-sky-950"
              disabled={isApplyingUpdate}
              onClick={() => void handleApplyUpdate()}
              type="button"
            >
              {isApplyingUpdate ? '更新中' : '更新并重启'}
            </button>
            <button
              aria-label="稍后更新"
              className="flex size-9 items-center justify-center rounded-lg bg-white/50 active:scale-[0.98] dark:bg-white/10"
              disabled={isApplyingUpdate}
              onClick={() => setDismissedUpdate(true)}
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
