import { describe, expect, it } from 'vitest'
import type { AiTripDraft } from './aiTripDraft'
import { analyzeAiTripDraftQuality } from './aiTripDraftQuality'
import {
  applyAiTripDraftQualityRepairResultIfFresh,
  buildSelectedAiTripDraftRepairFindings,
} from './aiTripDraftQualityRepair'
import { fingerprintAiTripDraft } from './aiTripDraftRefine'

describe('aiTripDraftQualityRepair helpers', () => {
  it('builds repair payload only for selected findings', () => {
    const result = analyzeAiTripDraftQuality(denseDraft())
    const dense = result.warnings.find((finding) => finding.ruleId === 'dense_day')
    const missingLocation = result.warnings.find((finding) => finding.ruleId === 'missing_location')
    expect(dense).toBeTruthy()
    expect(missingLocation).toBeTruthy()

    const payload = buildSelectedAiTripDraftRepairFindings(result, new Set([dense!.id]))

    expect(payload).toHaveLength(1)
    expect(payload[0]).toMatchObject({
      ruleId: 'dense_day',
      severity: 'warning',
    })
    expect(payload[0].message).not.toContain('secret')
  })

  it('blocks stale repair application', () => {
    const current = denseDraft()
    const baseline = fingerprintAiTripDraft(current)
    const edited = { ...current, title: '用户已编辑标题' }

    const result = applyAiTripDraftQualityRepairResultIfFresh({
      baselineFingerprint: baseline,
      currentDraft: edited,
      repairedDraft: repairedDraft(),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('草案已变化')
    }
  })

  it('applies valid repair output while preserving current root metadata', () => {
    const current = denseDraft()
    const result = applyAiTripDraftQualityRepairResultIfFresh({
      baselineFingerprint: fingerprintAiTripDraft(current),
      currentDraft: current,
      repairedDraft: {
        ...repairedDraft(),
        title: '错误 root 标题',
        destination: '错误目的地',
      },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.draft.title).toBe(current.title)
      expect(result.draft.destination).toBe(current.destination)
      expect(result.draft.days[0].items).toHaveLength(2)
    }
  })
})

function denseDraft(): AiTripDraft {
  return {
    title: '质量测试',
    destination: '杭州',
    startDate: '2025-04-01',
    endDate: '2025-04-01',
    days: [{
      date: '2025-04-01',
      items: [
        { title: '景点1', startTime: '08:00', endTime: '08:30' },
        { title: '景点2', startTime: '09:00', endTime: '09:30' },
        { title: '景点3', startTime: '10:00', endTime: '10:30' },
        { title: '景点4', startTime: '11:00', endTime: '11:30' },
        { title: '景点5', startTime: '12:00', endTime: '12:30' },
        { title: '景点6', startTime: '13:00', endTime: '13:30' },
        { title: '景点7', startTime: '14:00', endTime: '14:30' },
      ],
    }],
  }
}

function repairedDraft(): AiTripDraft {
  return {
    title: '质量测试',
    destination: '杭州',
    startDate: '2025-04-01',
    endDate: '2025-04-01',
    days: [{
      date: '2025-04-01',
      items: [
        { title: '景点1', locationName: '景点1', startTime: '09:00', endTime: '10:00' },
        { title: '午餐休息', startTime: '12:00', endTime: '13:00' },
      ],
    }],
  }
}
