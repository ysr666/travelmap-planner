import type { TripContext, TripContextDay } from './aiTripContext'
import {
  getTopTripCheckFindings,
  isTicketLikeItem,
  type TripCheckCard,
  type TripCheckResult,
  type TripCheckSeverity,
} from './tripCheck'
import { isValidPlainDate } from './plainDate'

export type TravelBriefSource = 'local_rule' | 'future_ai' | 'weather' | 'opening_hours' | 'route_service'
export type TravelBriefTone = 'good' | 'info' | 'warning' | 'critical'

export const travelBriefSourceTypes: TravelBriefSource[] = [
  'local_rule',
  'future_ai',
  'weather',
  'opening_hours',
  'route_service',
]

export type TravelBriefMetric = {
  id: string
  label: string
  value: string
}

export type TravelBriefStatus = {
  badgeLabel: string
  message: string
  severity: TripCheckSeverity
  title: string
}

export type TravelBriefSummary = {
  id: string
  label: string
  source: TravelBriefSource
  tone: TravelBriefTone
  value: string
}

export type TravelBriefFinding = {
  id: string
  message: string
  ruleId: string
  severity: TripCheckSeverity
  source: TravelBriefSource
  title: string
}

export type TravelBriefReminder = {
  id: string
  message: string
  ruleId: string
  severity: TripCheckSeverity
  source: TravelBriefSource
  title: string
}

export type TripBrief = {
  eyebrow: '行程体检'
  futureNote: string
  privacyNote: string
  reminders: TravelBriefReminder[]
  stats: TravelBriefMetric[]
  status: TravelBriefStatus
  summaries: TravelBriefSummary[]
  title: '本地检查'
  topFindings: TravelBriefFinding[]
  tripDateStatus: {
    label: string
    tone: TravelBriefTone
  }
}

export type DayBrief = {
  date: string
  dayId: string
  eyebrow: '当日简报'
  futureNote: string
  privacyNote: string
  reminders: TravelBriefReminder[]
  stats: TravelBriefMetric[]
  status: TravelBriefStatus
  summaries: TravelBriefSummary[]
  title: '本地检查'
  topFindings: TravelBriefFinding[]
}

type BriefIssueCounts = {
  criticalFindingCount: number
  denseDayCount: number
  emptyDayCount: number
  findingCount: number
  invalidCoordinateCount: number
  itemCount: number
  missingCoordinateCount: number
  missingTicketCount: number
  missingTransportDurationCount: number
  overlapCount: number
  shortGapCount: number
}

const localSource: TravelBriefSource = 'local_rule'
const defaultFindingLimit = 3
const privacyNote = '仅基于本地行程信息，不读取票据文件、完整备注或坐标明细。'
const futureNote = '后续可接入天气、开放时间和路线信息；当前仅根据已填写内容提示。'

export function buildTripBrief(
  context: TripContext,
  result: TripCheckResult,
  options: { topFindingLimit?: number } = {},
): TripBrief {
  const limit = options.topFindingLimit ?? defaultFindingLimit
  const counts = countBriefIssues(context.days, result)

  return {
    eyebrow: '行程体检',
    futureNote,
    privacyNote,
    reminders: buildPreparationReminders(counts, 'trip'),
    stats: [
      { id: 'days', label: '天数', value: `${context.days.length} 天` },
      { id: 'items', label: '行程点', value: `${counts.itemCount} 个` },
      { id: 'tickets', label: '票据', value: `${context.ticketSummary.totalCount} 张` },
    ],
    status: buildBriefStatus(counts, 'trip'),
    summaries: buildIssueSummaries(counts),
    title: '本地检查',
    topFindings: getTopLocalFindings(result, limit).map(toBriefFinding),
    tripDateStatus: getTripDateStatus(context),
  }
}

export function buildDayBrief(
  context: TripContext,
  result: TripCheckResult,
  selectedDayId = context.selectedDayId,
  options: { topFindingLimit?: number } = {},
): DayBrief | null {
  const day = context.days.find((candidate) => candidate.id === selectedDayId)
  if (!day) {
    return null
  }

  const limit = options.topFindingLimit ?? defaultFindingLimit
  const counts = countBriefIssues([day], result, day)

  return {
    date: day.date,
    dayId: day.id,
    eyebrow: '当日简报',
    futureNote,
    privacyNote,
    reminders: buildPreparationReminders(counts, 'day'),
    stats: [
      { id: 'items', label: '行程点', value: `${counts.itemCount} 个` },
      { id: 'coordinates', label: '缺少坐标', value: `${counts.missingCoordinateCount} 项` },
      { id: 'transport', label: '交通耗时', value: `${counts.missingTransportDurationCount} 项待补` },
    ],
    status: buildBriefStatus(counts, 'day'),
    summaries: buildIssueSummaries(counts),
    title: '本地检查',
    topFindings: getTopLocalFindings(result, limit, day).map(toBriefFinding),
  }
}

