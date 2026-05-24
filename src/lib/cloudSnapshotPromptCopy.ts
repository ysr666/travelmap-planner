import type { CloudSnapshotCheckStatus } from './cloudSnapshotCheck'

export type CloudSnapshotPromptCopy = {
  detail: string
  title: string
}

export function getCloudSnapshotPromptCopy(status: CloudSnapshotCheckStatus): CloudSnapshotPromptCopy {
  if (status === 'cloud_newer') {
    return {
      detail: '云端版本比当前本地版本更新。继续后会使用云端版本覆盖当前本地旅行，不会创建新的本地旅行副本。',
      title: '云端版本较新',
    }
  }

  if (status === 'local_newer') {
    return {
      detail: '本地版本比云端版本更新。上传后，当前本地修改会成为这次旅行的云端版本，并覆盖原有云端保存。',
      title: '本地版本较新',
    }
  }

  if (status === 'possible_conflict') {
    return {
      detail: '本地版本和云端版本可能都包含不同修改。请选择用本地覆盖云端或用云端覆盖本地；系统不会自动合并。',
      title: '本地和云端可能都有更新',
    }
  }

  return {
    detail: '当前本地旅行和云端保存没有可确认的版本差异。',
    title: '云端保存状态',
  }
}
