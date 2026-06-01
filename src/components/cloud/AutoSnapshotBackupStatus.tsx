import { Cloud, CloudOff, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  getTripAutoSnapshotStatus,
  isAutoSnapshotBackupEnabled,
  subscribeAutoSnapshotBackup,
} from '../../lib/autoSnapshotBackup'

type AutoSnapshotBackupStatusProps = {
  tripId?: string | null
  visibility?: 'always' | 'active-only'
}

export function AutoSnapshotBackupStatus({
  tripId,
  visibility = 'always',
}: AutoSnapshotBackupStatusProps) {
  const [, forceRefresh] = useState(0)

  useEffect(() => {
    return subscribeAutoSnapshotBackup((detail) => {
      if (!tripId || !detail.tripId || detail.tripId === tripId || detail.kind === 'settings') {
        forceRefresh((value) => value + 1)
      }
    })
  }, [tripId])

  if (!tripId) {
    return null
  }

  const entry = getTripAutoSnapshotStatus(tripId)
  const enabled = isAutoSnapshotBackupEnabled()
  const view = getStatusView(entry?.status, enabled, entry?.lastError)

  if (visibility === 'active-only' && view.weight === 'quiet') {
    return null
  }

  return (
    <p
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${view.className}`}
      data-testid="auto-snapshot-status"
    >
      {view.icon}
      <span className="truncate">{view.text}</span>
    </p>
  )
}

function getStatusView(status: string | undefined, enabled: boolean, lastError?: string) {
  if (status === 'uploading') {
    return {
      className: 'bg-sky-50 text-sky-700 dark:text-sky-300',
      icon: <LoaderCircle className="size-3.5 animate-spin" />,
      text: '正在云端同步',
      weight: 'active',
    }
  }

  if (status === 'error') {
    return {
      className: 'bg-amber-50 text-amber-800 dark:text-amber-300',
      icon: <CloudOff className="size-3.5" />,
      text: lastError || '云端同步失败，可稍后重试',
      weight: 'active',
    }
  }

  if (status === 'dirty') {
    return {
      className: 'bg-sky-50 text-sky-700 dark:text-sky-300',
      icon: <Cloud className="size-3.5" />,
      text: '等待同步到云端',
      weight: 'active',
    }
  }

  if (enabled && status === 'synced') {
    return {
      className: 'bg-emerald-50 text-emerald-700 dark:text-emerald-300',
      icon: <Cloud className="size-3.5" />,
      text: '已同步到云端',
      weight: 'quiet',
    }
  }

  return {
    className: 'bg-surface-container-low text-on-surface-variant',
    icon: <Cloud className="size-3.5" />,
    text: '已自动保存到本地',
    weight: 'quiet',
  }
}
