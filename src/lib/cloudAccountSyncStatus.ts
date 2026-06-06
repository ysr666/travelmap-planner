export type CloudAccountSyncStatus =
  | 'synced'
  | 'syncing'
  | 'queued'
  | 'offline'
  | 'conflict'
  | 'error'
  | 'signed_out'
  | 'disabled'
  | 'unconfigured'

export type CloudAccountSyncTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'

export type CloudAccountSyncStatusInput = {
  actionRequiredCount: number
  checkError?: string | null
  configured: boolean
  enabled: boolean
  errorCount: number
  isChecking: boolean
  isOnline: boolean
  queuedCount: number
  signedIn: boolean
  syncingCount: number
}

export type CloudAccountSyncStatusView = {
  detail: string
  status: CloudAccountSyncStatus
  title: string
  tone: CloudAccountSyncTone
}

export function getCloudAccountSyncStatusView({
  actionRequiredCount,
  checkError,
  configured,
  enabled,
  errorCount,
  isChecking,
  isOnline,
  queuedCount,
  signedIn,
  syncingCount,
}: CloudAccountSyncStatusInput): CloudAccountSyncStatusView {
  if (!configured) {
    return {
      detail: '配置 Supabase 后，登录账号即可自动同步旅行和票据。',
      status: 'unconfigured',
      title: '未配置',
      tone: 'neutral',
    }
  }

  if (!enabled) {
    return {
      detail: signedIn
        ? '此设备仍可离线使用；重新开启后会检查账号数据并处理待同步修改。'
        : '此设备仍可离线使用；登录并开启后会自动同步账号数据。',
      status: 'disabled',
      title: '自动同步已关闭',
      tone: 'neutral',
    }
  }

  if (!signedIn) {
    return {
      detail: '此设备仍可离线使用；登录账号后会检查账号数据并处理同步队列。',
      status: 'signed_out',
      title: '未登录',
      tone: 'neutral',
    }
  }

  if (!isOnline) {
    return {
      detail: queuedCount > 0
        ? `${queuedCount} 个此设备修改已留在队列中，网络恢复后自动同步。`
        : '网络恢复后会自动检查账号数据并继续同步。',
      status: 'offline',
      title: '等待网络',
      tone: 'warning',
    }
  }

  if (actionRequiredCount > 0) {
    return {
      detail: `${actionRequiredCount} 个旅行需要选择同步方向；系统不会自动合并或静默覆盖。`,
      status: 'conflict',
      title: '需要处理冲突',
      tone: 'warning',
    }
  }

  if (checkError || errorCount > 0) {
    return {
      detail: checkError || `${errorCount} 个旅行同步失败，可稍后重试。`,
      status: 'error',
      title: '同步失败',
      tone: 'danger',
    }
  }

  if (syncingCount > 0 || isChecking) {
    return {
      detail: syncingCount > 0
        ? `正在同步 ${syncingCount} 个旅行。`
        : '正在检查账号数据并处理同步队列。',
      status: 'syncing',
      title: '正在同步',
      tone: 'info',
    }
  }

  if (queuedCount > 0) {
    return {
      detail: `${queuedCount} 个此设备旅行修改等待同步，会在后台自动处理。`,
      status: 'queued',
      title: '等待自动同步',
      tone: 'info',
    }
  }

  return {
    detail: '此设备会继续检查账号数据；关键修改会自动进入同步队列。',
    status: 'synced',
    title: '已同步',
    tone: 'success',
  }
}
