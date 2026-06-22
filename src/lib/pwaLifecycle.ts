export type PwaLifecycleStatus =
  | 'error'
  | 'idle'
  | 'offline-ready'
  | 'registered'
  | 'unsupported'
  | 'update-ready'

export type PwaLifecycleState = {
  appVersion: string
  isOnline: boolean
  message?: string
  registeredAt?: number
  serviceWorkerSupported: boolean
  status: PwaLifecycleStatus
  updatedAt?: number
}

type PwaLifecycleListener = () => void
type PwaUpdateAction = () => Promise<void> | void

const listeners = new Set<PwaLifecycleListener>()
let state: PwaLifecycleState = createInitialState()
let pendingUpdateAction: PwaUpdateAction | null = null

export function getPwaLifecycleState() {
  return state
}

export function subscribePwaLifecycle(listener: PwaLifecycleListener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setPwaLifecycleState(patch: Partial<PwaLifecycleState>) {
  state = {
    ...state,
    ...patch,
    updatedAt: Date.now(),
  }
  emitPwaLifecycleChanged()
}

export function setPwaUpdateAction(action: PwaUpdateAction | null) {
  pendingUpdateAction = action
}

export async function applyPendingPwaUpdate() {
  if (!pendingUpdateAction) return false
  await pendingUpdateAction()
  return true
}

export function getPwaLifecycleStatusLabel(status: PwaLifecycleStatus) {
  if (status === 'unsupported') return '当前浏览器不支持应用更新控制'
  if (status === 'registered') return '已启用'
  if (status === 'offline-ready') return '应用外壳可离线打开'
  if (status === 'update-ready') return '有新版本可更新'
  if (status === 'error') return '更新检查失败'
  return '等待注册'
}

export function resetPwaLifecycleForTests(patch: Partial<PwaLifecycleState> = {}) {
  pendingUpdateAction = null
  state = {
    ...createInitialState(),
    ...patch,
  }
  emitPwaLifecycleChanged()
}

function emitPwaLifecycleChanged() {
  listeners.forEach((listener) => listener())
}

function createInitialState(): PwaLifecycleState {
  const serviceWorkerSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
  return {
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
    isOnline: typeof navigator === 'undefined' || !('onLine' in navigator) ? true : navigator.onLine,
    serviceWorkerSupported,
    status: serviceWorkerSupported ? 'idle' : 'unsupported',
  }
}
