import type { AiTripDraft } from './aiTripDraft'
import type { AiTripDraftRequest } from './aiTripDraftRequest'

export type AiTripDraftVariantKind = 'classic' | 'relaxed' | 'deep'

export type AiTripDraftVariantDefinition = {
  description: string
  guidance: string
  kind: AiTripDraftVariantKind
  label: string
  pace: NonNullable<AiTripDraftRequest['pace']>
}

export type AiTripDraftVariantState = {
  definition: AiTripDraftVariantDefinition
  draft?: AiTripDraft
  error?: string
  status: 'idle' | 'loading' | 'success' | 'error'
  warnings: string[]
}

export const AI_TRIP_DRAFT_VARIANTS: AiTripDraftVariantDefinition[] = [
  {
    description: '首次到访友好，覆盖代表性景点、城市体验和顺路动线。',
    guidance: '多方案风格：经典游。适合首次到访，优先安排代表性景点、城市体验和顺路动线，避免过度小众。',
    kind: 'classic',
    label: '经典游',
    pace: 'moderate',
  },
  {
    description: '少换区、晚一点开始，保留休息和用餐缓冲。',
    guidance: '多方案风格：轻松游。少换区，较晚开始，每天保留休息、咖啡和用餐缓冲，减少奔波。',
    kind: 'relaxed',
    label: '轻松游',
    pace: 'relaxed',
  },
  {
    description: '主题探索更深入，偏文化、街区、博物馆和在地体验。',
    guidance: '多方案风格：深度游。围绕主题深挖，增加在地体验、博物馆、街区文化和小众但可靠的地点。',
    kind: 'deep',
    label: '深度游',
    pace: 'compact',
  },
]

const MAX_FREE_TEXT_REQUIREMENT_LENGTH = 2000

export function buildAiTripDraftVariantRequest(
  baseRequest: AiTripDraftRequest,
  kind: AiTripDraftVariantKind,
): AiTripDraftRequest {
  const definition = getAiTripDraftVariantDefinition(kind)
  return {
    ...baseRequest,
    freeTextRequirement: mergeVariantGuidance(baseRequest.freeTextRequirement, definition.guidance),
    pace: definition.pace,
  }
}

export function createInitialAiTripDraftVariantStates(): AiTripDraftVariantState[] {
  return AI_TRIP_DRAFT_VARIANTS.map((definition) => ({
    definition,
    status: 'idle',
    warnings: [],
  }))
}

export function mergeAiTripDraftVariantState(
  states: AiTripDraftVariantState[],
  kind: AiTripDraftVariantKind,
  patch: Partial<Omit<AiTripDraftVariantState, 'definition'>>,
): AiTripDraftVariantState[] {
  return states.map((state) => state.definition.kind === kind
    ? { ...state, ...patch }
    : state)
}

export function getSelectableAiTripDraftVariantDraft(state: AiTripDraftVariantState): AiTripDraft | null {
  return state.status === 'success' && state.draft ? state.draft : null
}

export function getSuccessfulAiTripDraftVariantCount(states: AiTripDraftVariantState[]): number {
  return states.filter((state) => getSelectableAiTripDraftVariantDraft(state)).length
}

export function summarizeAiTripDraftVariantDraft(draft: AiTripDraft) {
  return {
    dayCount: draft.days.length,
    itemCount: draft.days.reduce((sum, day) => sum + day.items.length, 0),
  }
}

export function getAiTripDraftVariantDefinition(kind: AiTripDraftVariantKind): AiTripDraftVariantDefinition {
  const definition = AI_TRIP_DRAFT_VARIANTS.find((candidate) => candidate.kind === kind)
  if (!definition) {
    throw new Error(`Unknown AI trip draft variant: ${kind}`)
  }
  return definition
}

function mergeVariantGuidance(
  originalRequirement: string | undefined,
  guidance: string,
): string {
  const original = originalRequirement?.trim()
  const merged = original
    ? `${guidance}\n\n用户补充要求：${original}`
    : guidance
  return merged.length > MAX_FREE_TEXT_REQUIREMENT_LENGTH
    ? merged.slice(0, MAX_FREE_TEXT_REQUIREMENT_LENGTH)
    : merged
}
