import { useSyncExternalStore } from 'react'
import {
  getPwaLifecycleState,
  subscribePwaLifecycle,
} from '../lib/pwaLifecycle'

export function usePwaLifecycleState() {
  return useSyncExternalStore(
    subscribePwaLifecycle,
    getPwaLifecycleState,
    getPwaLifecycleState,
  )
}
