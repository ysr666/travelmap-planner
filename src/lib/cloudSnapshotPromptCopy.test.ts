import { describe, expect, it } from 'vitest'
import { getCloudSnapshotPromptCopy } from './cloudSnapshotPromptCopy'

describe('cloud snapshot prompt copy', () => {
  it('explains local newer uploads as creating a new cloud snapshot', () => {
    const copy = getCloudSnapshotPromptCopy('local_newer')

    expect(copy.title).toBe('本地版本较新')
    expect(copy.detail).toContain('创建新的云端快照')
    expect(copy.detail).toContain('不会删除旧快照')
  })

  it('explains cloud newer restores as new local trip copies', () => {
    const copy = getCloudSnapshotPromptCopy('cloud_newer')

    expect(copy.title).toBe('云端快照较新')
    expect(copy.detail).toContain('新的本地旅行副本')
    expect(copy.detail).toContain('不会覆盖当前本地旅行')
  })

  it('keeps possible conflict choices explicit', () => {
    const copy = getCloudSnapshotPromptCopy('possible_conflict')

    expect(copy.title).toBe('本地和云端可能都有更新')
    expect(copy.detail).toContain('上传本地快照')
    expect(copy.detail).toContain('恢复为新旅行副本')
    expect(copy.detail).toContain('暂不处理')
  })
})
