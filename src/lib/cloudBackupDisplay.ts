import type { CloudBackupSummary } from './cloudBackup'

export type CloudBackupDisplayGroup = {
  backups: CloudBackupSummary[]
  destination?: string
  groupKey: string
  isGrouped: boolean
  latestSnapshotAt: string
  title: string
}

type CloudBackupWithLegacyTripId = CloudBackupSummary & {
  tripId?: string
}

export function getCloudBackupDisplayGroupKey(backup: CloudBackupSummary) {
  const candidate = backup as CloudBackupWithLegacyTripId
  return backup.originalTripId || candidate.tripId || null
}

export function groupCloudBackupsForDisplay(backups: CloudBackupSummary[]): CloudBackupDisplayGroup[] {
  const grouped = new Map<string, CloudBackupSummary[]>()
  const standalone: CloudBackupSummary[] = []

  for (const backup of backups) {
    const key = getCloudBackupDisplayGroupKey(backup)
    if (!key) {
      standalone.push(backup)
      continue
    }

    grouped.set(key, [...(grouped.get(key) ?? []), backup])
  }

  const groups: CloudBackupDisplayGroup[] = [
    ...[...grouped.entries()].map(([groupKey, groupBackups]) => {
      const sorted = sortCloudBackupsBySnapshotTime(groupBackups)
      const latest = sorted[0]
      return {
        backups: sorted,
        destination: latest?.destination,
        groupKey,
        isGrouped: sorted.length > 1,
        latestSnapshotAt: latest?.exportedAt || latest?.createdAt || '',
        title: latest?.title || '未命名旅行',
      }
    }),
    ...standalone.map((backup) => ({
      backups: [backup],
      destination: backup.destination,
      groupKey: `backup:${backup.id}`,
      isGrouped: false,
      latestSnapshotAt: backup.exportedAt || backup.createdAt || '',
      title: backup.title || '未命名旅行',
    })),
  ]

  return groups.sort((first, second) => parseSnapshotTime(second.latestSnapshotAt) - parseSnapshotTime(first.latestSnapshotAt))
}

export function sortCloudBackupsBySnapshotTime(backups: CloudBackupSummary[]) {
  return [...backups].sort((first, second) => getBackupSnapshotTime(second) - getBackupSnapshotTime(first))
}

function getBackupSnapshotTime(backup: CloudBackupSummary) {
  return parseSnapshotTime(backup.exportedAt) || parseSnapshotTime(backup.createdAt)
}

function parseSnapshotTime(value: string | undefined) {
  if (!value) {
    return 0
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}
