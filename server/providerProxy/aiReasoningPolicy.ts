export type AiBackendReasoningMode = 'off' | 'auto' | 'high'

export type AiReasoningPolicyInput = {
  operation: 'ai_trip_draft' | 'ai_trip_draft_repair'
  dayCount?: number
  itemCount?: number
  findingCount?: number
  criticalCount?: number
  repairInstructionLength?: number
}

export function chooseAiReasoningMode(input: AiReasoningPolicyInput): AiBackendReasoningMode {
  if (input.operation === 'ai_trip_draft') {
    if (atLeast(input.dayCount, 7) || atLeast(input.itemCount, 35)) return 'high'
    if (atLeast(input.dayCount, 5) || atLeast(input.itemCount, 25)) return 'auto'
    return 'off'
  }

  if (
    atLeast(input.criticalCount, 1)
    || atLeast(input.findingCount, 10)
    || atLeast(input.itemCount, 25)
    || atLeast(input.repairInstructionLength, 600)
  ) {
    return 'high'
  }

  if (
    atLeast(input.findingCount, 6)
    || atLeast(input.itemCount, 15)
    || atLeast(input.repairInstructionLength, 300)
  ) {
    return 'auto'
  }

  return 'off'
}

function atLeast(value: number | undefined, threshold: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= threshold
}
