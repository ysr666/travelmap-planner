import { describe, expect, it } from 'vitest'
import type { AiTripDraft } from './aiTripDraft'
import type { AiTripDraftRequest } from './aiTripDraftRequest'
import {
  AI_TRIP_DRAFT_VARIANTS,
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
