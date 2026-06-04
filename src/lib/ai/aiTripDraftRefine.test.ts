import { describe, expect, it } from 'vitest'
import type { AiTripDraft } from './aiTripDraft'
import {
  applyAiTripDraftRefineResult,
  applyAiTripDraftRefineResultIfFresh,
  fingerprintAiTripDraft,
  getAiTripDraftRefineScopeDates,
} from './aiTripDraftRefine'

describe('aiTripDraftRefine helpers', () => {
  it('lists target dates for day and range scopes', () => {
    expect(getAiTripDraftRefineScopeDates(baseDraft(), { kind: 'day', date: '2025-04-02' })).toEqual(['2025-04-02'])
    expect(getAiTripDraftRefineScopeDates(baseDraft(), {
      endDate: '2025-04-03',
      kind: 'date_range',
      startDate: '2025-04-02',
    })).toEqual(['2025-04-02', '2025-04-03'])
  })

  it('replaces only the selected day and ignores provider root changes', () => {
    const current = baseDraft()
    const provider = providerDraft()

    const result = applyAiTripDraftRefineResult(current, provider, { kind: 'day', date: '2025-04-02' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.draft.title).toBe(current.title)
      expect(result.draft.destination).toBe(current.destination)
      expect(result.draft.days[0].title).toBe('抵达')
      expect(result.draft.days[1].title).toBe('优化后的文化日')
      expect(result.draft.days[2].title).toBe('购物')
    }
  })

  it('replaces only selected range days and preserves outside edits', () => {
    const current = baseDraft()
    const provider = providerDraft()

    const result = applyAiTripDraftRefineResult(current, provider, {
      endDate: '2025-04-02',
      kind: 'date_range',
      startDate: '2025-04-01',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.draft.days[0].title).toBe('优化后的抵达日')
      expect(result.draft.days[1].title).toBe('优化后的文化日')
      expect(result.draft.days[2].title).toBe('购物')
    }
  })

  it('fails when provider output misses the target date', () => {
    const provider = {
      ...providerDraft(),
      days: providerDraft().days.filter((day) => day.date !== '2025-04-02'),
    }

    const result = applyAiTripDraftRefineResult(baseDraft(), provider, { kind: 'day', date: '2025-04-02' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('2025-04-02')
    }
  })

  it('blocks stale baseline application', () => {
    const current = baseDraft()
    const baseline = fingerprintAiTripDraft(current)
    const edited = {
      ...current,
      days: current.days.map((day) => day.date === '2025-04-03' ? { ...day, title: '用户手动编辑' } : day),
    }

    const result = applyAiTripDraftRefineResultIfFresh({
      baselineFingerprint: baseline,
      currentDraft: edited,
      providerDraft: providerDraft(),
      scope: { kind: 'day', date: '2025-04-02' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('草案已变化')
    }
  })
})

function baseDraft(): AiTripDraft {
  return {
    title: '东京之旅',
    destination: '东京',
    startDate: '2025-04-01',
    endDate: '2025-04-03',
    days: [
      { date: '2025-04-01', title: '抵达', items: [{ title: '浅草寺' }] },
      { date: '2025-04-02', title: '文化', items: [{ title: '上野公园' }] },
      { date: '2025-04-03', title: '购物', items: [{ title: '银座' }] },
    ],
  }
}

function providerDraft(): AiTripDraft {
  return {
    title: '错误的新标题',
    destination: '错误的新目的地',
    startDate: '2025-05-01',
    endDate: '2025-05-03',
    days: [
      { date: '2025-04-01', title: '优化后的抵达日', tips: ['早点休息'], items: [{ title: '浅草寺深度游' }] },
      { date: '2025-04-02', title: '优化后的文化日', tips: ['减少排队'], items: [{ title: '东京国立博物馆' }] },
      { date: '2025-04-03', title: '优化后的购物日', tips: ['保留退税时间'], items: [{ title: '银座咖啡' }] },
    ],
  }
}
