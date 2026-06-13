import { ClipboardCheck } from 'lucide-react'
import { Card } from '../ui/Card'
import type { TravelBriefFinding, TravelBriefReminder, TravelBriefSummary, TravelBriefTone, TripBrief } from '../../lib/travelBrief'
import type { TripCheckSeverity } from '../../lib/tripCheck'

export function TripBriefCard({ brief }: { brief: TripBrief }) {
  return (
    <Card variant="grouped" className="space-y-3" data-testid="local-trip-check-card">
      <BriefHeader
        badgeLabel={brief.status.badgeLabel}
        eyebrow={brief.eyebrow}
        severity={brief.status.severity}
        title={brief.title}
      />
      <div className="flex flex-wrap items-center gap-2">
        {brief.stats.map((stat) => (
          <BriefMetric key={stat.id} label={stat.label} value={stat.value} />
        ))}
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getToneClass(brief.tripDateStatus.tone)}`}>
          {brief.tripDateStatus.label}
        </span>
      </div>
      <p className="text-xs leading-5 tm-muted">{brief.status.message}</p>
      <BriefSummaries summaries={brief.summaries} />
      <BriefFindings findings={brief.topFindings} />
      <BriefReminders reminders={brief.reminders} />
      <BriefFooter futureNote={brief.futureNote} privacyNote={brief.privacyNote} />
    </Card>
  )
}

function BriefHeader({
  badgeLabel,
  eyebrow,
  severity,
  title,
}: {
  badgeLabel: string
  eyebrow: string
  severity: TripCheckSeverity
  title: string
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-sky-50/80 text-sky-600 ring-1 ring-sky-100/80 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900/50">
          <ClipboardCheck className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">{eyebrow}</p>
          <h3 className="mt-0.5 text-sm font-semibold text-slate-950 dark:text-slate-100">{title}</h3>
        </div>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${getSeverityClass(severity)}`}>
        {badgeLabel}
      </span>
    </div>
  )
}

function BriefMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="tm-chip text-[11px]">
      {value} · {label}
    </span>
  )
}

function BriefSummaries({ summaries }: { summaries: TravelBriefSummary[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {summaries.slice(0, 4).map((summary) => (
        <div
          className="min-w-0 rounded-xl bg-slate-50/80 px-3 py-2 ring-1 ring-slate-100/80 dark:bg-slate-900/40 dark:ring-slate-800/70"
          key={summary.id}
        >
          <p className={`truncate text-xs font-semibold ${getToneTextClass(summary.tone)}`}>{summary.value}</p>
          <p className="mt-0.5 truncate text-[11px] tm-muted">{summary.label}</p>
        </div>
      ))}
    </div>
  )
}

function BriefFindings({ findings }: { findings: TravelBriefFinding[] }) {
  if (findings.length === 0) {
    return (
      <p className="rounded-xl bg-emerald-50/80 px-3 py-2 text-xs font-medium leading-5 text-emerald-700 ring-1 ring-emerald-100/80 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50">
        未发现明显问题，出发前仍建议人工核对关键预订信息。
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {findings.map((finding) => (
        <div
          className="rounded-xl bg-slate-50/80 px-3 py-2 ring-1 ring-slate-100/80 dark:bg-slate-900/40 dark:ring-slate-800/70"
          data-testid="local-trip-check-finding"
          key={finding.id}
        >
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

function BriefReminders({ reminders }: { reminders: TravelBriefReminder[] }) {
  return (
    <div className="rounded-xl bg-sky-50/75 px-3 py-2 ring-1 ring-sky-100/80 dark:bg-sky-950/30 dark:ring-sky-900/50" data-testid="trip-brief-reminders">
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

function BriefFooter({ futureNote, privacyNote }: { futureNote: string; privacyNote: string }) {
  return (
    <div className="space-y-1 text-[11px] leading-5 tm-muted">
      <p>{privacyNote}</p>
      <p>{futureNote}</p>
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

function getToneClass(tone: TravelBriefTone) {
  if (tone === 'good') {
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/35 dark:text-emerald-300 dark:ring-emerald-900/50'
  }
  if (tone === 'critical') {
    return 'bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-950/35 dark:text-red-300 dark:ring-red-900/50'
  }
  if (tone === 'warning') {
    return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950/35 dark:text-amber-300 dark:ring-amber-900/50'
  }
  return 'tm-chip'
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
