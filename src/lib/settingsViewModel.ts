import type { PwaLifecycleStatus } from './pwaLifecycle'
import { formatFileSize } from './tickets'
import type { ParsedTripPlanFile } from './tripPlanImport'

export function getTripPlanImportButtonLabel(parsed: ParsedTripPlanFile | null) {
  if (!parsed) return '确认导入 AI 行程包'
  if (parsed.validation.errors.length > 0) return '有必须修复，无法导入'
  if (parsed.validation.warnings.length > 0) return '有建议检查，仍然导入'
  return '确认导入'
}

export function getPersistenceDetail(isSupported: boolean, persisted: boolean | null) {
  if (!isSupported) return '当前浏览器不支持持久化存储状态查询'
  if (persisted === true) return '已获得持久化存储许可，重要旅行仍可按需导出 zip 归档'
  if (persisted === false) return '尚未获得持久化存储许可'
  return '持久化存储状态未知'
}

export function getPwaLifecycleTone(status: PwaLifecycleStatus): 'neutral' | 'success' | 'warning' {
  if (status === 'registered' || status === 'offline-ready') return 'success'
  if (status === 'error' || status === 'unsupported' || status === 'update-ready') return 'warning'
  return 'neutral'
}

export function formatStorageSize(size?: number) {
  if (size === undefined || Number.isNaN(size)) return '未知'
  return formatFileSize(size)
}