function countBriefIssues(
  days: TripContextDay[],
  result: TripCheckResult,
  scopedDay?: TripContextDay,
): BriefIssueCounts {
  const items = days.flatMap((day) => day.items)
  const scopedFindings = getScopedLocalFindings(result, scopedDay)

  return {
    criticalFindingCount: scopedFindings.filter((finding) => finding.severity === 'critical').length,
    denseDayCount: countRule(scopedFindings, 'dense_day'),
    emptyDayCount: days.filter((day) => day.items.length === 0).length,
    findingCount: scopedFindings.length,
    invalidCoordinateCount: items.filter((item) => item.coordinateState === 'invalid').length,
    itemCount: items.length,
    missingCoordinateCount: items.filter((item) => item.coordinateState === 'missing').length,
    missingTicketCount: items.filter((item) => item.ticketCount === 0 && isTicketLikeItem(item)).length,
    missingTransportDurationCount: countMissingTransportDurations(days),
    overlapCount: countRule(scopedFindings, 'overlap_time'),
    shortGapCount: countRule(scopedFindings, 'short_gap'),
  }
}

function buildBriefStatus(counts: BriefIssueCounts, scope: 'trip' | 'day'): TravelBriefStatus {
  if (counts.criticalFindingCount > 0) {
    return {
      badgeLabel: '需要处理',
      message: `根据已填写内容，发现 ${counts.criticalFindingCount} 项需要优先人工核对。`,
      severity: 'critical',
      title: '需要优先核对',
    }
  }

  if (counts.findingCount > 0) {
    return {
      badgeLabel: '注意',
      message: scope === 'trip'
        ? `基于当前本地行程信息，发现 ${counts.findingCount} 项本地提醒。`
        : `根据已填写内容，这一天有 ${counts.findingCount} 项本地提醒。`,
      severity: 'warning',
      title: '有本地提醒',
    }
  }

  return {
    badgeLabel: '提醒',
    message: '基于当前本地行程信息，未发现明显问题。',
    severity: 'info',
    title: '未发现明显问题',
  }
}

function buildIssueSummaries(counts: BriefIssueCounts): TravelBriefSummary[] {
  const summaries: TravelBriefSummary[] = [
    countSummary('missing-coordinate', '缺少坐标', counts.missingCoordinateCount),
    countSummary('missing-transport', '交通耗时待补', counts.missingTransportDurationCount),
    countSummary('missing-ticket', '票据待核对', counts.missingTicketCount),
  ]

  if (counts.overlapCount > 0) {
    summaries.push(countSummary('overlap-time', '时间重叠', counts.overlapCount, 'critical'))
  }
  if (counts.shortGapCount > 0) {
    summaries.push(countSummary('short-gap', '间隔偏短', counts.shortGapCount))
  }
  if (counts.denseDayCount > 0) {
    summaries.push(countSummary('dense-day', '安排偏密', counts.denseDayCount))
  }
  if (counts.emptyDayCount > 0) {
    summaries.push(countSummary('empty-day', '空白日期', counts.emptyDayCount, 'info'))
  }
  if (counts.invalidCoordinateCount > 0) {
    summaries.push(countSummary('invalid-coordinate', '坐标异常', counts.invalidCoordinateCount))
  }

  const activeSummaries = summaries.filter((summary) => summary.value !== '0 项')
  if (activeSummaries.length > 0) {
    return activeSummaries
  }

  return [{
    id: 'clean',
    label: '本地检查',
    source: localSource,
    tone: 'good',
    value: '未发现明显问题',
  }]
}

