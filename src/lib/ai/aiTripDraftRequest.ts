import type { TravelPace, TravelTransportPreference } from './travelProfile'
import { isTravelPace, isTravelTransportPreference } from './travelProfile'
import { isValidPlainDate, listPlainDateRangeInclusive } from './plainDate'

export type AiTripDraftRequest = {
  destination: string
  startDate: string
  endDate: string
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

export function buildAiTripDraftRequest(
  input: unknown,
  defaults?: { pace?: TravelPace; preferTransport?: TravelTransportPreference },
): AiTripDraftRequest {
  const source = isRecord(input) ? input : {}

  return {
    destination: typeof source.destination === 'string' ? source.destination.trim() : '',
    startDate: typeof source.startDate === 'string' ? source.startDate.trim() : '',
    endDate: typeof source.endDate === 'string' ? source.endDate.trim() : '',
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
    if (request.endDate < request.startDate) {
      errors.push({ path: 'endDate', message: '结束日期不能早于开始日期。' })
    } else {
      const dates = listPlainDateRangeInclusive(request.startDate, request.endDate)
      if (dates.length > MAX_DAYS) {
        errors.push({ path: 'endDate', message: `行程天数不能超过 ${MAX_DAYS} 天。` })
      }
    }
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
  return `${request.destination} · ${request.startDate} ~ ${request.endDate} · ${daysText}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
