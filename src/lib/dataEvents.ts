export const TRAVEL_DATA_CHANGED_EVENT = 'tripmap:travel-data-changed'

export function emitTravelDataChanged() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(TRAVEL_DATA_CHANGED_EVENT))
}

export function subscribeTravelDataChanged(listener: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  window.addEventListener(TRAVEL_DATA_CHANGED_EVENT, listener)
  return () => window.removeEventListener(TRAVEL_DATA_CHANGED_EVENT, listener)
}
