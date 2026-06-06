import { describe, expect, it } from 'vitest'
import { getCloudSnapshotPromptCopy } from './cloudSnapshotPromptCopy'

describe('cloud snapshot prompt copy', () => {
  it('explains device newer sync as updating account data', () => {
    const copy = getCloudSnapshotPromptCopy('local_newer')

    expect(copy.title).toBe('此设备版本较新')
    expect(copy.detail).toContain('账号数据')
    expect(copy.detail).toContain('覆盖原有云端记录')
  })

  it('explains account newer sync as updating this device in place', () => {
    const copy = getCloudSnapshotPromptCopy('cloud_newer')

    expect(copy.title).toBe('账号数据较新')
    expect(copy.detail).toContain('使用账号数据更新此设备旅行')
    expect(copy.detail).toContain('不会创建重复旅行')
    expect(copy.detail).not.toContain('恢复为新旅行副本')
  })

  it('keeps possible conflict choices explicit', () => {
    const copy = getCloudSnapshotPromptCopy('possible_conflict')

    expect(copy.title).toBe('此设备和账号可能都有更新')
    expect(copy.detail).toContain('请选择整旅行同步方向')
    expect(copy.detail).toContain('当前方向操作不会自动合并')
  })
})
