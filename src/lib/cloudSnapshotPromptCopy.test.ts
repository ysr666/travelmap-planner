import { describe, expect, it } from 'vitest'
import { getCloudSnapshotPromptCopy } from './cloudSnapshotPromptCopy'

describe('cloud snapshot prompt copy', () => {
  it('explains local newer uploads as overwriting the cloud save', () => {
    const copy = getCloudSnapshotPromptCopy('local_newer')

    expect(copy.title).toBe('本地版本较新')
    expect(copy.detail).toContain('云端版本')
    expect(copy.detail).toContain('覆盖原有云端保存')
  })

  it('explains cloud newer restores as overwriting the local trip in place', () => {
    const copy = getCloudSnapshotPromptCopy('cloud_newer')

    expect(copy.title).toBe('云端版本较新')
    expect(copy.detail).toContain('使用云端版本覆盖当前本地旅行')
    expect(copy.detail).toContain('不会创建新的本地旅行副本')
    expect(copy.detail).not.toContain('恢复为新旅行副本')
  })

  it('keeps possible conflict choices explicit', () => {
    const copy = getCloudSnapshotPromptCopy('possible_conflict')

    expect(copy.title).toBe('本地和云端可能都有更新')
    expect(copy.detail).toContain('用本地覆盖云端')
    expect(copy.detail).toContain('用云端覆盖本地')
    expect(copy.detail).toContain('不会自动合并')
  })
})
