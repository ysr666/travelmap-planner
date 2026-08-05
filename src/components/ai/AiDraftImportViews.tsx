import type { ReactNode } from 'react'
import { Collapsible } from '../ui/Collapsible'
import type { AiTripDraftImportCheck } from '../../lib/ai/aiTripDraftImportCheck'

export function AiDraftRequestFrame({
  children,
  collapsed,
  onOpenChange,
  open,
  subtitle,
}: {
  children: ReactNode
  collapsed: boolean
  onOpenChange: (open: boolean) => void
  open: boolean
  subtitle: string
}) {
  if (!collapsed) return <>{children}</>
  return (
    <Collapsible
      onOpenChange={onOpenChange}
      open={open}
      subtitle={subtitle}
      testId="ai-draft-request-settings"
      title="生成设置"
    >
      <div className="space-y-4">{children}</div>
    </Collapsible>
  )
}
export function AiDraftImportCheckPanel({ check }: { check: AiTripDraftImportCheck }) {
  return (
    <div className="space-y-3" data-testid="ai-draft-import-check">
      <div className="space-y-1 rounded-xl bg-surface-container px-3 py-3 ring-1 ring-outline-variant/20">
        <p className="break-words text-sm font-semibold text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
          {check.title}
        </p>
        <p className="break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
          {check.destination} · {check.dateRangeLabel}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <ImportCheckMetric label="天数" value={`${check.dayCount} 天`} />
        <ImportCheckMetric label="行程点" value={`${check.itemCount} 个`} />
        <ImportCheckMetric label="有效坐标" value={`${check.validCoordinateCount} 个`} />
        <ImportCheckMetric
          label="缺坐标"
          value={check.invalidCoordinateCount > 0
            ? `${check.missingCoordinateCount} 缺失 / ${check.invalidCoordinateCount} 异常`
            : `${check.missingCoordinateCount} 个`}
        />
        <ImportCheckMetric label="路线可生成" value={`${check.routeReadyDayCount} 天`} />
        <ImportCheckMetric label="每日提示" value={`${check.dailyTipCount} 条`} />
      </dl>

      <div className="space-y-2 rounded-xl bg-surface-container px-3 py-3 text-sm leading-6 ring-1 ring-outline-variant/20">
        <p className="break-words font-medium text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
          路线提示
        </p>
        <p className="break-words tm-muted [overflow-wrap:anywhere]" data-testid="ai-draft-import-check-route-summary">
          {check.routeSummary}
        </p>
      </div>

      <div className="space-y-2 rounded-xl bg-blue-50/70 px-3 py-3 text-sm leading-6 text-blue-800 ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-800/60">
        <p className="break-words font-medium [overflow-wrap:anywhere]">云端自动同步</p>
        <p className="break-words [overflow-wrap:anywhere]" data-testid="ai-draft-import-check-sync-summary">
          {check.autoSyncMessage}
        </p>
        <p className="break-words text-xs leading-5 [overflow-wrap:anywhere]">
          导入确认会先写入此设备；登录状态下，现有同步控制器会按设置继续处理。
        </p>
      </div>

      <p className="break-words rounded-xl bg-surface-container-high px-3 py-2 text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
        每日提示会按天追加到旅行备注；导入后仍会显示路线生成提示，确认生成前不会调用路线服务。
      </p>
    </div>
  )
}

function ImportCheckMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-container px-3 py-2 ring-1 ring-outline-variant/20" data-testid="ai-draft-import-check-metric">
      <dt className="text-xs tm-muted">{label}</dt>
      <dd className="break-words text-sm font-semibold text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  )
}
