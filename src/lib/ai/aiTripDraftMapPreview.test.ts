import { describe, expect, it } from 'vitest'
import type { AiTripDraft } from './aiTripDraft'
import {
  buildAiTripDraftMapOrderAdjustment,
  buildAiTripDraftMapPreviews,
  formatAiTripDraftMapDistance,
} from './aiTripDraftMapPreview'

describe('aiTripDraftMapPreview', () => {
  it('filters invalid coordinates and preserves item order numbers', () => {
    const [preview] = buildAiTripDraftMapPreviews(draftWithItems([
      { title: '有效 A', locationName: 'A', lat: 35, lng: 139, startTime: '09:00' },
      { title: '无纬度', locationName: 'B', lng: 139.1, startTime: '10:00' },
      { title: '有效 C', locationName: 'C', lat: 35.1, lng: 139.2, startTime: '11:00' },
      { title: '非法 D', locationName: 'D', lat: 91, lng: 139.3, startTime: '12:00' },
    ]))

    expect(preview.itemCount).toBe(4)
    expect(preview.coordinateCount).toBe(2)
    expect(preview.points.map((point) => point.number)).toEqual([1, 3])
    expect(preview.items.map((item) => item.number)).toEqual([1, 2, 3, 4])
    expect(preview.items[1]).toMatchObject({
      coordinateLabel: '缺少坐标，未参与地图线段',
      hasValidCoordinate: false,
      participatesInPath: false,
    })
    expect(preview.warnings.map((warning) => warning.type)).toContain('missing_coordinates')
  })

  it('projects points into safe svg bounds', () => {
    const [preview] = buildAiTripDraftMapPreviews(draftWithItems([
      { title: '西南', lat: 30, lng: 120 },
      { title: '东北', lat: 31, lng: 121 },
      { title: '中点', lat: 30.5, lng: 120.5 },
    ]))

    expect(preview.points).toHaveLength(3)
    for (const point of preview.points) {
      expect(point.x).toBeGreaterThanOrEqual(8)
      expect(point.x).toBeLessThanOrEqual(92)
      expect(point.y).toBeGreaterThanOrEqual(8)
      expect(point.y).toBeLessThanOrEqual(92)
    }
    expect(preview.points[0]).toMatchObject({ x: 8, y: 92 })
    expect(preview.points[1]).toMatchObject({ x: 92, y: 8 })
    expect(preview.points[2]).toMatchObject({ x: 50, y: 50 })
  })

  it('reports insufficient coordinates while keeping one marker', () => {
    const [preview] = buildAiTripDraftMapPreviews(draftWithItems([
      { title: '唯一坐标', lat: 35.1, lng: 139.1 },
      { title: '缺坐标' },
    ]))

    expect(preview.points).toHaveLength(1)
    expect(preview.segments).toHaveLength(0)
    expect(preview.totalDistanceMeters).toBe(0)
    expect(preview.warnings.map((warning) => warning.type)).toEqual([
      'insufficient_coordinates',
      'missing_coordinates',
    ])
  })

  it('calculates straight-line segments and total distance', () => {
    const [preview] = buildAiTripDraftMapPreviews(draftWithItems([
      { title: 'A', lat: 35, lng: 139 },
      { title: 'B', lat: 35, lng: 139.01 },
      { title: 'C', lat: 35.01, lng: 139.01 },
    ]))

    expect(preview.segments).toHaveLength(2)
    expect(preview.segments[0]).toMatchObject({
      fromNumber: 1,
      fromTitle: 'A',
      toNumber: 2,
      toTitle: 'B',
    })
    expect(preview.totalDistanceMeters).toBeGreaterThan(1900)
    expect(preview.totalDistanceMeters).toBeLessThan(2300)
    expect(formatAiTripDraftMapDistance(preview.totalDistanceMeters)).toMatch(/km$/)
  })

  it('flags long jump segments against the day median', () => {
    const [preview] = buildAiTripDraftMapPreviews(draftWithItems([
      { title: '短 A', lat: 35, lng: 139 },
      { title: '短 B', lat: 35.001, lng: 139.001 },
      { title: '短 C', lat: 35.002, lng: 139.002 },
      { title: '远 D', lat: 35.4, lng: 139.4 },
    ]))

    const longJump = preview.warnings.find((warning) => warning.type === 'long_jump')
    expect(longJump?.message).toContain('短 C 到 远 D')
    expect(preview.segments[2].warning).toBe(true)
  })

  it('flags obvious backtracking triples', () => {
    const [preview] = buildAiTripDraftMapPreviews(draftWithItems([
      { title: '起点', lat: 35, lng: 139 },
      { title: '绕远点', lat: 35.2, lng: 139.2 },
      { title: '回到附近', lat: 35.001, lng: 139.001 },
    ]))

    const warning = preview.warnings.find((item) => item.type === 'backtracking')
    expect(warning?.message).toContain('绕远点')
    expect(warning?.itemIndexes).toEqual([0, 1, 2])
  })

  it('does not adjust map order when coordinates are insufficient', () => {
    const day = draftWithItems([
      { title: '唯一坐标', lat: 35.1, lng: 139.1 },
      { title: '缺坐标' },
    ]).days[0]

    const result = buildAiTripDraftMapOrderAdjustment(day)

    expect(result.changed).toBe(false)
    expect(result.nextItems.map((item) => item.title)).toEqual(['唯一坐标', '缺坐标'])
    expect(result.reason).toContain('有效坐标点不足 2 个')
  })

  it('uses nearest-neighbor order while preserving the first coordinate item as start', () => {
    const day = draftWithItems([
      { title: '起点', lat: 35, lng: 139 },
      { title: '绕远点', lat: 35.2, lng: 139.2 },
      { title: '回到附近', lat: 35.001, lng: 139.001 },
    ]).days[0]

    const result = buildAiTripDraftMapOrderAdjustment(day)

    expect(result.changed).toBe(true)
    expect(result.nextItems.map((item) => item.title)).toEqual(['起点', '回到附近', '绕远点'])
    expect(result.afterDistanceMeters).toBeLessThan(result.beforeDistanceMeters)
  })

  it('moves missing-coordinate items to the end while preserving their relative order', () => {
    const day = draftWithItems([
      { title: '起点', lat: 35, lng: 139 },
      { title: '无坐标 A' },
      { title: '远点', lat: 35.2, lng: 139.2 },
      { title: '无坐标 B' },
      { title: '近点', lat: 35.001, lng: 139.001 },
    ]).days[0]

    const result = buildAiTripDraftMapOrderAdjustment(day)

    expect(result.changed).toBe(true)
    expect(result.nextItems.map((item) => item.title)).toEqual(['起点', '近点', '远点', '无坐标 A', '无坐标 B'])
  })

  it('returns unchanged when the current order already matches map order', () => {
    const day = draftWithItems([
      { title: '起点', lat: 35, lng: 139 },
      { title: '近点', lat: 35.001, lng: 139.001 },
      { title: '远点', lat: 35.2, lng: 139.2 },
    ]).days[0]

    const result = buildAiTripDraftMapOrderAdjustment(day)

    expect(result.changed).toBe(false)
    expect(result.nextItems.map((item) => item.title)).toEqual(['起点', '近点', '远点'])
    expect(result.reason).toContain('当前顺序已经接近')
  })
})

function draftWithItems(items: AiTripDraft['days'][number]['items']): AiTripDraft {
  return {
    days: [{
      date: '2025-04-01',
      items,
      title: '测试日',
    }],
    destination: '测试目的地',
    endDate: '2025-04-01',
    startDate: '2025-04-01',
    title: '测试行程',
  }
}
