import { useState } from 'react'
import { Archive, HardDriveDownload } from 'lucide-react'
import { CloudBackupPanel } from '../cloud/CloudBackupPanel'
import { buildTripBackupFileName, downloadBlob, exportTripBackup } from '../../lib/backup'
import type { Trip } from '../../types'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { SectionHeader } from '../ui/SectionHeader'

type TravelBackupPanelProps = {
  trip: Trip | null
  isLoadingTrip?: boolean
  showCloudBackup?: boolean
}

export function TravelBackupPanel({ trip, isLoadingTrip = false, showCloudBackup = true }: TravelBackupPanelProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleExport() {
    if (!trip) {
      setError('请先进入某个旅行，再导出离线归档。')
      return
    }

    setIsExporting(true)
    setError(null)
    setSuccess(null)
    try {
      const zipBlob = await exportTripBackup(trip.id)
      downloadBlob(zipBlob, buildTripBackupFileName(trip.title))
      setSuccess('旅行 zip 归档已生成。可把它保存到 iCloud Drive、OneDrive 或电脑。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导出归档失败')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <section className="space-y-3" id="travel-backup-panel">
      <SectionHeader title={showCloudBackup ? '同步与归档' : '导出旅行'} />

      {showCloudBackup ? <CloudBackupPanel trip={trip} /> : null}

      <Card className="space-y-3">
        <p className="text-sm leading-6 text-on-surface-variant">导出 zip 文件，供迁移或手动备份。</p>
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:text-sky-300">
            <HardDriveDownload className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-on-surface">旅行归档</h3>
            <p className="truncate text-sm text-on-surface-variant">
              {trip ? trip.title : '请先进入某个旅行，再导出离线归档。'}
            </p>
          </div>
        </div>

        {isLoadingTrip ? (
          <div className="h-11 animate-pulse rounded-xl bg-surface-container" />
        ) : trip ? (
          <Button
            className="w-full"
            icon={<HardDriveDownload className="size-4" />}
            loading={isExporting}
            onClick={() => void handleExport()}
          >
            导出当前旅行 zip 归档
          </Button>
        ) : (
          <EmptyState
            body="从旅行总览进入设置页后，可以导出该旅行的完整 zip 归档。"
            icon={<Archive className="size-6" />}
            title="当前没有可导出的旅行"
          />
        )}

        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-300">{error}</p>
        ) : null}
        {success ? (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">{success}</p>
        ) : null}
      </Card>
    </section>
  )
}
