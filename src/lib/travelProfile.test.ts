import { describe, expect, it } from 'vitest'
import {
  TRAVEL_PROFILE_STORAGE_KEY,
  defaultTravelProfile,
  getDenseDayItemLimit,
  getStoredTravelProfile,
  normalizeTravelProfile,
  saveTravelProfile,
} from './travelProfile'

function makeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('travel profile storage', () => {
  it('returns the default travel profile when nothing is stored', () => {
    expect(getStoredTravelProfile(makeStorage())).toEqual(defaultTravelProfile)
  })

  it('parses a valid stored travel profile', () => {
    const storage = makeStorage({
      [TRAVEL_PROFILE_STORAGE_KEY]: JSON.stringify({
        mealTimeProtection: false,
        morningStartAfter: '09:30',
        nightReturnBefore: '22:00',
        pace: 'relaxed',
        preferTransport: 'public_transport',
        reminderLevel: 'detailed',
      }),
    })

    expect(getStoredTravelProfile(storage)).toEqual({
      mealTimeProtection: false,
      morningStartAfter: '09:30',
      nightReturnBefore: '22:00',
      pace: 'relaxed',
      preferTransport: 'public_transport',
      reminderLevel: 'detailed',
    })
  })

  it('falls back safely when stored JSON is invalid', () => {
    const storage = makeStorage({ [TRAVEL_PROFILE_STORAGE_KEY]: '{broken' })
    expect(getStoredTravelProfile(storage)).toEqual(defaultTravelProfile)
  })

  it('falls back per invalid field without preserving invalid times', () => {
    expect(normalizeTravelProfile({
      mealTimeProtection: 'yes',
      morningStartAfter: '25:00',
      nightReturnBefore: '21:45',
      pace: 'fast',
      preferTransport: 'walking',
      reminderLevel: 'loud',
    })).toEqual({
      ...defaultTravelProfile,
      nightReturnBefore: '21:45',
      preferTransport: 'walking',
    })
  })

  it('saves a normalized travel profile', () => {
    const storage = makeStorage()
    saveTravelProfile({
      ...defaultTravelProfile,
      morningStartAfter: '08:15',
      pace: 'compact',
      reminderLevel: 'quiet',
    }, storage)

    expect(JSON.parse(storage.getItem(TRAVEL_PROFILE_STORAGE_KEY) ?? '{}')).toEqual({
      mealTimeProtection: true,
      morningStartAfter: '08:15',
      pace: 'compact',
      preferTransport: 'mixed',
      reminderLevel: 'quiet',
    })
  })

  it('derives conservative dense-day limits by pace', () => {
    expect(getDenseDayItemLimit({ pace: 'relaxed' })).toBe(5)
    expect(getDenseDayItemLimit({ pace: 'moderate' })).toBe(6)
    expect(getDenseDayItemLimit({ pace: 'compact' })).toBe(8)
    expect(getDenseDayItemLimit(undefined)).toBe(6)
  })
})
