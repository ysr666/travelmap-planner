import { ListChecks } from 'lucide-react'
import { Card } from '../ui/Card'
import type { DayBrief, TravelBriefFinding, TravelBriefReminder, TravelBriefSummary, TravelBriefTone } from '../../lib/travelBrief'
import type { TripCheckSeverity } from '../../lib/tripCheck'

export function DayBriefCard({ brief }: { brief: DayBrief }) {
  return (
    <Card className="space-y-3" data-testid="day-local-brief-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 ring-1 ring-sky-100">
            <ListChecks className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-sky-600">{brief.eyebrow}</p>
            <h3 className="mt-0.5 text-sm font-semibold text-slate-950">{brief.title}</h3>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${getSeverityClass(brief.status.severity)}`}>
          {brief.status.badgeLabel}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {brief.stats.map((stat) => (
          <span
            className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-100"
            key={stat.id}
          >
            {stat.value} · {stat.label}
          </span>
        ))}
      </div>

      <p className="text-xs leading-5 text-slate-500">{brief.status.message}</p>
      <DaySummaries summaries={brief.summaries} />
      <DayFindings findings={brief.topFindings} />
      <DayReminders reminders={brief.reminders} />

      <div className="space-y-1 text-[11px] leading-5 text-slate-400">
        <p>{brief.privacyNote}</p>
        <p>{brief.futureNote}</p>
      </div>
    </Card>
  )
}

function DaySummaries({ summaries }: { summaries: TravelBriefSummary[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {summaries.slice(0, 4).map((summary) => (
        <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100" key={summary.id}>
          <p className={`truncate text-xs font-semibold ${getToneTextClass(summary.tone)}`}>{summary.value}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">{summary.label}</p>
        </div>
      ))}
    </div>
  )
}

function DayFindings({ findings }: { findings: TravelBriefFinding[] }) {
  if (findings.length === 0) {
    return (
      <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium leading-5 text-emerald-700">
        未发现明显问题，仍建议出发前人工核对关键预订信息。
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {findings.map((finding) => (
        <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100" key={finding.id}>
          <div className="flex items-start justify-between gap-2">
            <h4 className="min-w-0 text-xs font-semibold leading-5 text-slate-800">{finding.title}</h4>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${getSeverityClass(finding.severity)}`}>
              {getSeverityLabel(finding.severity)}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">{finding.message}</p>
        </div>
      ))}
    </div>
  )
}

function DayReminders({ reminders }: { reminders: TravelBriefReminder[] }) {
  return (
    <div className="rounded-xl bg-sky-50 px-3 py-2 ring-1 ring-sky-100" data-testid="day-brief-reminders">
      <p className="text-[11px] font-semibold text-sky-700">准备提醒</p>
      <div className="mt-1 space-y-1">
        {reminders.map((reminder) => (
          <p className="text-xs leading-5 text-slate-600" key={reminder.id}>
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
    return 'bg-red-50 text-red-600 ring-1 ring-red-100'
  }
  if (severity === 'warning') {
    return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
  }
  return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
}

function getToneTextClass(tone: TravelBriefTone) {
  if (tone === 'good') {
    return 'text-emerald-700'
  }
  if (tone === 'critical') {
    return 'text-red-600'
  }
  if (tone === 'warning') {
    return 'text-amber-700'
  }
  return 'text-slate-600'
}
