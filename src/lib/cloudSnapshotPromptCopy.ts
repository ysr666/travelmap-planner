import type { CloudSnapshotCheckStatus } from './cloudSnapshotCheck'

export type CloudSnapshotPromptCopy = {
  detail: string
  title: string
}

export function getCloudSnapshotPromptCopy(status: CloudSnapshotCheckStatus): CloudSnapshotPromptCopy {
  if (status === 'cloud_newer') {
    return {
      detail: '云端保存比当前本地旅行更新。使用云端会原地更新这个本地旅行，不会创建副本。',
      title: '云端保存较新',
    }
  }

  if (status === 'local_newer') {
    return {
      detail: '当前设备上的旅行比云端保存更新。上传会更新同一个云端保存。',
      title: '本地版本较新',
    }
  }

  if (status === 'possible_conflict') {
    return {
      detail: '当前本地旅行和云端保存都可能包含不同修改。请手动选择用本地更新云端、用云端更新本地，或暂不处理。',
      title: '本地和云端可能都有更新',
    }
  }

  return {
    detail: '当前本地旅行和云端保存没有可确认的版本差异。',
    title: '云端保存状态',
  }
}
