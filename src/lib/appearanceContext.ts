import { createContext, useContext } from 'react'
import type { AppearanceMode, ResolvedAppearance } from './appearance'

export type AppearanceContextValue = {
  mode: AppearanceMode
  resolvedMode: ResolvedAppearance
  setMode: (mode: AppearanceMode) => void
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export function useAppearance() {
  const context = useContext(AppearanceContext)
  if (!context) {
    throw new Error('useAppearance must be used within AppearanceProvider')
  }
  return context
}
