import { ListChecks } from 'lucide-react'
import { Card } from '../ui/Card'
import type { DayBrief, TravelBriefFinding, TravelBriefReminder, TravelBriefSummary, TravelBriefTone } from '../../lib/travelBrief'
import type { TripCheckSeverity } from '../../lib/tripCheck'

export function DayBriefCard({ brief }: { brief: DayBrief }) {
  return (
    <Card variant="grouped" className="space-y-2" data-testid="day-local-brief-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-sky-50/80 text-sky-600 ring-1 ring-sky-100/80 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900/50">
            <ListChecks className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">{brief.eyebrow}</p>
            <h3 className="mt-0.5 text-sm font-semibold text-slate-950 dark:text-slate-100">{brief.title}</h3>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${getSeverityClass(brief.status.severity)}`}>
          {brief.status.badgeLabel}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {brief.stats.map((stat) => (
          <span
            className="tm-chip text-[11px]"
            key={stat.id}
          >
            {stat.value} · {stat.label}
          </span>
        ))}
      </div>

      <p className="line-clamp-1 text-xs leading-5 tm-muted">{brief.status.message}</p>
      <details className="rounded-xl border border-outline-variant/25 bg-surface-container-high/35 px-3 py-2">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-on-surface marker:hidden">
          <span>查看提醒</span>
          <span className="tm-muted">{brief.reminders.length + brief.topFindings.length} 项</span>
        </summary>
        <div className="mt-2 space-y-3">
          <DaySummaries summaries={brief.summaries} />
          <DayFindings findings={brief.topFindings} />
          <DayReminders reminders={brief.reminders} />
          <div className="space-y-1 text-[11px] leading-5 tm-muted">
            <p>{brief.privacyNote}</p>
            <p>{brief.futureNote}</p>
          </div>
        </div>
      </details>
    </Card>
  )
}

function DaySummaries({ summaries }: { summaries: TravelBriefSummary[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {summaries.slice(0, 4).map((summary) => (
        <div className="min-w-0 rounded-xl bg-slate-50/80 px-3 py-2 ring-1 ring-slate-100/80 dark:bg-slate-900/40 dark:ring-slate-800/70" key={summary.id}>
          <p className={`truncate text-xs font-semibold ${getToneTextClass(summary.tone)}`}>{summary.value}</p>
          <p className="mt-0.5 truncate text-[11px] tm-muted">{summary.label}</p>
        </div>
      ))}
    </div>
  )
}

function DayFindings({ findings }: { findings: TravelBriefFinding[] }) {
  if (findings.length === 0) {
    return (
      <p className="rounded-xl bg-emerald-50/80 px-3 py-2 text-xs font-medium leading-5 text-emerald-700 ring-1 ring-emerald-100/80 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50">
        未发现明显问题，仍建议出发前人工核对关键预订信息。
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {findings.map((finding) => (
        <div className="rounded-xl bg-slate-50/80 px-3 py-2 ring-1 ring-slate-100/80 dark:bg-slate-900/40 dark:ring-slate-800/70" key={finding.id}>
          <div className="flex items-start justify-between gap-2">
            <h4 className="min-w-0 text-xs font-semibold leading-5 text-slate-800 dark:text-slate-100">{finding.title}</h4>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${getSeverityClass(finding.severity)}`}>
              {getSeverityLabel(finding.severity)}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 tm-muted">{finding.message}</p>
        </div>
      ))}
    </div>
  )
}

function DayReminders({ reminders }: { reminders: TravelBriefReminder[] }) {
  return (
    <div className="rounded-xl bg-sky-50/75 px-3 py-2 ring-1 ring-sky-100/80 dark:bg-sky-950/30 dark:ring-sky-900/50" data-testid="day-brief-reminders">
      <p className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">准备提醒</p>
      <div className="mt-1 space-y-1">
        {reminders.map((reminder) => (
          <p className="text-xs leading-5 text-slate-600 dark:text-slate-300" key={reminder.id}>
            {reminder.message}
          </p>
        ))}
      </div>
    </div>
  )
}

function getSeverityLabel(severity: TripCheckSeverity) {
  if (severity === 'critical') {
    return '需要处理'
  }
  if (severity === 'warning') {
    return '注意'
  }
  return '提醒'
}

function getSeverityClass(severity: TripCheckSeverity) {
  if (severity === 'critical') {
    return 'bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-950/35 dark:text-red-300 dark:ring-red-900/50'
  }
  if (severity === 'warning') {
    return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950/35 dark:text-amber-300 dark:ring-amber-900/50'
  }
  return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/35 dark:text-emerald-300 dark:ring-emerald-900/50'
}

function getToneTextClass(tone: TravelBriefTone) {
  if (tone === 'good') {
    return 'text-emerald-700 dark:text-emerald-300'
  }
  if (tone === 'critical') {
    return 'text-red-600 dark:text-red-300'
  }
  if (tone === 'warning') {
    return 'text-amber-700 dark:text-amber-300'
  }
  return 'text-slate-600 dark:text-slate-300'
}
