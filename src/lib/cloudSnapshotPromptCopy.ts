import type { CloudSnapshotCheckStatus } from './cloudSnapshotCheck'

export type CloudSnapshotPromptCopy = {
  detail: string
  title: string
}

export function getCloudSnapshotPromptCopy(status: CloudSnapshotCheckStatus): CloudSnapshotPromptCopy {
  if (status === 'cloud_newer') {
    return {
      detail: '账号数据比此设备版本更新。继续后会使用账号数据更新此设备旅行，不会创建重复旅行。',
      title: '账号数据较新',
    }
  }

  if (status === 'local_newer') {
    return {
      detail: '此设备版本比账号数据更新。立即同步后，此设备修改会成为这次旅行的账号数据，并覆盖原有云端记录。',
      title: '此设备版本较新',
    }
  }

  if (status === 'possible_conflict') {
    return {
      detail: '此设备版本和账号数据可能都包含不同修改。请选择同步方向；系统不会自动合并。',
      title: '此设备和账号可能都有更新',
    }
  }

  return {
    detail: '此设备旅行和账号数据没有可确认的版本差异。',
    title: '云端同步状态',
  }
}
