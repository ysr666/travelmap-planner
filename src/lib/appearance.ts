export type AppearanceMode = 'system' | 'light' | 'dark'
export type ResolvedAppearance = 'light' | 'dark'

export const APPEARANCE_STORAGE_KEY = 'tripmap:appearance'
export const APPEARANCE_CHANGED_EVENT = 'tripmap:appearance-changed'

type AppearanceStorage = Pick<Storage, 'getItem' | 'setItem'>

const APPEARANCE_MODES: AppearanceMode[] = ['system', 'light', 'dark']
const LIGHT_THEME_COLOR = '#eef3f8'
const DARK_THEME_COLOR = '#101827'

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return typeof value === 'string' && APPEARANCE_MODES.includes(value as AppearanceMode)
}

export function normalizeAppearanceMode(value: unknown): AppearanceMode {
  return isAppearanceMode(value) ? value : 'system'
}

export function getStoredAppearanceMode(storage: AppearanceStorage | undefined = getLocalStorage()): AppearanceMode {
  if (!storage) {
    return 'system'
  }

  try {
    return normalizeAppearanceMode(storage.getItem(APPEARANCE_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function saveAppearanceMode(
  mode: AppearanceMode,
  storage: AppearanceStorage | undefined = getLocalStorage(),
) {
  if (!storage) {
    return
  }

  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, mode)
  } catch {
    // Storage can be unavailable in private or restricted contexts.
  }
}

export function resolveAppearanceMode(
  mode: AppearanceMode,
  systemPrefersDark: boolean,
): ResolvedAppearance {
  if (mode === 'dark') {
    return 'dark'
  }
  if (mode === 'light') {
    return 'light'
  }
  return systemPrefersDark ? 'dark' : 'light'
}

export function getSystemPrefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyResolvedAppearance(
  resolvedMode: ResolvedAppearance,
  root: HTMLElement | undefined = getDocumentElement(),
) {
  if (!root) {
    return
  }

  const isDark = resolvedMode === 'dark'
  root.classList.toggle('dark', isDark)
  root.style.colorScheme = resolvedMode
  updateThemeColor(isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
}

export function applyStoredAppearance() {
  const mode = getStoredAppearanceMode()
  applyResolvedAppearance(resolveAppearanceMode(mode, getSystemPrefersDark()))
}

function updateThemeColor(color: string) {
  if (typeof document === 'undefined') {
    return
  }

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) {
    meta.content = color
  }
}

function getLocalStorage() {
  if (typeof window === 'undefined') {
    return undefined
  }
  return window.localStorage
}

function getDocumentElement() {
  if (typeof document === 'undefined') {
    return undefined
  }
  return document.documentElement
}
