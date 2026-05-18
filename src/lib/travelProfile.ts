export type TravelPace = 'relaxed' | 'moderate' | 'compact'
export type TravelTransportPreference = 'public_transport' | 'walking' | 'taxi' | 'mixed'
export type TravelReminderLevel = 'quiet' | 'normal' | 'detailed'

export type TravelProfile = {
  pace: TravelPace
  preferTransport: TravelTransportPreference
  mealTimeProtection: boolean
  morningStartAfter?: string
  nightReturnBefore?: string
  reminderLevel: TravelReminderLevel
}

type TravelProfileStorage = Pick<Storage, 'getItem' | 'setItem'>

export const TRAVEL_PROFILE_STORAGE_KEY = 'tripmap:travel-profile'

export const travelPaces: TravelPace[] = ['relaxed', 'moderate', 'compact']
export const travelTransportPreferences: TravelTransportPreference[] = [
  'public_transport',
  'walking',
  'taxi',
  'mixed',
]
export const travelReminderLevels: TravelReminderLevel[] = ['quiet', 'normal', 'detailed']

export const defaultTravelProfile: TravelProfile = {
  mealTimeProtection: true,
  pace: 'moderate',
  preferTransport: 'mixed',
  reminderLevel: 'normal',
}

const denseDayLimitsByPace: Record<TravelPace, number> = {
  compact: 8,
  moderate: 6,
  relaxed: 5,
}

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function isTravelPace(value: unknown): value is TravelPace {
  return typeof value === 'string' && travelPaces.includes(value as TravelPace)
}

export function isTravelTransportPreference(value: unknown): value is TravelTransportPreference {
  return typeof value === 'string' &&
    travelTransportPreferences.includes(value as TravelTransportPreference)
}

export function isTravelReminderLevel(value: unknown): value is TravelReminderLevel {
  return typeof value === 'string' && travelReminderLevels.includes(value as TravelReminderLevel)
}

export function isValidTravelProfileTime(value: unknown): value is string {
  return typeof value === 'string' && HH_MM_PATTERN.test(value.trim())
}

export function normalizeTravelProfile(value: unknown): TravelProfile {
  const source = isRecord(value) ? value : {}
  const morningStartAfter = normalizeOptionalTime(source.morningStartAfter)
  const nightReturnBefore = normalizeOptionalTime(source.nightReturnBefore)

  return {
    mealTimeProtection: typeof source.mealTimeProtection === 'boolean'
      ? source.mealTimeProtection
      : defaultTravelProfile.mealTimeProtection,
    pace: isTravelPace(source.pace) ? source.pace : defaultTravelProfile.pace,
    preferTransport: isTravelTransportPreference(source.preferTransport)
      ? source.preferTransport
      : defaultTravelProfile.preferTransport,
    reminderLevel: isTravelReminderLevel(source.reminderLevel)
      ? source.reminderLevel
      : defaultTravelProfile.reminderLevel,
    ...(morningStartAfter ? { morningStartAfter } : {}),
    ...(nightReturnBefore ? { nightReturnBefore } : {}),
  }
}

export function parseTravelProfileJson(value: string | null): TravelProfile {
  if (!value) {
    return defaultTravelProfile
  }

  try {
    return normalizeTravelProfile(JSON.parse(value))
  } catch {
    return defaultTravelProfile
  }
}

export function getStoredTravelProfile(
  storage: TravelProfileStorage | undefined = getLocalStorage(),
): TravelProfile {
  if (!storage) {
    return defaultTravelProfile
  }

  try {
    return parseTravelProfileJson(storage.getItem(TRAVEL_PROFILE_STORAGE_KEY))
  } catch {
    return defaultTravelProfile
  }
}

export function saveTravelProfile(
  profile: TravelProfile,
  storage: TravelProfileStorage | undefined = getLocalStorage(),
) {
  if (!storage) {
    return
  }

  try {
    storage.setItem(TRAVEL_PROFILE_STORAGE_KEY, JSON.stringify(normalizeTravelProfile(profile)))
  } catch {
    // Storage can be unavailable in private or restricted contexts.
  }
}

export function getDenseDayItemLimit(profile: Pick<TravelProfile, 'pace'> | undefined = defaultTravelProfile) {
  return denseDayLimitsByPace[profile?.pace && isTravelPace(profile.pace) ? profile.pace : defaultTravelProfile.pace]
}

function normalizeOptionalTime(value: unknown) {
  return isValidTravelProfileTime(value) ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getLocalStorage() {
  if (typeof window === 'undefined') {
    return undefined
  }
  return window.localStorage
}
