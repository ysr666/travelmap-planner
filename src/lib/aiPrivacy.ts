export type AiPrivacySettings = {
  allowItineraryBasics: boolean
  allowLocationText: boolean
  allowCoordinateState: boolean
  allowTransportInfo: boolean
  allowTicketMetadata: boolean
  allowTicketFileNames: boolean
  allowNotesSummary: boolean
  allowFullNotes: boolean
  allowTicketFileContent: boolean
  allowCloudSyncStatus: boolean
}

type AiPrivacyStorage = Pick<Storage, 'getItem' | 'setItem'>

export const AI_PRIVACY_STORAGE_KEY = 'tripmap:ai-privacy'

export const aiPrivacySettingKeys: Array<keyof AiPrivacySettings> = [
  'allowItineraryBasics',
  'allowLocationText',
  'allowCoordinateState',
  'allowTransportInfo',
  'allowTicketMetadata',
  'allowTicketFileNames',
  'allowNotesSummary',
  'allowFullNotes',
  'allowTicketFileContent',
  'allowCloudSyncStatus',
]

export const defaultAiPrivacySettings: AiPrivacySettings = {
  allowCloudSyncStatus: false,
  allowCoordinateState: false,
  allowFullNotes: false,
  allowItineraryBasics: false,
  allowLocationText: false,
  allowNotesSummary: false,
  allowTicketFileContent: false,
  allowTicketFileNames: false,
  allowTicketMetadata: false,
  allowTransportInfo: false,
}

export function normalizeAiPrivacySettings(value: unknown): AiPrivacySettings {
  const source = isRecord(value) ? value : {}
  const settings = { ...defaultAiPrivacySettings }

  for (const key of aiPrivacySettingKeys) {
    if (key === 'allowTicketFileContent') {
      continue
    }
    if (typeof source[key] === 'boolean') {
      settings[key] = source[key]
    }
  }

  return settings
}

export function parseAiPrivacyJson(value: string | null): AiPrivacySettings {
  if (!value) {
    return defaultAiPrivacySettings
  }

  try {
    return normalizeAiPrivacySettings(JSON.parse(value))
  } catch {
    return defaultAiPrivacySettings
  }
}

export function getStoredAiPrivacySettings(
  storage: AiPrivacyStorage | undefined = getLocalStorage(),
): AiPrivacySettings {
  if (!storage) {
    return defaultAiPrivacySettings
  }

  try {
    return parseAiPrivacyJson(storage.getItem(AI_PRIVACY_STORAGE_KEY))
  } catch {
    return defaultAiPrivacySettings
  }
}

export function saveAiPrivacySettings(
  settings: AiPrivacySettings,
  storage: AiPrivacyStorage | undefined = getLocalStorage(),
) {
  if (!storage) {
    return
  }

  try {
    storage.setItem(AI_PRIVACY_STORAGE_KEY, JSON.stringify(normalizeAiPrivacySettings(settings)))
  } catch {
    // Storage can be unavailable in private or restricted contexts.
  }
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
