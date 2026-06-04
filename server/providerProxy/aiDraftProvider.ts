export {
  createOpenAiCompatibleAiDraftProvider,
  createOpenAiCompatibleAiDraftRepairProvider,
  createOpenAiCompatibleAiDraftRefineProvider,
} from './aiDraftRealProvider'

import type { AiTripDraft, AiTripDraftDay } from '../../src/lib/ai/aiTripDraft'
import { validateAiTripDraft } from '../../src/lib/ai/aiTripDraft'
import { generateMockAiTripDraft } from '../../src/lib/ai/aiTripDraftMock'
import {
  buildMockAiTripDraftRefineProxyResponse,
  type ProviderProxyAiTripDraftRequest,
  type ProviderProxyAiTripDraftRepairRequest,
  type ProviderProxyAiTripDraftRefineRequest,
} from '../../src/lib/ai/providerProxyContract'
import type { AiDraftProviderInput } from './aiDraftPrompt'

export type AiDraftProviderErrorCode =
  | 'provider_unavailable'
  | 'quota_exceeded'
  | 'provider_error'
  | 'network_error'
  | 'unsupported'

export type AiDraftUsage = {
  promptTokens?: number
  completionTokens?: number
}

export type AiDraftProviderResult =
  | { ok: true; kind: 'raw'; rawText: string; usage?: AiDraftUsage }
  | { ok: true; kind: 'draft'; draft: AiTripDraft; source: 'mock'; warnings?: string[] }
  | { ok: false; errorCode: AiDraftProviderErrorCode; message?: string }

export type AiDraftProvider = {
  readonly name: string
  generateDraft(input: AiDraftProviderInput): Promise<AiDraftProviderResult>
}

export type AiDraftRepairProvider = {
  readonly name: string
  repairDraft(input: AiDraftProviderInput): Promise<AiDraftProviderResult>
}

export type AiDraftRefineProvider = {
  readonly name: string
  refineDraft(input: AiDraftProviderInput): Promise<AiDraftProviderResult>
}

export function createDisabledAiDraftProvider(): AiDraftProvider {
  return {
    name: 'disabled',
    async generateDraft() {
      return { ok: false, errorCode: 'unsupported', message: 'AI draft generation is not currently available.' }
    },
  }
}

export function createUnavailableAiDraftProvider(): AiDraftProvider {
  return {
    name: 'unavailable',
    async generateDraft() {
      return { ok: false, errorCode: 'provider_unavailable', message: 'AI draft provider is not configured.' }
    },
  }
}

export function createMockAiDraftProvider(request: ProviderProxyAiTripDraftRequest): AiDraftProvider {
  return {
    name: 'mock',
    async generateDraft() {
      const draft = generateMockAiTripDraft({
        dayCount: request.dayCount,
        destination: request.destination,
        endDate: request.endDate,
        freeTextRequirement: request.freeTextRequirement,
        interestTags: request.interestTags,
        interestText: request.interestText,
        mealTimeProtection: request.mealTimeProtection,
        mustVisitText: request.mustVisitText,
        avoidText: request.avoidText,
        partySize: request.partySize,
        pace: request.pace,
        preferTransport: request.preferTransport,
        startDate: request.startDate,
      })
      return {
        draft,
        kind: 'draft',
        ok: true,
        source: 'mock',
        warnings: ['当前为本地示例草稿，非真实 AI 生成。'],
      }
    },
  }
}

export function createDisabledAiDraftRepairProvider(): AiDraftRepairProvider {
  return {
    name: 'disabled',
    async repairDraft() {
      return { ok: false, errorCode: 'unsupported', message: 'AI draft repair is not currently available.' }
    },
  }
}

export function createUnavailableAiDraftRepairProvider(): AiDraftRepairProvider {
  return {
    name: 'unavailable',
    async repairDraft() {
      return { ok: false, errorCode: 'provider_unavailable', message: 'AI draft repair provider is not configured.' }
    },
  }
}

