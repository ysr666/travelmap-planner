import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  HardDriveDownload,
  Import,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { ListRow } from '../components/ui/ListRow'
import { SectionHeader } from '../components/ui/SectionHeader'
import { TripNav } from '../components/AppShell'
import { getTrip, listDaysByTrip } from '../db'
import {
  buildTripBackupFileName,
  downloadBlob,
  exportTripBackup,
  importTripBackup,
} from '../lib/backup'
import { getRouteParams, navigateTo } from '../lib/routes'
import { formatFileSize } from '../lib/tickets'
import type { Day, Trip } from '../types'

type StorageEstimateState = {
  usage?: number
  quota?: number
}

type PersistentStorageManager = StorageManager & {
  persisted?: () => Promise<boolean>
  persist?: () => Promise<boolean>
}

export function SettingsPage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [days, setDays] = useState<Day[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimateState | null>(null)
  const [isPersistenceSupported, setIsPersistenceSupported] = useState(false)
  const [persistedStorage, setPersistedStorage] = useState<boolean | null>(null)
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null)
  const [isRequestingPersistence, setIsRequestingPersistence] = useState(false)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [isLoadingTrip, setIsLoadingTrip] = useState(Boolean(tripId))
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const refreshTrip = useCallback(async () => {
    if (!tripId) {
      setTrip(null)
      setDays([])
      setIsLoadingTrip(false)
      return
    }

    setIsLoadingTrip(true)
    setError(null)
    try {
      const [foundTrip, foundDays] = await Promise.all([getTrip(tripId), listDaysByTrip(tripId)])
      setTrip(foundTrip ?? null)
      setDays(foundTrip ? foundDays : [])
      if (!foundTrip) {
        setError('没有找到当前旅行，请从首页重新进入。')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取当前旅行失败')
    } finally {
      setIsLoadingTrip(false)
    }
  }, [tripId])

  const refreshStorageStatus = useCallback(async () => {
    const storage = navigator.storage as PersistentStorageManager | undefined
    if (!storage) {
      setStorageEstimate(null)
      setIsPersistenceSupported(false)
      setPersistedStorage(null)
      return
    }

    if (storage.estimate) {
      try {
        const estimate = await storage.estimate()
        setStorageEstimate({ quota: estimate.quota, usage: estimate.usage })
      } catch {
        setStorageEstimate(null)
      }
    }

    const supportsPersisted = typeof storage.persisted === 'function'
    const supportsPersist = typeof storage.persist === 'function'
    setIsPersistenceSupported(supportsPersisted || supportsPersist)

    if (supportsPersisted) {
      try {
        setPersistedStorage(await storage.persisted?.() ?? null)
      } catch {
        setPersistedStorage(null)
      }
    } else {
      setPersistedStorage(null)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshTrip(), 0)
    return () => window.clearTimeout(timeout)
  }, [refreshTrip])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshStorageStatus(), 0)
    return () => window.clearTimeout(timeout)
  }, [refreshStorageStatus])

  useEffect(() => {
    function updateOnlineStatus() {
      setIsOnline(navigator.onLine)
    }

    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)
    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

  async function handleRequestPersistence() {
    const storage = navigator.storage as PersistentStorageManager | undefined
    if (!storage?.persist) {
      setPersistenceMessage('当前浏览器不支持持久化本地存储请求。')
      return
    }

    setIsRequestingPersistence(true)
    setPersistenceMessage(null)
    try {
      const granted = await storage.persist()
      setPersistedStorage(granted)
      setPersistenceMessage(
        granted
          ? '浏览器已授予持久化本地存储。仍建议定期导出 zip 备份。'
          : '浏览器未授予持久化本地存储。请务必导出 zip 备份。',
      )
      await refreshStorageStatus()
    } catch (caught) {
      setPersistenceMessage(caught instanceof Error ? caught.message : '请求持久化本地存储失败。')
    } finally {
      setIsRequestingPersistence(false)
    }
  }

  async function handleExport() {
    if (!trip) {
      setError('请先进入某个旅行，再导出该旅行备份。')
      return
    }

    setIsExporting(true)
    setError(null)
    setSuccess(null)
    setWarnings([])
    try {
      const zipBlob = await exportTripBackup(trip.id)
      downloadBlob(zipBlob, buildTripBackupFileName(trip.title))
      setSuccess('备份 zip 已生成。请把它保存到 iCloud Drive、OneDrive 或电脑本地。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导出备份失败')
    } finally {
      setIsExporting(false)
    }
  }

  async function handleImport() {
    if (!selectedFile) {
      setError('请选择一个 zip 备份文件。')
      return
    }

    setIsImporting(true)
    setError(null)
    setSuccess(null)
    setWarnings([])
    try {
      const result = await importTripBackup(selectedFile)
      setSuccess(`已导入「${result.title}」，正在打开旅行总览。`)
      setWarnings(result.warnings)
      setSelectedFile(null)
      setFileInputKey((current) => current + 1)
      window.setTimeout(
        () => navigateTo('overview', { tripId: result.tripId }),
        result.warnings.length > 0 ? 2200 : 600,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导入备份失败')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="space-y-5">
      {error || success || warnings.length > 0 ? (
        <Card className="space-y-3">
          {error ? <StatusMessage tone="error" message={error} /> : null}
          {success ? <StatusMessage tone="success" message={success} /> : null}
          {warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-800">
              <p className="font-semibold">导入/导出提醒</p>
              <ul className="mt-1 list-inside list-disc">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      {trip ? <TripNav activeRoute="settings" firstDayId={days[0]?.id} tripId={trip.id} /> : null}

      <section className="space-y-3">
        <SectionHeader title="PWA 和离线使用" />
        <Card className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Smartphone className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-950">可添加到 iPhone 主屏幕</h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                在 iPhone Safari 打开本页面，点分享按钮，再选择“添加到主屏幕”。安装后的应用会自动更新到新版本；如果页面异常，可以关闭后重新打开。
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            <InfoPill
              icon={isOnline ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
              text={isOnline ? '当前在线' : '当前离线'}
              tone={isOnline ? 'success' : 'warning'}
            />
            <InfoPill
              icon={<Database className="size-4" />}
              text="已保存的旅行、时间轴、交通段、票据和备份功能依赖本机 IndexedDB。"
            />
            <InfoPill
              icon={<AlertTriangle className="size-4" />}
              text="地图底图和外部 Apple/Google Maps 路线需要网络；本应用不会缓存外部地图资源。"
              tone="warning"
            />
          </div>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeader title="备份与导入" />
        <Card className="space-y-3">
          <p className="text-sm leading-6 text-slate-500">
            备份只在本机生成，不会上传服务器。zip 会包含行程、交通段、地图坐标、票据元数据和票据文件。
          </p>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <HardDriveDownload className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-950">导出当前旅行</h3>
              <p className="truncate text-sm text-slate-500">
                {trip ? trip.title : '请先进入某个旅行，再导出该旅行备份。'}
              </p>
            </div>
          </div>

          {isLoadingTrip ? (
            <SkeletonLine className="w-full" />
          ) : trip ? (
            <Button
              className="w-full"
              icon={<HardDriveDownload className="size-4" />}
              loading={isExporting}
              onClick={() => void handleExport()}
            >
              导出当前旅行备份 zip
            </Button>
          ) : (
            <EmptyState
              body="从旅行总览进入设置页后，可以导出该旅行的完整备份。"
              icon={<Archive className="size-6" />}
              title="当前没有可导出的旅行"
            />
          )}
        </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Import className="size-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-950">导入备份</h3>
            <p className="text-sm text-slate-500">选择之前导出的 travelmap zip 文件。</p>
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">备份文件</span>
          <input
            accept=".zip,application/zip,application/x-zip-compressed"
            className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-sky-700"
            key={fileInputKey}
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>

        {selectedFile ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            已选择：{selectedFile.name} · {formatFileSize(selectedFile.size)}
          </p>
        ) : null}

        <Button
          className="w-full"
          disabled={!selectedFile}
          icon={<Import className="size-4" />}
          loading={isImporting}
          onClick={() => void handleImport()}
          variant="secondary"
        >
          导入 zip 备份
        </Button>
      </Card>
      </section>

      <section className="space-y-3">
        <SectionHeader title="设备存储" />
        <Card className="space-y-3">
          <div className="divide-y divide-slate-100 py-1">
            <ListRow
              detail={
                storageEstimate
                  ? `已用 ${formatStorageSize(storageEstimate.usage)} / 配额 ${formatStorageSize(
                      storageEstimate.quota,
                    )}`
                  : '当前浏览器不支持存储估算'
              }
              icon={<Database className="size-5" />}
              title="存储估算"
            />
            <ListRow
              detail={getPersistenceDetail(isPersistenceSupported, persistedStorage)}
              icon={<ShieldCheck className="size-5" />}
              title="持久化存储"
            />
            <ListRow
              detail="浏览器数据、私密浏览、系统清理或长期未使用都可能影响 IndexedDB。"
              icon={<Smartphone className="size-5" />}
              title="本机 IndexedDB"
            />
          </div>

          <Button
            className="w-full"
            disabled={!isPersistenceSupported || persistedStorage === true}
            icon={<RefreshCw className="size-4" />}
            loading={isRequestingPersistence}
            onClick={() => void handleRequestPersistence()}
            variant="secondary"
          >
            请求持久化本地存储
          </Button>

          {persistenceMessage ? (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              {persistenceMessage}
            </p>
          ) : null}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeader title="关于" />
        <Card className="border-amber-100 bg-amber-50/80">
          <h3 className="text-base font-semibold text-amber-950">备份提醒</h3>
          <p className="mt-2 text-sm leading-6 text-amber-800">
            重要旅行出发前必须把 zip 保存到 iCloud Drive、OneDrive 或电脑本地。即使浏览器授予持久化存储，iOS Safari
            在存储压力、清除数据、私密浏览或长期未使用时仍可能丢失本地数据。
          </p>
        </Card>
      </section>
    </div>
  )
}

function StatusMessage({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const styles =
    tone === 'error'
      ? 'border-red-100 bg-red-50 text-red-600'
      : 'border-emerald-100 bg-emerald-50 text-emerald-700'
  const Icon = tone === 'error' ? AlertTriangle : CheckCircle2

  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-3 text-sm font-medium ${styles}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p className="leading-6">{message}</p>
    </div>
  )
}

function InfoPill({
  icon,
  text,
  tone = 'neutral',
}: {
  icon: ReactNode
  text: string
  tone?: 'neutral' | 'success' | 'warning'
}) {
  const styles = {
    neutral: 'bg-slate-50 text-slate-600',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-800',
  }[tone]

  return (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm leading-6 ${styles}`}>
      <span className="mt-1 shrink-0">{icon}</span>
      <span>{text}</span>
    </div>
  )
}

function getPersistenceDetail(isSupported: boolean, persisted: boolean | null) {
  if (!isSupported) {
    return '当前浏览器不支持持久化存储状态查询'
  }

  if (persisted === true) {
    return '已获得持久化存储许可，但仍需要导出 zip 备份'
  }

  if (persisted === false) {
    return '尚未获得持久化存储许可'
  }

  return '持久化存储状态未知'
}

function formatStorageSize(size?: number) {
  if (size === undefined || Number.isNaN(size)) {
    return '未知'
  }

  return formatFileSize(size)
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}
