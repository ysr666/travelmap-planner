import { describe, expect, it } from 'vitest'
import { getCloudSnapshotPromptCopy } from './cloudSnapshotPromptCopy'

describe('cloud snapshot prompt copy', () => {
  it('explains local newer uploads as updating the same cloud save', () => {
    const copy = getCloudSnapshotPromptCopy('local_newer')

    expect(copy.title).toBe('本地版本较新')
    expect(copy.detail).toContain('更新同一个云端保存')
  })

  it('explains cloud newer restores as in-place local updates', () => {
    const copy = getCloudSnapshotPromptCopy('cloud_newer')

    expect(copy.title).toBe('云端保存较新')
    expect(copy.detail).toContain('原地更新')
    expect(copy.detail).toContain('不会创建副本')
  })

  it('keeps possible conflict choices explicit', () => {
    const copy = getCloudSnapshotPromptCopy('possible_conflict')

    expect(copy.title).toBe('本地和云端可能都有更新')
    expect(copy.detail).toContain('用本地更新云端')
    expect(copy.detail).toContain('用云端更新本地')
    expect(copy.detail).toContain('暂不处理')
  })
})
