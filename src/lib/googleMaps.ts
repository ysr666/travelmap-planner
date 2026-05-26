const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-js-api'
const GOOGLE_MAPS_CALLBACK_NAME = '__googleMapsInitCallback'

const GOOGLE_MAPS_STORAGE_KEY = 'tripmap:google-maps-api-key'
const GOOGLE_MAPS_CONFIG_CHANGED_EVENT = 'tripmap:google-maps-config-changed'

let loadPromise: Promise<boolean> | null = null

export function getGoogleMapsApiKey(options: { env?: Partial<ImportMetaEnv>; storage?: Storage | null } = {}): string {
  const storage = options.storage ?? getBrowserStorage()
  const env = options.env ?? readGoogleMapsEnv()
  const localKey = storage?.getItem(GOOGLE_MAPS_STORAGE_KEY)?.trim() || ''
  const envKey = env.VITE_GOOGLE_MAPS_API_KEY?.trim() || ''
  return localKey || envKey || ''
}

export function isGoogleMapsConfigured(options: { env?: Partial<ImportMetaEnv>; storage?: Storage | null } = {}): boolean {
  return Boolean(getGoogleMapsApiKey(options))
}

export function saveGoogleMapsApiKey(apiKey: string, storage = getBrowserStorage()) {
  const trimmed = apiKey.trim()
  if (!storage) {
    return
  }

  if (trimmed) {
    storage.setItem(GOOGLE_MAPS_STORAGE_KEY, trimmed)
  } else {
    storage.removeItem(GOOGLE_MAPS_STORAGE_KEY)
  }

  dispatchConfigChanged()
}

export function clearGoogleMapsApiKey(storage = getBrowserStorage()) {
  storage?.removeItem(GOOGLE_MAPS_STORAGE_KEY)
  dispatchConfigChanged()
}

export function getLocalGoogleMapsApiKey(storage = getBrowserStorage()): string {
  return storage?.getItem(GOOGLE_MAPS_STORAGE_KEY)?.trim() || ''
}

type GoogleMapsWindow = Window & { google?: { maps?: object } }

export function isGoogleMapsAvailable(): boolean {
  return typeof window !== 'undefined' && typeof (window as GoogleMapsWindow).google?.maps === 'object'
}

export async function waitForGoogleMaps(): Promise<boolean> {
  if (isGoogleMapsAvailable()) {
    return true
  }

  if (!loadPromise) {
    loadPromise = loadGoogleMapsScript()
  }

  return loadPromise
}

async function loadGoogleMapsScript(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false
  }

  const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null
  if (existingScript) {
    return waitForScriptLoad()
  }

  const apiKey = getGoogleMapsApiKey()
  if (!apiKey) {
    return false
  }

  return new Promise<boolean>((resolve) => {
    const script = document.createElement('script')
    script.id = GOOGLE_MAPS_SCRIPT_ID
    script.async = true
    script.defer = true

    const callbackName = GOOGLE_MAPS_CALLBACK_NAME
    const timeout = window.setTimeout(() => {
      cleanup()
      resolve(false)
    }, 15000)

    const win = window as unknown as Record<string, unknown>

    function cleanup() {
      window.clearTimeout(timeout)
      delete win[callbackName]
      script.removeEventListener('error', onError)
    }

    function onError() {
      cleanup()
      script.remove()
      resolve(false)
    }

    win[callbackName] = () => {
      cleanup()
      resolve(true)
    }

    script.addEventListener('error', onError)
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,marker&callback=${callbackName}`
    document.head.appendChild(script)
  })
}

function waitForScriptLoad(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (isGoogleMapsAvailable()) {
      resolve(true)
      return
    }

    const checkInterval = 100
    const maxWait = 15000
    let elapsed = 0

    const interval = window.setInterval(() => {
      elapsed += checkInterval
      if (isGoogleMapsAvailable()) {
        window.clearInterval(interval)
        resolve(true)
      } else if (elapsed >= maxWait) {
        window.clearInterval(interval)
        resolve(false)
      }
    }, checkInterval)
  })
}

export const GOOGLE_MAPS_STORAGE_KEY_EXPORT = GOOGLE_MAPS_STORAGE_KEY
export const GOOGLE_MAPS_CONFIG_CHANGED_EVENT_EXPORT = GOOGLE_MAPS_CONFIG_CHANGED_EVENT

function dispatchConfigChanged() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(GOOGLE_MAPS_CONFIG_CHANGED_EVENT))
}

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readGoogleMapsEnv(): Pick<ImportMetaEnv, 'VITE_GOOGLE_MAPS_API_KEY'> {
  return {
    VITE_GOOGLE_MAPS_API_KEY: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  }
}
