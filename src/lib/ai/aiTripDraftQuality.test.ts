import { describe, expect, it } from 'vitest'
import {
  analyzeAiTripDraftQuality,
  flattenAiTripDraftQualityFindings,
  selectDefaultAiTripDraftQualityFindingIds,
  summarizeAiTripDraftQuality,
} from './aiTripDraftQuality'
import type { AiTripDraft } from './aiTripDraft'

function draft(days: AiTripDraft['days']): AiTripDraft {
  return { title: '测试旅行', destination: '杭州', startDate: '2025-04-01', endDate: '2025-04-03', days }
}

describe('analyzeAiTripDraftQuality', () => {
  it('returns clean for a well-structured draft', () => {
    const result = analyzeAiTripDraftQuality(draft([
      {
        date: '2025-04-01',
        items: [
          { title: '游览西湖', locationName: '西湖', startTime: '09:00', endTime: '11:00' },
          { title: '午餐', locationName: '楼外楼', startTime: '12:00', endTime: '13:00' },
          { title: '参观灵隐寺', locationName: '灵隐寺', startTime: '14:00', endTime: '16:00' },
        ],
      },
    ]))
    expect(result.status).toBe('clean')
    expect(result.criticals).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('warns for dense day exceeding moderate threshold (6)', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      title: `景点${i + 1}`,
      locationName: `地点${i + 1}`,
      startTime: `${String(8 + i).padStart(2, '0')}:00`,
      endTime: `${String(8 + i).padStart(2, '0')}:45`,
    }))
    const result = analyzeAiTripDraftQuality(draft([{ date: '2025-04-01', items }]))
    const finding = result.warnings.find((f) => f.ruleId === 'dense_day')
    expect(finding).toBeTruthy()
    expect(finding?.category).toBe('dense_schedule')
  })

  it('respects relaxed pace threshold (5)', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      title: `景点${i + 1}`,
      locationName: `地点${i + 1}`,
      startTime: `${String(8 + i).padStart(2, '0')}:00`,
      endTime: `${String(8 + i).padStart(2, '0')}:45`,
    }))
    const result = analyzeAiTripDraftQuality(draft([{ date: '2025-04-01', items }]), { pace: 'relaxed' })
    expect(result.warnings.some((f) => f.ruleId === 'dense_day')).toBe(true)
  })

  it('respects compact pace threshold (8)', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      title: `景点${i + 1}`,
      locationName: `地点${i + 1}`,
      startTime: `${String(8 + i).padStart(2, '0')}:00`,
      endTime: `${String(8 + i).padStart(2, '0')}:45`,
    }))
    const result = analyzeAiTripDraftQuality(draft([{ date: '2025-04-01', items }]), { pace: 'compact' })
    expect(result.warnings.some((f) => f.ruleId === 'dense_day')).toBe(false)
  })

  it('warns for short gap between adjacent timed items', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '景点A', locationName: 'A', startTime: '09:00', endTime: '10:00' },
        { title: '景点B', locationName: 'B', startTime: '10:05', endTime: '11:00' },
      ],
    }]))
    const finding = result.warnings.find((f) => f.ruleId === 'short_gap')
    expect(finding?.category).toBe('transport')
  })

  it('critical for time overlap', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '景点A', locationName: 'A', startTime: '09:00', endTime: '11:00' },
        { title: '景点B', locationName: 'B', startTime: '10:00', endTime: '12:00' },
      ],
    }]))
    expect(result.status).toBe('has_critical')
    const finding = result.criticals.find((f) => f.ruleId === 'time_overlap')
    expect(finding?.category).toBe('time_conflict')
  })

  it('warns for long day span > 12h', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '早起景点', locationName: 'A', startTime: '06:00', endTime: '07:00' },
        { title: '午餐', locationName: 'B', startTime: '12:00', endTime: '13:00' },
        { title: '晚间活动', locationName: 'C', startTime: '20:00', endTime: '22:00' },
      ],
    }]))
    expect(result.warnings.some((f) => f.ruleId === 'long_day_span')).toBe(true)
  })

  it('warns for missing location', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '自由活动' },
      ],
    }]))
    const finding = result.warnings.find((f) => f.ruleId === 'missing_location')
    expect(finding?.category).toBe('location')
  })

  it('warns for repeated generic titles', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '自由活动', locationName: 'A', startTime: '09:00', endTime: '10:00' },
        { title: '景点参观', locationName: 'B', startTime: '11:00', endTime: '12:00' },
      ],
    }]))
    expect(result.warnings.some((f) => f.ruleId === 'generic_title')).toBe(true)
  })

  it('does not warn for single generic title', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '自由活动', locationName: 'A', startTime: '09:00', endTime: '10:00' },
        { title: '游览西湖', locationName: '西湖', startTime: '11:00', endTime: '12:00' },
      ],
    }]))
    expect(result.warnings.some((f) => f.ruleId === 'generic_title')).toBe(false)
  })

  it('warns for meal gap when mealTimeProtection enabled', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '游览西湖', locationName: '西湖', startTime: '09:00', endTime: '11:00' },
        { title: '参观灵隐寺', locationName: '灵隐寺', startTime: '12:00', endTime: '14:00' },
        { title: '逛河坊街', locationName: '河坊街', startTime: '18:00', endTime: '20:00' },
      ],
    }]), { mealTimeProtection: true })
    expect(result.warnings.some((f) => f.ruleId === 'meal_gap')).toBe(true)
  })

  it('does not warn for meal gap when mealTimeProtection disabled', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '游览西湖', locationName: '西湖', startTime: '09:00', endTime: '11:00' },
        { title: '参观灵隐寺', locationName: '灵隐寺', startTime: '12:00', endTime: '14:00' },
      ],
    }]), { mealTimeProtection: false })
    expect(result.warnings.some((f) => f.ruleId === 'meal_gap')).toBe(false)
  })

  it('does not warn for missing transport on first item', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '景点A', locationName: 'A', startTime: '09:00', endTime: '10:00' },
      ],
    }]))
    expect(result.warnings.some((f) => f.ruleId === 'missing_transport')).toBe(false)
  })

  it('warns for missing transport between two located items', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '景点A', locationName: 'A', startTime: '09:00', endTime: '10:00' },
        { title: '景点B', locationName: 'B', startTime: '11:00', endTime: '12:00' },
      ],
    }]))
    expect(result.infos.some((f) => f.ruleId === 'missing_transport' && f.severity === 'info')).toBe(true)
  })

  it('warns for unreasonable transport duration and mode', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '景点A', locationName: 'A', startTime: '09:00', endTime: '10:00' },
        {
          title: '景点B',
          locationName: 'B',
          previousTransportDurationMinutes: 90,
          previousTransportMode: 'walk',
          startTime: '12:00',
          endTime: '13:00',
        },
      ],
    }]))
    const finding = result.warnings.find((f) => f.ruleId === 'unreasonable_transport')
    expect(finding?.category).toBe('transport')
    expect(finding?.title).toContain('交通')
  })

  it('warns for duplicate sights with normalized location names', () => {
    const result = analyzeAiTripDraftQuality(draft([
      {
        date: '2025-04-01',
        items: [
          { title: '游览西湖', locationName: '西湖', startTime: '09:00', endTime: '11:00' },
        ],
      },
      {
        date: '2025-04-02',
        items: [
          { title: '西湖散步', locationName: '西湖（湖滨）', startTime: '09:00', endTime: '11:00' },
        ],
      },
    ]))
    const finding = result.warnings.find((f) => f.ruleId === 'duplicate_sight')
    expect(finding?.category).toBe('duplicate_sight')
    expect(finding?.message).toContain('出现了 2 次')
  })

  it('uses stable deterministic finding ids', () => {
    const input = draft([{
      date: '2025-04-01',
      items: [
        { title: '景点A', locationName: 'A', startTime: '09:00', endTime: '11:00' },
        { title: '景点B', locationName: 'B', startTime: '10:00', endTime: '12:00' },
      ],
    }])
    const first = flattenAiTripDraftQualityFindings(analyzeAiTripDraftQuality(input)).map((f) => f.id)
    const second = flattenAiTripDraftQualityFindings(analyzeAiTripDraftQuality(input)).map((f) => f.id)
    expect(first).toEqual(second)
    expect(first[0]).toContain('time_overlap')
  })

  it('selects critical and warning findings by default but not info', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '景点A', locationName: 'A', startTime: '09:00', endTime: '10:00' },
        { title: '景点B', locationName: 'B', startTime: '10:05', endTime: '11:00' },
      ],
    }]))
    const defaultIds = new Set(selectDefaultAiTripDraftQualityFindingIds(result))
    const all = flattenAiTripDraftQualityFindings(result)
    expect(all.some((finding) => finding.severity === 'warning' && defaultIds.has(finding.id))).toBe(true)
    expect(all.some((finding) => finding.severity === 'info' && defaultIds.has(finding.id))).toBe(false)
  })
})

describe('summarizeAiTripDraftQuality', () => {
  it('returns message from summary', () => {
    const result = analyzeAiTripDraftQuality(draft([{
      date: '2025-04-01',
      items: [
        { title: '游览西湖', locationName: '西湖', startTime: '09:00', endTime: '11:00' },
        { title: '午餐', locationName: '楼外楼', startTime: '12:00', endTime: '13:00' },
      ],
    }]))
    expect(summarizeAiTripDraftQuality(result)).toBe(result.summary.message)
  })
})
