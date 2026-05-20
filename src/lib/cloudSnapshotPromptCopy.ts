import type { CloudSnapshotCheckStatus } from './cloudSnapshotCheck'

export type CloudSnapshotPromptCopy = {
  detail: string
  title: string
}

export function getCloudSnapshotPromptCopy(status: CloudSnapshotCheckStatus): CloudSnapshotPromptCopy {
  if (status === 'cloud_newer') {
    return {
      detail: '云端存在比当前本地旅行更新的快照。恢复会创建一个新的本地旅行副本，不会覆盖当前本地旅行。',
      title: '云端快照较新',
    }
  }

  if (status === 'local_newer') {
    return {
      detail: '当前设备上的旅行比最新云端快照更新。上传会创建新的云端快照，不会删除旧快照。',
      title: '本地版本较新',
    }
  }

  if (status === 'possible_conflict') {
    return {
      detail: '当前本地旅行和最新云端快照都可能包含不同修改。请手动选择上传本地快照、恢复为新旅行副本，或暂不处理。',
      title: '本地和云端可能都有更新',
    }
  }

  return {
    detail: '当前本地旅行和云端快照没有可确认的版本差异。',
    title: '云端快照状态',
  }
}
