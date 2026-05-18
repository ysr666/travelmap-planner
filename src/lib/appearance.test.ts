import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_STORAGE_KEY,
  getStoredAppearanceMode,
  normalizeAppearanceMode,
  resolveAppearanceMode,
  saveAppearanceMode,
} from './appearance'

function createMemoryStorage(initialValue: string | null = null) {
  let storedValue = initialValue
  return {
    getItem: (key: string) => (key === APPEARANCE_STORAGE_KEY ? storedValue : null),
    setItem: (key: string, value: string) => {
      if (key === APPEARANCE_STORAGE_KEY) {
        storedValue = value
      }
    },
    value: () => storedValue,
  }
}

describe('appearance helpers', () => {
  it('resolves explicit and system appearance modes', () => {
    expect(resolveAppearanceMode('light', true)).toBe('light')
    expect(resolveAppearanceMode('dark', false)).toBe('dark')
    expect(resolveAppearanceMode('system', true)).toBe('dark')
    expect(resolveAppearanceMode('system', false)).toBe('light')
  })

  it('falls back to system for missing or invalid stored values', () => {
    expect(normalizeAppearanceMode(null)).toBe('system')
    expect(normalizeAppearanceMode('sepia')).toBe('system')
    expect(getStoredAppearanceMode(createMemoryStorage('sepia'))).toBe('system')
    expect(getStoredAppearanceMode(undefined)).toBe('system')
  })

  it('reads and saves valid appearance modes in storage', () => {
    const storage = createMemoryStorage('dark')
    expect(getStoredAppearanceMode(storage)).toBe('dark')

    saveAppearanceMode('light', storage)
    expect(storage.value()).toBe('light')
    expect(getStoredAppearanceMode(storage)).toBe('light')
  })

  it('uses system mode when localStorage access fails', () => {
    const storage = {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('storage disabled')
      },
    }

    expect(getStoredAppearanceMode(storage)).toBe('system')
    expect(() => saveAppearanceMode('dark', storage)).not.toThrow()
  })
})
