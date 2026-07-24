import { useEffect } from 'react'
import { registerSW } from '../lib/pwaRegister'
import {
  setPwaLifecycleState,
  setPwaUpdateAction,
} from '../lib/pwaLifecycle'

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>

export function PwaLifecycleController() {
  useEffect(() => {
    const serviceWorkerSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    const syncOnlineState = () => {
      setPwaLifecycleState({
        isOnline: typeof navigator === 'undefined' || !('onLine' in navigator) ? true : navigator.onLine,
      })
    }

    window.addEventListener('online', syncOnlineState)
    window.addEventListener('offline', syncOnlineState)
    syncOnlineState()

    if (!serviceWorkerSupported) {
      setPwaLifecycleState({
        message: '当前浏览器不支持应用更新控制。',
        serviceWorkerSupported: false,
        status: 'unsupported',
      })
      return () => {
        window.removeEventListener('online', syncOnlineState)
        window.removeEventListener('offline', syncOnlineState)
      }
    }

    let updateServiceWorker: UpdateServiceWorker | undefined
    try {
      updateServiceWorker = registerSW({
        immediate: true,
        onNeedRefresh() {
          if (updateServiceWorker) {
            setPwaUpdateAction(() => updateServiceWorker?.(true))
          }
          setPwaLifecycleState({
            message: '发现新版本，可在确认后更新并重启。',
            serviceWorkerSupported: true,
            status: 'update-ready',
          })
        },
        onOfflineReady() {
          setPwaLifecycleState({
            message: '应用外壳已可离线打开。',
            serviceWorkerSupported: true,
            status: 'offline-ready',
          })
        },
        onRegisteredSW(_swScriptUrl, registration) {
          setPwaLifecycleState({
            message: registration ? undefined : '应用更新控制已初始化。',
            registeredAt: Date.now(),
            serviceWorkerSupported: true,
            status: 'registered',
          })
        },
        onRegisterError() {
          setPwaLifecycleState({
            message: '应用更新检查失败，请稍后重新打开。',
            serviceWorkerSupported: true,
            status: 'error',
          })
        },
      })
    } catch {
      setPwaLifecycleState({
        message: '应用更新检查失败，请稍后重新打开。',
        serviceWorkerSupported: true,
        status: 'error',
      })
    }

    return () => {
      setPwaUpdateAction(null)
      window.removeEventListener('online', syncOnlineState)
      window.removeEventListener('offline', syncOnlineState)
    }
  }, [])

  return null
}