function buildPreparationReminders(counts: BriefIssueCounts, scope: 'trip' | 'day'): TravelBriefReminder[] {
  const subject = scope === 'trip' ? '这趟行程' : '这一天'
  const reminders: TravelBriefReminder[] = []

  if (counts.overlapCount > 0) {
    reminders.push(reminder(
      'overlap-time-reminder',
      '时间需要优先核对',
      `根据已填写内容，${subject}有 ${counts.overlapCount} 处时间重叠，建议出发前人工确认。`,
      'overlap_time',
      'critical',
    ))
  }
  if (counts.shortGapCount > 0) {
    reminders.push(reminder(
      'short-gap-reminder',
      '行程间隔偏短',
      `基于当前本地行程信息，${subject}有 ${counts.shortGapCount} 处间隔偏短，建议预留缓冲。`,
      'short_gap',
      'warning',
    ))
  }
  if (counts.missingTransportDurationCount > 0) {
    reminders.push(reminder(
      'missing-transport-reminder',
      '补充交通耗时',
      `根据已填写内容，${subject}还有 ${counts.missingTransportDurationCount} 段上一站交通耗时待补。`,
      'missing_transport_duration',
      'warning',
    ))
  }
  if (counts.missingTicketCount > 0) {
    reminders.push(reminder(
      'missing-ticket-reminder',
      '核对票据绑定',
      `基于当前本地行程信息，${counts.missingTicketCount} 个明显票据或预约相关行程点尚未绑定票据。`,
      'missing_ticket',
      'warning',
    ))
  }
  if (counts.missingCoordinateCount > 0) {
    reminders.push(reminder(
      'missing-coordinate-reminder',
      '补全地点坐标',
      `根据已填写内容，${subject}还有 ${counts.missingCoordinateCount} 个行程点缺少坐标。`,
      'missing_coordinate',
      'warning',
    ))
  }
  if (counts.denseDayCount > 0) {
    reminders.push(reminder(
      'dense-day-reminder',
      '安排偏密',
      `基于当前本地行程信息，${subject}存在安排偏密的日期，建议保留体力和机动时间。`,
      'dense_day',
      'warning',
    ))
  }
  if (counts.emptyDayCount > 0) {
    reminders.push(reminder(
      'empty-day-reminder',
      '确认空白日',
      `根据已填写内容，${subject}有 ${counts.emptyDayCount} 个日期还没有行程点，可确认是否为留白安排。`,
      'empty_day',
      'info',
    ))
  }

  if (reminders.length === 0) {
    return [reminder(
      'clean-reminder',
      '准备提醒',
      '基于当前本地行程信息，暂未发现需要提前准备的明显提醒。',
      'clean_local_check',
      'info',
    )]
  }

  return reminders.slice(0, scope === 'trip' ? 2 : 3)
}

function getTopLocalFindings(result: TripCheckResult, limit: number, scopedDay?: TripContextDay) {
  return getTopTripCheckFindings({
    ...result,
    suggestions: result.suggestions.filter((finding) => isScopedLocalFinding(finding, scopedDay)),
    warnings: result.warnings.filter((finding) => isScopedLocalFinding(finding, scopedDay)),
  }, limit)
}

function getScopedLocalFindings(result: TripCheckResult, scopedDay?: TripContextDay) {
  return [...result.warnings, ...result.suggestions].filter((finding) => isScopedLocalFinding(finding, scopedDay))
}

function isScopedLocalFinding(finding: TripCheckCard, scopedDay?: TripContextDay) {
  if (finding.source !== localSource) {
    return false
  }
  if (!scopedDay) {
    return true
  }

  const itemIds = new Set(scopedDay.items.map((item) => item.id))
  return finding.affectedDayIds.includes(scopedDay.id) ||
    finding.affectedItemIds.some((itemId) => itemIds.has(itemId))
}

function toBriefFinding(finding: TripCheckCard): TravelBriefFinding {
  return {
    id: finding.id,
    message: finding.message,
    ruleId: finding.ruleId,
    severity: finding.severity,
    source: localSource,
    title: finding.title,
  }
}

function countMissingTransportDurations(days: TripContextDay[]) {
  return days.reduce((total, day) => {
    return total + day.items.filter((item, index) => index > 0 && !item.previousTransport.hasDuration).length
  }, 0)
}

function countRule(findings: TripCheckCard[], ruleId: string) {
  return findings.filter((finding) => finding.ruleId === ruleId).length
}

function countSummary(
  id: string,
  label: string,
  count: number,
  tone: TravelBriefTone = 'warning',
): TravelBriefSummary {
  return {
    id,
    label,
    source: localSource,
    tone,
    value: `${count} 项`,
  }
}

function reminder(
  id: string,
  title: string,
  message: string,
  ruleId: string,
  severity: TripCheckSeverity,
): TravelBriefReminder {
  return {
    id,
    message,
    ruleId,
    severity,
    source: localSource,
    title,
  }
}

function getTripDateStatus(context: TripContext): TripBrief['tripDateStatus'] {
  if (
    !isValidPlainDate(context.trip.startDate) ||
    !isValidPlainDate(context.trip.endDate) ||
    context.trip.endDate < context.trip.startDate
  ) {
    return { label: '日期待核对', tone: 'info' }
  }

  if (!context.nowPlainDate || !isValidPlainDate(context.nowPlainDate)) {
    return { label: '日期已填写', tone: 'info' }
  }

  if (context.nowPlainDate >= context.trip.startDate && context.nowPlainDate <= context.trip.endDate) {
    return { label: '进行中', tone: 'good' }
  }

  if (context.nowPlainDate < context.trip.startDate) {
    return { label: '计划中', tone: 'info' }
  }

  return { label: '已结束', tone: 'info' }
}

export function getBriefItemsForPrivacyAudit(brief: TripBrief | DayBrief) {
  return [
    ...brief.summaries,
    ...brief.topFindings,
    ...brief.reminders,
  ]
}
