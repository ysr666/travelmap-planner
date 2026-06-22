import type { TravelPace, TravelTransportPreference } from '../travelProfile'
import { isTravelPace, isTravelTransportPreference } from '../travelProfile'
import { isValidPlainDate, listPlainDateRangeInclusive } from '../plainDate'
import { addPlainDateDays } from '../timeSemantics'

export type AiTripDraftRequest = {
  dayCount?: number
  destination: string
  startDate: string
  endDate: string
  partySize?: number
  interestTags?: string[]
  interestText?: string
  pace?: TravelPace
  preferTransport?: TravelTransportPreference
  mealTimeProtection?: boolean
  mustVisitText?: string
  avoidText?: string
  freeTextRequirement?: string
}

export type AiTripDraftRequestValidationError = {
  path: string
  message: string
}

export type AiTripDraftRequestValidationResult = {
  valid: boolean
  errors: AiTripDraftRequestValidationError[]
  request?: AiTripDraftRequest
}

// Request-side constants matching aiTripDraft.ts limits
const MAX_DESTINATION_LENGTH = 200
const MAX_FREE_TEXT_LENGTH = 2000
const MAX_DAYS = 120
const MAX_PARTY_SIZE = 99
const MAX_INTEREST_TAGS = 12
const MAX_INTEREST_TAG_LENGTH = 40

export function buildAiTripDraftRequest(
  input: unknown,
  defaults?: { pace?: TravelPace; preferTransport?: TravelTransportPreference },
): AiTripDraftRequest {
  const source = isRecord(input) ? input : {}

  const startDate = typeof source.startDate === 'string' ? source.startDate.trim() : ''
  const dayCount = normalizeNumberInput(source.dayCount)
  const endDate = typeof source.endDate === 'string' && source.endDate.trim()
    ? source.endDate.trim()
    : calculateEndDateFromDayCount(startDate, dayCount)

  return {
    dayCount,
    destination: typeof source.destination === 'string' ? source.destination.trim() : '',
    startDate,
    endDate,
    partySize: normalizeNumberInput(source.partySize),
    interestTags: normalizeInterestTags(source.interestTags),
    interestText: normalizeOptionalText(source.interestText),
    pace: isTravelPace(source.pace)
      ? source.pace
      : (isTravelPace(defaults?.pace) ? defaults.pace : undefined),
    preferTransport: isTravelTransportPreference(source.preferTransport)
      ? source.preferTransport
      : (isTravelTransportPreference(defaults?.preferTransport) ? defaults.preferTransport : undefined),
    mealTimeProtection: typeof source.mealTimeProtection === 'boolean'
      ? source.mealTimeProtection
      : undefined,
    mustVisitText: normalizeOptionalText(source.mustVisitText),
    avoidText: normalizeOptionalText(source.avoidText),
    freeTextRequirement: normalizeOptionalText(source.freeTextRequirement),
  }
}

