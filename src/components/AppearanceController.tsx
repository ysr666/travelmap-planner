import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  APPEARANCE_CHANGED_EVENT,
  APPEARANCE_STORAGE_KEY,
  applyResolvedAppearance,
  getStoredAppearanceMode,
  getSystemPrefersDark,
  resolveAppearanceMode,
  saveAppearanceMode,
  type AppearanceMode,
} from '../lib/appearance'
import { AppearanceContext } from '../lib/appearanceContext'

type MediaQueryListWithLegacyEvents = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppearanceMode>(() => getStoredAppearanceMode())
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => getSystemPrefersDark())
  const resolvedMode = resolveAppearanceMode(mode, systemPrefersDark)

  useEffect(() => {
    applyResolvedAppearance(resolvedMode)
  }, [resolvedMode])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const media: MediaQueryListWithLegacyEvents = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => setSystemPrefersDark(media.matches)
    handleChange()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange)
      return () => media.removeEventListener('change', handleChange)
    }

    media.addListener?.(handleChange)
    return () => media.removeListener?.(handleChange)
  }, [])

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === APPEARANCE_STORAGE_KEY) {
        setModeState(getStoredAppearanceMode())
      }
    }

    function handleLocalChange() {
      setModeState(getStoredAppearanceMode())
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(APPEARANCE_CHANGED_EVENT, handleLocalChange)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(APPEARANCE_CHANGED_EVENT, handleLocalChange)
    }
  }, [])

  const setMode = useCallback((nextMode: AppearanceMode) => {
    saveAppearanceMode(nextMode)
    setModeState(nextMode)
    window.dispatchEvent(new Event(APPEARANCE_CHANGED_EVENT))
  }, [])

  const value = useMemo(
    () => ({
      mode,
      resolvedMode,
      setMode,
    }),
    [mode, resolvedMode, setMode],
  )

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  )
}
