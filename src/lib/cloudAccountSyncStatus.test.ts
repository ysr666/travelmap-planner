import { describe, expect, it } from 'vitest'
import {
  getCloudAccountSyncStatusView,
  type CloudAccountSyncStatusInput,
} from './cloudAccountSyncStatus'

const baseInput: CloudAccountSyncStatusInput = {
  actionRequiredCount: 0,
  checkError: null,
  configured: true,
  enabled: true,
  errorCount: 0,
  isChecking: false,
  isOnline: true,
  queuedCount: 0,
  signedIn: true,
  syncingCount: 0,
}

describe('getCloudAccountSyncStatusView', () => {
  it('shows unconfigured state', () => {
    expect(getCloudAccountSyncStatusView({ ...baseInput, configured: false })).toMatchObject({
      status: 'unconfigured',
      title: '未配置',
    })
  })

  it('shows disabled state before lower-priority sync work', () => {
    expect(getCloudAccountSyncStatusView({ ...baseInput, enabled: false, queuedCount: 2 })).toMatchObject({
      status: 'disabled',
      title: '自动同步已关闭',
    })
  })

  it('shows signed-out state', () => {
    expect(getCloudAccountSyncStatusView({ ...baseInput, signedIn: false })).toMatchObject({
      detail: expect.stringContaining('登录账号后'),
      status: 'signed_out',
      title: '未登录',
    })
  })

  it('shows offline state before conflict or error', () => {
    expect(getCloudAccountSyncStatusView({
      ...baseInput,
      actionRequiredCount: 1,
      errorCount: 1,
      isOnline: false,
      queuedCount: 2,
    })).toMatchObject({
      detail: expect.stringContaining('网络恢复后自动同步'),
      status: 'offline',
      title: '等待网络',
    })
  })

  it('shows conflict state when direction needs handling', () => {
    expect(getCloudAccountSyncStatusView({ ...baseInput, actionRequiredCount: 2 })).toMatchObject({
      detail: expect.stringContaining('选择同步方向'),
      status: 'conflict',
      title: '需要处理冲突',
    })
  })

  it('shows error state from check errors', () => {
    expect(getCloudAccountSyncStatusView({ ...baseInput, checkError: '读取账号数据失败' })).toMatchObject({
      detail: '读取账号数据失败',
      status: 'error',
      title: '同步失败',
    })
  })

  it('shows syncing state while checking or uploading', () => {
    expect(getCloudAccountSyncStatusView({ ...baseInput, isChecking: true })).toMatchObject({
      status: 'syncing',
      title: '正在同步',
    })
    expect(getCloudAccountSyncStatusView({ ...baseInput, syncingCount: 3 })).toMatchObject({
      detail: '正在同步 3 个旅行。',
      status: 'syncing',
      title: '正在同步',
    })
  })

  it('shows queued state', () => {
    expect(getCloudAccountSyncStatusView({ ...baseInput, queuedCount: 1 })).toMatchObject({
      status: 'queued',
      title: '等待自动同步',
    })
  })

  it('shows synced state when no work is pending', () => {
    expect(getCloudAccountSyncStatusView(baseInput)).toMatchObject({
      status: 'synced',
      title: '已同步',
    })
  })
})
