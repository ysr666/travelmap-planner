import { describe, expect, it } from 'vitest'
import type { AiTripDraft } from './aiTripDraft'
import type { AiTripDraftRequest } from './aiTripDraftRequest'
import {
  AI_TRIP_DRAFT_VARIANTS,
  buildAiTripDraftVariantMixDays,
  buildAiTripDraftVariantComparisons,
  buildDefaultAiTripDraftVariantMixSelection,
  buildMixedAiTripDraftFromVariants,
  buildAiTripDraftVariantRequest,
  createInitialAiTripDraftVariantStates,
  getSelectableAiTripDraftVariantDraft,
  getSuccessfulAiTripDraftVariantCount,
  mergeAiTripDraftVariantState,
  summarizeAiTripDraftVariantDraft,
} from './aiTripDraftVariants'

const baseRequest: AiTripDraftRequest = {
  avoidText: '不要购物',
  dayCount: 2,
  destination: '首尔',
  endDate: '2025-10-02',
  freeTextRequirement: '带父母出行',
  interestTags: ['美食'],
  interestText: '咖啡馆',
  mealTimeProtection: true,
  mustVisitText: '景福宫',
  partySize: 3,
  pace: 'relaxed',
  preferTransport: 'public_transport',
  startDate: '2025-10-01',
}