export function createMockAiDraftRepairProvider(request: ProviderProxyAiTripDraftRepairRequest): AiDraftRepairProvider {
  return {
    name: 'mock',
    async repairDraft() {
      const repaired = mockRepairDraft(request.draft, request.qualityFindings.map((f) => f.ruleId))
      const validation = validateAiTripDraft(repaired)
      if (!validation.valid || !validation.draft) {
        return { ok: false, errorCode: 'provider_error', message: 'Mock repair produced invalid draft.' }
      }
      return {
        draft: validation.draft,
        kind: 'draft',
        ok: true,
        source: 'mock',
        warnings: ['当前为本地示例修复，非真实 AI 修复。'],
      }
    },
  }
}

export function createDisabledAiDraftRefineProvider(): AiDraftRefineProvider {
  return {
    name: 'disabled',
    async refineDraft() {
      return { ok: false, errorCode: 'unsupported', message: 'AI draft refinement is not currently available.' }
    },
  }
}

export function createUnavailableAiDraftRefineProvider(): AiDraftRefineProvider {
  return {
    name: 'unavailable',
    async refineDraft() {
      return { ok: false, errorCode: 'provider_unavailable', message: 'AI draft refinement provider is not configured.' }
    },
  }
}

export function createMockAiDraftRefineProvider(request: ProviderProxyAiTripDraftRefineRequest): AiDraftRefineProvider {
  return {
    name: 'mock',
    async refineDraft() {
      const response = buildMockAiTripDraftRefineProxyResponse(request)
      const validation = validateAiTripDraft(response.draft)
      if (!validation.valid || !validation.draft) {
        return { ok: false, errorCode: 'provider_error', message: 'Mock refinement produced invalid draft.' }
      }
      return {
        draft: validation.draft,
        kind: 'draft',
        ok: true,
        source: 'mock',
        warnings: response.warnings,
      }
    },
  }
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

const MEAL_KEYWORDS = ['午餐', '晚餐', '早餐', '餐', '用餐', '吃饭', 'lunch', 'dinner', 'breakfast', 'meal']

function hasMealInWindow(items: AiTripDraftDay['items'], startMin: number, endMin: number): boolean {
  return items.some((item) => {
    if (!item.startTime) return false
    const t = timeToMinutes(item.startTime)
    if (t < startMin || t > endMin) return false
    return MEAL_KEYWORDS.some((k) => item.title.toLowerCase().includes(k.toLowerCase()))
  })
}

function mockRepairDraft(draft: AiTripDraft, ruleIds: string[]): AiTripDraft {
  const needsDenseFix = ruleIds.includes('dense_day') || ruleIds.includes('long_day_span')
  const needsDuplicateFix = ruleIds.includes('duplicate_sight')
  const needsLocationFix = ruleIds.includes('missing_location')
  const needsMealFix = ruleIds.includes('meal_gap')
  const needsGenericFix = ruleIds.includes('generic_title')
  const needsTimeFix = ruleIds.includes('time_overlap') || ruleIds.includes('short_gap')
  const needsTransportFix = ruleIds.includes('missing_transport') || ruleIds.includes('unreasonable_transport')

  const repairedDays = draft.days.map((day) => {
    let items = [...day.items]

    if (needsDenseFix && items.length > 6) {
      items = items.slice(0, 6)
    }

    if (needsTimeFix || needsDenseFix) {
      items = normalizeMockTiming(items)
    }

    if (needsLocationFix) {
      items = items.map((item) => item.locationName || item.address
        ? item
        : { ...item, locationName: item.title })
    }

    // Add meal items if missing
    if (needsMealFix) {
      if (!hasMealInWindow(items, 690, 810)) {
        // No lunch item between 11:30-13:30
        const lunchItem = {
          title: '午餐休息',
          startTime: '12:00',
          endTime: '13:00',
        }
        // Insert after the last item ending before 12:00
        const insertIdx = items.findIndex((item) => item.startTime && timeToMinutes(item.startTime) >= 720)
        if (insertIdx >= 0) {
          items.splice(insertIdx, 0, lunchItem)
        } else {
          items.push(lunchItem)
        }
      }
      if (!hasMealInWindow(items, 1050, 1170)) {
        // No dinner item between 17:30-19:30
        const dinnerItem = {
          title: '晚餐休息',
          startTime: '18:00',
          endTime: '19:00',
        }
        const insertIdx = items.findIndex((item) => item.startTime && timeToMinutes(item.startTime) >= 1080)
        if (insertIdx >= 0) {
          items.splice(insertIdx, 0, dinnerItem)
        } else {
          items.push(dinnerItem)
        }
      }
    }

    // Replace generic titles if needed
    if (needsGenericFix) {
      let genericCount = 0
      items = items.map((item) => {
        if (isGenericTitle(item.title)) {
          genericCount++
          return { ...item, title: `${day.date} 休闲活动 ${genericCount}` }
        }
        return item
      })
    }

    if (needsTransportFix) {
      items = items.map((item, index) => {
        if (index === 0) return item
        const duration = item.previousTransportDurationMinutes
        if (!item.previousTransportMode) {
          return {
            ...item,
            previousTransportDurationMinutes: duration ?? 20,
            previousTransportMode: 'transit',
            previousTransportNote: item.previousTransportNote ?? '已补充为公共交通建议，导入后可生成路线预览核对。',
          }
        }
        if (duration !== undefined && duration <= 0) {
          return {
            ...item,
            previousTransportDurationMinutes: 20,
            previousTransportNote: '已重新估算交通耗时，导入后可生成路线预览核对。',
          }
        }
        if (item.previousTransportMode === 'walk' && duration !== undefined && duration > 60) {
          return {
            ...item,
            previousTransportDurationMinutes: 35,
            previousTransportMode: 'transit',
            previousTransportNote: '步行时间偏长，已改为公共交通建议。',
          }
        }
        return item
      })
    }

    return { ...day, items }
  })

  return needsDuplicateFix
    ? { ...draft, days: dedupeMockSights(repairedDays) }
    : { ...draft, days: repairedDays }
}

function normalizeMockTiming(items: AiTripDraftDay['items']): AiTripDraftDay['items'] {
  let startMinutes = 9 * 60
  return items.map((item, index) => {
    const startTime = minutesToTime(startMinutes)
    const endTime = minutesToTime(startMinutes + (index === 0 ? 90 : 75))
    startMinutes += index === 0 ? 135 : 120
    return { ...item, endTime, startTime }
  })
}

function minutesToTime(value: number): string {
  const normalized = Math.max(0, Math.min(value, 23 * 60 + 59))
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function dedupeMockSights(days: AiTripDraftDay[]): AiTripDraftDay[] {
  const seen = new Set<string>()
  return days.map((day) => ({
    ...day,
    items: day.items.map((item, index) => {
      const key = normalizeMockSightKey(item.locationName || item.address || item.title)
      if (!key || !seen.has(key)) {
        if (key) seen.add(key)
        return item
      }
      const replacement = `${item.title} 替代点 ${index + 1}`
      seen.add(normalizeMockSightKey(replacement))
      return {
        ...item,
        locationName: replacement,
        title: replacement,
      }
    }),
  }))
}

function normalizeMockSightKey(value?: string): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s+/g, '')
    .replace(/[·・.,，。:：;；'"“”‘’]/g, '')
}

const GENERIC_TITLES = [
  '景点参观',
  '自由活动',
  '上午游览',
  '下午参观',
  '上午参观',
  '下午游览',
  '景点游览',
  '景区游览',
  '自由游览',
  '自由参观',
  '观光游览',
  '景点活动',
]

function isGenericTitle(title: string): boolean {
  return GENERIC_TITLES.some((p) => title === p)
}
