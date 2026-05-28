import { describe, expect, it } from 'vitest'
import {
  AI_PRIVACY_STORAGE_KEY,
  defaultAiPrivacySettings,
  getStoredAiPrivacySettings,
  normalizeAiPrivacySettings,
  saveAiPrivacySettings,
} from './aiPrivacy'

function makeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('AI privacy storage', () => {
  it('returns conservative defaults when nothing is stored', () => {
    expect(getStoredAiPrivacySettings(makeStorage())).toEqual(defaultAiPrivacySettings)
    expect(Object.values(defaultAiPrivacySettings).every((value) => value === false)).toBe(true)
  })

  it('parses valid stored privacy settings', () => {
    const storage = makeStorage({
      [AI_PRIVACY_STORAGE_KEY]: JSON.stringify({
      allowCoordinateState: true,
      allowFullNotes: true,
      allowItineraryBasics: true,
      allowTicketFileContent: true,
      allowTicketFileNames: true,
      }),
    })

    expect(getStoredAiPrivacySettings(storage)).toEqual({
      ...defaultAiPrivacySettings,
      allowCoordinateState: true,
      allowFullNotes: true,
      allowItineraryBasics: true,
      allowTicketFileNames: true,
    })
  })

  it('falls back safely when stored JSON is invalid', () => {
    const storage = makeStorage({ [AI_PRIVACY_STORAGE_KEY]: '{broken' })
    expect(getStoredAiPrivacySettings(storage)).toEqual(defaultAiPrivacySettings)
  })

  it('ignores non-boolean stored values', () => {
    expect(normalizeAiPrivacySettings({
      allowCloudSyncStatus: true,
      allowFullNotes: 'true',
      allowItineraryBasics: true,
      allowTicketFileContent: 1,
    })).toEqual({
      ...defaultAiPrivacySettings,
      allowCloudSyncStatus: true,
      allowItineraryBasics: true,
    })
  })

  it('keeps ticket file content disabled even if storage is manually edited', () => {
    expect(normalizeAiPrivacySettings({
      allowTicketFileContent: true,
    })).toEqual(defaultAiPrivacySettings)
  })

  it('saves normalized privacy settings', () => {
    const storage = makeStorage()
    saveAiPrivacySettings({
      ...defaultAiPrivacySettings,
      allowItineraryBasics: true,
      allowTicketMetadata: true,
    }, storage)

    expect(JSON.parse(storage.getItem(AI_PRIVACY_STORAGE_KEY) ?? '{}')).toEqual({
      ...defaultAiPrivacySettings,
      allowItineraryBasics: true,
      allowTicketMetadata: true,
    })
  })
})
