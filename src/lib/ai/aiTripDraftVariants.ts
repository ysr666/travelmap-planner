import type { AiTripDraft } from './aiTripDraft'
import type { AiTripDraftRequest } from './aiTripDraftRequest'

export type AiTripDraftVariantKind = 'classic' | 'relaxed' | 'deep'

export type AiTripDraftVariantDefinition = {
  bestFor: string
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

export type AiTripDraftVariantComparison = {
  bestFor: string
  definition: AiTripDraftVariantDefinition
  metrics?: {
    dailyIntensity: {
      detail: string
      label: '轻松' | '适中' | '偏满'
      level: 'light' | 'moderate' | 'full'
    }
    paceLabel: string
    spotCount: {
      averagePerDay: number
      detail: string
      total: number
    }
    transportComplexity: {
      detail: string
      label: '简单' | '适中' | '复杂'
      level: 'simple' | 'moderate' | 'complex'
    }
  }
  status: AiTripDraftVariantState['status']
  statusText: string
}

export type AiTripDraftVariantMixDayOption = {
  dayTitle?: string
  itemCount: number
  kind: AiTripDraftVariantKind
  label: string
}

export type AiTripDraftVariantMixDay = {
  date: string
  dayIndex: number
  options: AiTripDraftVariantMixDayOption[]
}

export type AiTripDraftVariantMixSelection = Record<string, AiTripDraftVariantKind>

export type AiTripDraftVariantMixResult =
  | { draft: AiTripDraft; ok: true; sourceLabels: string[] }
  | { errors: string[]; ok: false }

export const AI_TRIP_DRAFT_VARIANTS: AiTripDraftVariantDefinition[] = [
  {
    bestFor: '首次到访 / 想稳妥覆盖',
    description: '首次到访友好，覆盖代表性景点、城市体验和顺路动线。',
    guidance: '多方案风格：经典游。适合首次到访，优先安排代表性景点、城市体验和顺路动线，避免过度小众。',
    kind: 'classic',
    label: '经典游',
    pace: 'moderate',
  },
  {
    bestFor: '亲子 / 长辈 / 慢节奏',
    description: '少换区、晚一点开始，保留休息和用餐缓冲。',
    guidance: '多方案风格：轻松游。少换区，较晚开始，每天保留休息、咖啡和用餐缓冲，减少奔波。',
    kind: 'relaxed',
    label: '轻松游',
    pace: 'relaxed',
  },
  {
    bestFor: '文化爱好者 / 二刷 / 体力较好',
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

export function buildAiTripDraftVariantComparisons(
  states: AiTripDraftVariantState[],
): AiTripDraftVariantComparison[] {
  return states.map((state) => ({
    bestFor: state.definition.bestFor,
    definition: state.definition,
    metrics: state.draft && state.status === 'success'
      ? buildAiTripDraftVariantComparisonMetrics(state.draft, state.definition)
      : undefined,
    status: state.status,
    statusText: variantStatusText(state),
  }))
}

export function buildAiTripDraftVariantMixDays(
  states: AiTripDraftVariantState[],
): AiTripDraftVariantMixDay[] {
  const successfulStates = states.filter((state) => state.status === 'success' && state.draft)
  const dates: string[] = []
  for (const state of successfulStates) {
    for (const day of state.draft!.days) {
      if (!dates.includes(day.date)) {
        dates.push(day.date)
      }
    }
  }

  return dates
    .sort()
    .map((date, dayIndex) => ({
      date,
      dayIndex,
      options: successfulStates
        .reduce<AiTripDraftVariantMixDayOption[]>((options, state) => {
          const day = state.draft!.days.find((candidate) => candidate.date === date)
          if (!day) return options
          const option: AiTripDraftVariantMixDayOption = {
            itemCount: day.items.length,
            kind: state.definition.kind,
            label: state.definition.label,
          }
          if (day.title) option.dayTitle = day.title
          options.push(option)
          return options
        }, []),
    }))
    .filter((day) => day.options.length > 0)
}

export function buildDefaultAiTripDraftVariantMixSelection(
  mixDays: AiTripDraftVariantMixDay[],
): AiTripDraftVariantMixSelection {
  return Object.fromEntries(
    mixDays
      .filter((day) => day.options.length > 0)
      .map((day) => [day.date, day.options[0].kind]),
  )
}

export function buildMixedAiTripDraftFromVariants({
  selection,
  states,
}: {
  selection: AiTripDraftVariantMixSelection
  states: AiTripDraftVariantState[]
}): AiTripDraftVariantMixResult {
  const mixDays = buildAiTripDraftVariantMixDays(states)
  if (mixDays.length === 0) {
    return { errors: ['没有可用于混合的已生成方案。'], ok: false }
  }

  const mixedDays: AiTripDraft['days'] = []
  const sourceLabels: string[] = []
  let rootDraft: AiTripDraft | undefined

  for (const mixDay of mixDays) {
    const selectedKind = selection[mixDay.date] ?? mixDay.options[0]?.kind
    const state = states.find((candidate) => candidate.definition.kind === selectedKind && candidate.status === 'success' && candidate.draft)
    const sourceDay = state?.draft?.days.find((day) => day.date === mixDay.date)
    if (!state || !sourceDay) {
      return {
        errors: [`${mixDay.date} 没有可用的来源方案。`],
        ok: false,
      }
    }

    rootDraft ??= state.draft
    mixedDays.push(cloneDraftDay(sourceDay))
    sourceLabels.push(`${state.definition.label}第 ${mixDay.dayIndex + 1} 天`)
  }

  if (!rootDraft) {
    return { errors: ['没有可用于混合的已生成方案。'], ok: false }
  }

  return {
    draft: {
      destination: rootDraft.destination,
      endDate: mixedDays[mixedDays.length - 1]?.date ?? rootDraft.endDate,
      startDate: mixedDays[0]?.date ?? rootDraft.startDate,
      title: `${rootDraft.destination || rootDraft.title}混合方案`,
      days: mixedDays,
    },
    ok: true,
    sourceLabels,
  }
}

export function getAiTripDraftVariantDefinition(kind: AiTripDraftVariantKind): AiTripDraftVariantDefinition {
  const definition = AI_TRIP_DRAFT_VARIANTS.find((candidate) => candidate.kind === kind)
  if (!definition) {
    throw new Error(`Unknown AI trip draft variant: ${kind}`)
  }
  return definition
}

function cloneDraftDay(day: AiTripDraft['days'][number]): AiTripDraft['days'][number] {
  const cloned: AiTripDraft['days'][number] = {
    date: day.date,
    items: day.items.map((item) => ({ ...item })),
  }
  if (day.tips) cloned.tips = [...day.tips]
  if (day.title) cloned.title = day.title
  return cloned
}

function buildAiTripDraftVariantComparisonMetrics(
  draft: AiTripDraft,
  definition: AiTripDraftVariantDefinition,
): NonNullable<AiTripDraftVariantComparison['metrics']> {
  const totalItems = draft.days.reduce((sum, day) => sum + day.items.length, 0)
  const dayCount = Math.max(draft.days.length, 1)
  const averagePerDay = roundToOne(totalItems / dayCount)
  return {
    dailyIntensity: calculateDailyIntensity(draft),
    paceLabel: paceLabel(definition.pace),
    spotCount: {
      averagePerDay,
      detail: `${totalItems} 个景点 · 约 ${formatNumber(averagePerDay)} 个/天`,
      total: totalItems,
    },
    transportComplexity: calculateTransportComplexity(draft),
  }
}

function calculateDailyIntensity(draft: AiTripDraft): NonNullable<AiTripDraftVariantComparison['metrics']>['dailyIntensity'] {
  const counts = draft.days.map((day) => day.items.length)
  const totalItems = counts.reduce((sum, count) => sum + count, 0)
  const average = counts.length > 0 ? totalItems / counts.length : 0
  const max = counts.length > 0 ? Math.max(...counts) : 0
  const detail = `约 ${formatNumber(roundToOne(average))} 个/天，单日最多 ${max} 个`

  if (average <= 3 && max <= 4) {
    return { detail, label: '轻松', level: 'light' }
  }
  if (average <= 5 && max <= 6) {
    return { detail, label: '适中', level: 'moderate' }
  }
  return { detail, label: '偏满', level: 'full' }
}

function calculateTransportComplexity(draft: AiTripDraft): NonNullable<AiTripDraftVariantComparison['metrics']>['transportComplexity'] {
  let segmentCount = 0
  let nonWalkSegments = 0
  let missingSegments = 0
  let longSegments = 0

  for (const day of draft.days) {
    day.items.forEach((item, index) => {
      if (index === 0) return
      segmentCount += 1
      if (!item.previousTransportMode && item.previousTransportDurationMinutes === undefined) {
        missingSegments += 1
      }
      if (item.previousTransportMode && item.previousTransportMode !== 'walk') {
        nonWalkSegments += 1
      }
      if (typeof item.previousTransportDurationMinutes === 'number' && item.previousTransportDurationMinutes >= 45) {
        longSegments += 1
      }
    })
  }

  if (segmentCount === 0) {
    return {
      detail: '行程点较少，交通判断简单',
      label: '简单',
      level: 'simple',
    }
  }

  const score = nonWalkSegments + missingSegments * 1.5 + longSegments
  const ratio = score / segmentCount
  const detail = missingSegments > 0
    ? `${nonWalkSegments} 段非步行，${longSegments} 段较长，${missingSegments} 段待补交通`
    : `${nonWalkSegments} 段非步行，${longSegments} 段较长，交通信息较完整`

  if (ratio <= 0.3) {
    return { detail, label: '简单', level: 'simple' }
  }
  if (ratio <= 0.8) {
    return { detail, label: '适中', level: 'moderate' }
  }
  return { detail, label: '复杂', level: 'complex' }
}

function paceLabel(pace: AiTripDraftVariantDefinition['pace']) {
  if (pace === 'relaxed') return '轻松'
  if (pace === 'compact') return '紧凑'
  return '适中'
}

function variantStatusText(state: AiTripDraftVariantState) {
  if (state.status === 'loading') return '生成中'
  if (state.status === 'success') return '已生成'
  if (state.status === 'error') return state.error ? '生成失败，可重新生成' : '生成失败'
  return '待生成'
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

function roundToOne(value: number) {
  return Math.round(value * 10) / 10
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
