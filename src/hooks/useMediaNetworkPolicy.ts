import { useSyncExternalStore } from 'react'

export type MediaNetworkPolicy = 'online' | 'offline' | 'reduced-data'

type ConnectionLike = {
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
  saveData?: boolean
}

const listeners = new Set<() => void>()
let observedConnection: ConnectionLike | undefined

export function useMediaNetworkPolicy() {
  return useSyncExternalStore(subscribe, readMediaNetworkPolicy, readServerPolicy)
}

export function readMediaNetworkPolicy(): MediaNetworkPolicy {
  if (typeof navigator === 'undefined') return 'online'
  if (navigator.onLine === false) return 'offline'
  return getConnection()?.saveData ? 'reduced-data' : 'online'
}

function getConnection() {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & {
    connection?: ConnectionLike
  }).connection
}

function subscribe(listener: () => void) {
  if (typeof window === 'undefined') return () => undefined
  listeners.add(listener)
  if (listeners.size === 1) startObserving()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stopObserving()
  }
}

function startObserving() {
  observedConnection = getConnection()
  window.addEventListener('online', publish)
  window.addEventListener('offline', publish)
  observedConnection?.addEventListener?.('change', publish)
}

function stopObserving() {
  window.removeEventListener('online', publish)
  window.removeEventListener('offline', publish)
  observedConnection?.removeEventListener?.('change', publish)
  observedConnection = undefined
}

function publish() {
  listeners.forEach((listener) => listener())
}

function readServerPolicy(): MediaNetworkPolicy {
  return 'online'
}