describe('aiTripDraftVariants', () => {
  it('defines the three visible trip variants', () => {
    expect(AI_TRIP_DRAFT_VARIANTS.map((variant) => variant.kind)).toEqual(['classic', 'relaxed', 'deep'])
    expect(AI_TRIP_DRAFT_VARIANTS.map((variant) => variant.label)).toEqual(['经典游', '轻松游', '深度游'])
  })

  it('builds variant requests while preserving user fields', () => {
    const request = buildAiTripDraftVariantRequest(baseRequest, 'classic')

    expect(request).toMatchObject({
      avoidText: '不要购物',
      dayCount: 2,
      destination: '首尔',
      endDate: '2025-10-02',
      interestTags: ['美食'],
      interestText: '咖啡馆',
      mealTimeProtection: true,
      mustVisitText: '景福宫',
      partySize: 3,
      pace: 'moderate',
      preferTransport: 'public_transport',
      startDate: '2025-10-01',
    })
    expect(request.freeTextRequirement).toContain('多方案风格：经典游')
    expect(request.freeTextRequirement).toContain('用户补充要求：带父母出行')
  })

  it('applies relaxed and deep variant pace and guidance', () => {
    const relaxed = buildAiTripDraftVariantRequest(baseRequest, 'relaxed')
    const deep = buildAiTripDraftVariantRequest(baseRequest, 'deep')

    expect(relaxed.pace).toBe('relaxed')
    expect(relaxed.freeTextRequirement).toContain('多方案风格：轻松游')
    expect(deep.pace).toBe('compact')
    expect(deep.freeTextRequirement).toContain('多方案风格：深度游')
  })

  it('caps merged guidance to the existing free text limit', () => {
    const request = buildAiTripDraftVariantRequest({
      ...baseRequest,
      freeTextRequirement: 'x'.repeat(2200),
    }, 'deep')

    expect(request.freeTextRequirement).toHaveLength(2000)
    expect(request.freeTextRequirement).toContain('多方案风格：深度游')
  })

  it('aggregates partial success without making failed variants selectable', () => {
    const states = createInitialAiTripDraftVariantStates()
    const next = mergeAiTripDraftVariantState(
      mergeAiTripDraftVariantState(states, 'classic', {
        draft: draftFixture('经典游'),
        status: 'success',
        warnings: ['示例 warning'],
      }),
      'relaxed',
      {
        error: 'AI 服务暂时不可用',
        status: 'error',
        warnings: [],
      },
    )

    const classic = next.find((state) => state.definition.kind === 'classic')!
    const relaxed = next.find((state) => state.definition.kind === 'relaxed')!

    expect(getSuccessfulAiTripDraftVariantCount(next)).toBe(1)
    expect(getSelectableAiTripDraftVariantDraft(classic)?.title).toBe('经典游')
    expect(getSelectableAiTripDraftVariantDraft(relaxed)).toBeNull()
  })

  it('summarizes a generated variant draft', () => {
    expect(summarizeAiTripDraftVariantDraft(draftFixture('摘要'))).toEqual({
      dayCount: 2,
      itemCount: 3,
    })
  })

  it('builds comparison metrics for variant pace audience and spot count', () => {
    const states = createInitialAiTripDraftVariantStates().map((state) => ({
      ...state,
      draft: draftFixture(state.definition.label),
      status: 'success' as const,
    }))

    const comparisons = buildAiTripDraftVariantComparisons(states)

    expect(comparisons.map((comparison) => comparison.bestFor)).toEqual([
      '首次到访 / 想稳妥覆盖',
      '亲子 / 长辈 / 慢节奏',
      '文化爱好者 / 二刷 / 体力较好',
    ])
    expect(comparisons.map((comparison) => comparison.metrics?.paceLabel)).toEqual(['适中', '轻松', '紧凑'])
    expect(comparisons[0].metrics?.spotCount).toMatchObject({
      averagePerDay: 1.5,
      detail: '3 个景点 · 约 1.5 个/天',
      total: 3,
    })
  })

  it('classifies daily intensity as light moderate and full', () => {
    const light = buildAiTripDraftVariantComparisons([
      successState('classic', draftWithDailyCounts([2, 3])),
    ])[0]
    const moderate = buildAiTripDraftVariantComparisons([
      successState('classic', draftWithDailyCounts([4, 5])),
    ])[0]
    const full = buildAiTripDraftVariantComparisons([
      successState('classic', draftWithDailyCounts([6, 7])),
    ])[0]

    expect(light.metrics?.dailyIntensity).toMatchObject({ label: '轻松', level: 'light' })
    expect(moderate.metrics?.dailyIntensity).toMatchObject({ label: '适中', level: 'moderate' })
    expect(full.metrics?.dailyIntensity).toMatchObject({ label: '偏满', level: 'full' })
  })

  it('classifies transport complexity from draft transport fields', () => {
    const simple = buildAiTripDraftVariantComparisons([
      successState('classic', transportDraft([
        { previousTransportMode: 'walk', previousTransportDurationMinutes: 15 },
        { previousTransportMode: 'walk', previousTransportDurationMinutes: 20 },
      ])),
    ])[0]
    const moderate = buildAiTripDraftVariantComparisons([
      successState('classic', transportDraft([
        { previousTransportMode: 'transit', previousTransportDurationMinutes: 25 },
        { previousTransportMode: 'walk', previousTransportDurationMinutes: 20 },
        { previousTransportMode: 'walk', previousTransportDurationMinutes: 15 },
      ])),
    ])[0]
    const complex = buildAiTripDraftVariantComparisons([
      successState('classic', transportDraft([
        { previousTransportMode: 'transit', previousTransportDurationMinutes: 55 },
        {},
        { previousTransportMode: 'car', previousTransportDurationMinutes: 70 },
      ])),
    ])[0]

    expect(simple.metrics?.transportComplexity).toMatchObject({ label: '简单', level: 'simple' })
    expect(moderate.metrics?.transportComplexity).toMatchObject({ label: '适中', level: 'moderate' })
    expect(complex.metrics?.transportComplexity).toMatchObject({ label: '复杂', level: 'complex' })
  })

  it('preserves failed variant status without draft metrics', () => {
    const comparisons = buildAiTripDraftVariantComparisons([
      {
        ...createInitialAiTripDraftVariantStates()[1],
        error: '生成失败',
        status: 'error',
      },
    ])

    expect(comparisons[0]).toMatchObject({
      metrics: undefined,
      status: 'error',
      statusText: '生成失败，可重新生成',
    })
  })

  it('builds mix day options only from successful variants', () => {
    const mixDays = buildAiTripDraftVariantMixDays([
      successState('classic', draftWithNamedDays('经典', ['经典 D1', '经典 D2'])),
      {
        ...createInitialAiTripDraftVariantStates()[1],
        error: '生成失败',
        status: 'error',
      },
      successState('deep', draftWithNamedDays('深度', ['深度 D1', '深度 D2'])),
    ])

    expect(mixDays).toHaveLength(2)
    expect(mixDays[0].options.map((option) => option.label)).toEqual(['经典游', '深度游'])
    expect(mixDays[0].options.map((option) => option.dayTitle)).toEqual(['经典 D1', '深度 D1'])
  })

  it('builds a default mix selection from the first available option per day', () => {
    const mixDays = buildAiTripDraftVariantMixDays([
      successState('classic', draftWithNamedDays('经典', ['经典 D1', '经典 D2'])),
      successState('relaxed', draftWithNamedDays('轻松', ['轻松 D1', '轻松 D2'])),
    ])

    expect(buildDefaultAiTripDraftVariantMixSelection(mixDays)).toEqual({
      '2025-10-01': 'classic',
      '2025-10-02': 'classic',
    })
  })

  it('mixes selected days into a new draft', () => {
    const result = buildMixedAiTripDraftFromVariants({
      selection: {
        '2025-10-01': 'classic',
        '2025-10-02': 'relaxed',
        '2025-10-03': 'deep',
      },
      states: [
        successState('classic', draftWithNamedDays('经典', ['经典 D1', '经典 D2', '经典 D3'])),
        successState('relaxed', draftWithNamedDays('轻松', ['轻松 D1', '轻松 D2', '轻松 D3'])),
        successState('deep', draftWithNamedDays('深度', ['深度 D1', '深度 D2', '深度 D3'])),
      ],
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.draft.title).toBe('首尔混合方案')
      expect(result.draft.days.map((day) => day.title)).toEqual(['经典 D1', '轻松 D2', '深度 D3'])
      expect(result.sourceLabels).toEqual(['经典游第 1 天', '轻松游第 2 天', '深度游第 3 天'])
    }
  })

  it('rejects unavailable day source selections', () => {
    const result = buildMixedAiTripDraftFromVariants({
      selection: {
        '2025-10-01': 'relaxed',
      },
      states: [
        successState('classic', draftWithNamedDays('经典', ['经典 D1'])),
      ],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('没有可用的来源方案')
    }
  })
})

function draftFixture(title: string): AiTripDraft {
  return {
    destination: '首尔',
    endDate: '2025-10-02',
    startDate: '2025-10-01',
    title,
    days: [
      {
        date: '2025-10-01',
        items: [
          { title: '景福宫' },
          { title: '北村韩屋村' },
        ],
      },
      {
        date: '2025-10-02',
        items: [
          { title: '明洞' },
        ],
      },
    ],
  }
}

function successState(kind: 'classic' | 'relaxed' | 'deep', draft: AiTripDraft) {
  const state = createInitialAiTripDraftVariantStates().find((candidate) => candidate.definition.kind === kind)!
  return {
    ...state,
    draft,
    status: 'success' as const,
  }
}

function draftWithDailyCounts(counts: number[]): AiTripDraft {
  return {
    destination: '首尔',
    endDate: `2025-10-0${counts.length}`,
    startDate: '2025-10-01',
    title: '强度测试',
    days: counts.map((count, dayIndex) => ({
      date: `2025-10-0${dayIndex + 1}`,
      items: Array.from({ length: count }, (_, itemIndex) => ({
        title: `景点${dayIndex + 1}-${itemIndex + 1}`,
      })),
    })),
  }
}

function transportDraft(segments: Array<{ previousTransportDurationMinutes?: number; previousTransportMode?: AiTripDraft['days'][number]['items'][number]['previousTransportMode'] }>): AiTripDraft {
  return {
    destination: '首尔',
    endDate: '2025-10-01',
    startDate: '2025-10-01',
    title: '交通测试',
    days: [{
      date: '2025-10-01',
      items: [
        { title: '起点' },
        ...segments.map((segment, index) => ({
          title: `景点${index + 1}`,
          ...segment,
        })),
      ],
    }],
  }
}

function draftWithNamedDays(prefix: string, dayTitles: string[]): AiTripDraft {
  return {
    destination: '首尔',
    endDate: `2025-10-0${dayTitles.length}`,
    startDate: '2025-10-01',
    title: `${prefix}方案`,
    days: dayTitles.map((title, index) => ({
      date: `2025-10-0${index + 1}`,
      title,
      tips: [`${title}提示`],
      items: [
        { title: `${title}景点`, locationName: `${title}地点` },
      ],
    })),
  }
}