export function validateAiTripDraftRequest(
  request: AiTripDraftRequest,
): AiTripDraftRequestValidationResult {
  const errors: AiTripDraftRequestValidationError[] = []

  if (!request.destination || request.destination.length === 0) {
    errors.push({ path: 'destination', message: '请输入目的地。' })
  } else if (request.destination.length > MAX_DESTINATION_LENGTH) {
    errors.push({ path: 'destination', message: `目的地不能超过 ${MAX_DESTINATION_LENGTH} 个字符。` })
  }

  if (!request.startDate) {
    errors.push({ path: 'startDate', message: '请输入开始日期。' })
  } else if (!isValidPlainDate(request.startDate)) {
    errors.push({ path: 'startDate', message: '开始日期格式无效，请使用 YYYY-MM-DD。' })
  }

  if (!request.endDate) {
    errors.push({ path: 'endDate', message: '请输入结束日期。' })
  } else if (!isValidPlainDate(request.endDate)) {
    errors.push({ path: 'endDate', message: '结束日期格式无效，请使用 YYYY-MM-DD。' })
  }

  if (isValidPlainDate(request.startDate) && isValidPlainDate(request.endDate)) {
    const dates = listPlainDateRangeInclusive(request.startDate, request.endDate)
    if (request.endDate < request.startDate) {
      errors.push({ path: 'endDate', message: '结束日期不能早于开始日期。' })
    } else {
      if (dates.length > MAX_DAYS) {
        errors.push({ path: 'endDate', message: `行程天数不能超过 ${MAX_DAYS} 天。` })
      }
    }
    if (request.dayCount !== undefined && dates.length > 0 && request.dayCount !== dates.length) {
      errors.push({ path: 'dayCount', message: '天数需要和日期范围一致。' })
    }
  }

  if (request.dayCount !== undefined && (!Number.isInteger(request.dayCount) || request.dayCount < 1 || request.dayCount > MAX_DAYS)) {
    errors.push({ path: 'dayCount', message: `天数必须是 1 到 ${MAX_DAYS} 之间的整数。` })
  }

  if (request.partySize !== undefined && (!Number.isInteger(request.partySize) || request.partySize < 1 || request.partySize > MAX_PARTY_SIZE)) {
    errors.push({ path: 'partySize', message: `同行人数必须是 1 到 ${MAX_PARTY_SIZE} 之间的整数。` })
  }

  if (request.interestTags !== undefined) {
    if (!Array.isArray(request.interestTags)) {
      errors.push({ path: 'interestTags', message: '兴趣标签必须是数组。' })
    } else if (request.interestTags.length > MAX_INTEREST_TAGS) {
      errors.push({ path: 'interestTags', message: `兴趣标签不能超过 ${MAX_INTEREST_TAGS} 个。` })
    } else if (request.interestTags.some((tag) => typeof tag !== 'string' || tag.trim().length === 0 || tag.trim().length > MAX_INTEREST_TAG_LENGTH)) {
      errors.push({ path: 'interestTags', message: `每个兴趣标签必须为 1 到 ${MAX_INTEREST_TAG_LENGTH} 个字符。` })
    }
  }

  if (request.interestText !== undefined && request.interestText.length > MAX_FREE_TEXT_LENGTH) {
    errors.push({ path: 'interestText', message: `"兴趣偏好"不能超过 ${MAX_FREE_TEXT_LENGTH} 个字符。` })
  }

  if (request.pace !== undefined && !isTravelPace(request.pace)) {
    errors.push({ path: 'pace', message: '无效的旅行节奏。' })
  }

  if (request.preferTransport !== undefined && !isTravelTransportPreference(request.preferTransport)) {
    errors.push({ path: 'preferTransport', message: '无效的交通偏好。' })
  }

  if (request.mustVisitText !== undefined && request.mustVisitText.length > MAX_FREE_TEXT_LENGTH) {
    errors.push({ path: 'mustVisitText', message: `"想去的地方"不能超过 ${MAX_FREE_TEXT_LENGTH} 个字符。` })
  }

  if (request.avoidText !== undefined && request.avoidText.length > MAX_FREE_TEXT_LENGTH) {
    errors.push({ path: 'avoidText', message: `"不想要的安排"不能超过 ${MAX_FREE_TEXT_LENGTH} 个字符。` })
  }

  if (request.freeTextRequirement !== undefined && request.freeTextRequirement.length > MAX_FREE_TEXT_LENGTH) {
    errors.push({ path: 'freeTextRequirement', message: `"补充要求"不能超过 ${MAX_FREE_TEXT_LENGTH} 个字符。` })
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return { valid: true, errors: [], request }
}

export function summarizeAiTripDraftRequest(request: AiTripDraftRequest): string {
  const dates = isValidPlainDate(request.startDate) && isValidPlainDate(request.endDate)
    ? listPlainDateRangeInclusive(request.startDate, request.endDate)
    : []
  const daysText = dates.length > 0 ? `${dates.length}天` : '日期待定'
  const partyText = request.partySize ? ` · ${request.partySize}人` : ''
  return `${request.destination} · ${request.startDate} ~ ${request.endDate} · ${daysText}${partyText}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeNumberInput(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeInterestTags(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，、\n]/)
      : []
  const tags = Array.from(new Set(
    raw
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean),
  ))
  return tags.length > 0 ? tags : undefined
}

export function calculateEndDateFromDayCount(startDate: string, dayCount?: number) {
  if (!isValidPlainDate(startDate) || !Number.isInteger(dayCount) || !dayCount || dayCount < 1) {
    return ''
  }
  return addPlainDateDays(startDate, dayCount - 1) ?? ''
}
