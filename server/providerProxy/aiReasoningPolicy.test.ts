import { describe, expect, it } from 'vitest'
import { chooseAiReasoningMode } from './aiReasoningPolicy'

describe('chooseAiReasoningMode', () => {
  it('keeps simple generation off', () => {
    expect(chooseAiReasoningMode({ operation: 'ai_trip_draft', dayCount: 3 })).toBe('off')
  })

  it('uses auto for complex generation', () => {
    expect(chooseAiReasoningMode({ operation: 'ai_trip_draft', dayCount: 5 })).toBe('auto')
    expect(chooseAiReasoningMode({ operation: 'ai_trip_draft', itemCount: 25 })).toBe('auto')
  })

  it('uses high for very complex generation', () => {
    expect(chooseAiReasoningMode({ operation: 'ai_trip_draft', dayCount: 7 })).toBe('high')
    expect(chooseAiReasoningMode({ operation: 'ai_trip_draft', itemCount: 35 })).toBe('high')
  })

  it('keeps simple repair off', () => {
    expect(chooseAiReasoningMode({
      findingCount: 2,
      itemCount: 6,
      operation: 'ai_trip_draft_repair',
      repairInstructionLength: 80,
    })).toBe('off')
  })

  it('uses high for repair with critical findings', () => {
    expect(chooseAiReasoningMode({
      criticalCount: 1,
      findingCount: 1,
      itemCount: 3,
      operation: 'ai_trip_draft_repair',
    })).toBe('high')
  })

  it('uses auto or high for larger repairs', () => {
    expect(chooseAiReasoningMode({ findingCount: 6, operation: 'ai_trip_draft_repair' })).toBe('auto')
    expect(chooseAiReasoningMode({ itemCount: 15, operation: 'ai_trip_draft_repair' })).toBe('auto')
    expect(chooseAiReasoningMode({ operation: 'ai_trip_draft_repair', repairInstructionLength: 300 })).toBe('auto')
    expect(chooseAiReasoningMode({ findingCount: 10, operation: 'ai_trip_draft_repair' })).toBe('high')
    expect(chooseAiReasoningMode({ itemCount: 25, operation: 'ai_trip_draft_repair' })).toBe('high')
    expect(chooseAiReasoningMode({ operation: 'ai_trip_draft_repair', repairInstructionLength: 600 })).toBe('high')
  })

  it('defaults missing signals to off', () => {
    expect(chooseAiReasoningMode({ operation: 'ai_trip_draft' })).toBe('off')
    expect(chooseAiReasoningMode({ operation: 'ai_trip_draft_repair' })).toBe('off')
    expect(chooseAiReasoningMode({ operation: 'ai_trip_edit_plan' })).toBe('off')
  })

  it('keeps simple edit planning off and escalates only for complex edit signals', () => {
    expect(chooseAiReasoningMode({ editCommandLength: 80, itemCount: 8, operation: 'ai_trip_edit_plan' })).toBe('off')
    expect(chooseAiReasoningMode({ itemCount: 30, operation: 'ai_trip_edit_plan' })).toBe('auto')
    expect(chooseAiReasoningMode({ editCommandLength: 300, operation: 'ai_trip_edit_plan' })).toBe('auto')
    expect(chooseAiReasoningMode({ itemCount: 80, operation: 'ai_trip_edit_plan' })).toBe('high')
    expect(chooseAiReasoningMode({ editCommandLength: 600, operation: 'ai_trip_edit_plan' })).toBe('high')
  })
})
