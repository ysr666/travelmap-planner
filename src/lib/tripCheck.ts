import type { TripContext, TripContextDay, TripContextItem } from './aiTripContext'

export type TripCheckSeverity = 'info' | 'warning' | 'critical'
export type TripCheckSource = 'local_rule' | 'future_ai'

export type TripCheckEvidence = {
  id: string
  dayId?: string
  itemId?: string
  label: string
  message: string
}

export type TripCheckCard = {
  id: string
  ruleId: string
  severity: TripCheckSeverity
  source: TripCheckSource
  title: string
  message: string
  affectedDayIds: string[]
  affectedItemIds: string[]
  evidenceIds: string[]
}

export type TripCheckResult = {
  summary: {
    title: string
    message: string
    severity: TripCheckSeverity
    warningCount: number
    suggestionCount: number
    criticalCount: number
  }
  warnings: TripCheckCard[]
  suggestions: TripCheckCard[]
  evidence: TripCheckEvidence[]
}

type MutableTripCheckResult = Omit<TripCheckResult, 'summary'> & {
  summary?: TripCheckResult['summary']
}

type FindingInput = Omit<TripCheckCard, 'affectedDayIds' | 'affectedItemIds' | 'evidenceIds' | 'source'> & {
  affectedDayIds?: string[]
  affectedItemIds?: string[]
  evidence: Omit<TripCheckEvidence, 'id'>[]
  kind: 'warning' | 'suggestion'
}

const denseDayItemLimit = 6
const shortGapMinutes = 30
const longDaySpanMinutes = 12 * 60
const ticketLikePattern = /门票|预约|ticket|reservation|booking|入场|凭证/i

export function analyzeTripContext(context: TripContext): TripCheckResult {
  const result: MutableTripCheckResult = {
    evidence: [],
    suggestions: [],
    warnings: [],
  }

  for (const day of context.days) {
    analyzeDay(day, result)
  }

  const criticalCount = result.warnings.filter((finding) => finding.severity === 'critical').length
  const warningCount = result.warnings.length
  const suggestionCount = result.suggestions.length
  const severity = criticalCount > 0 ? 'critical' : warningCount > 0 || suggestionCount > 0 ? 'warning' : 'info'

  return {
    evidence: result.evidence,
    suggestions: result.suggestions,
    summary: {
      criticalCount,
      message:
        warningCount + suggestionCount > 0
          ? `发现 ${warningCount + suggestionCount} 项可检查内容，均来自本地规则。`
          : '未发现明显问题，出发前仍建议人工核对关键预订信息。',
      severity,
      suggestionCount,
      title: severity === 'info' ? '本地检查正常' : '本地检查有提醒',
      warningCount,
    },
    warnings: result.warnings,
  }
}

export function isTicketLikeItem(item: Pick<TripContextItem, 'title'>) {
  return ticketLikePattern.test(item.title)
}

export function getTopTripCheckFindings(result: TripCheckResult, limit = 3) {
  return [...result.warnings, ...result.suggestions]
    .sort((first, second) => severityRank(second.severity) - severityRank(first.severity))
    .slice(0, limit)
}

function analyzeDay(day: TripContextDay, result: MutableTripCheckResult) {
  if (day.items.length === 0) {
    addFinding(result, {
      affectedDayIds: [day.id],
      evidence: [{ dayId: day.id, label: day.title, message: `${day.date} 还没有行程点。` }],
      id: `empty-day-${day.id}`,
      kind: 'suggestion',
      message: '这一天还没有行程点，可以在出发前确认是否是留白日。',
      ruleId: 'empty_day',
      severity: 'info',
      title: '当天暂无行程点',
    })
    return
  }

  if (day.items.length > denseDayItemLimit) {
    addFinding(result, {
      affectedDayIds: [day.id],
      evidence: [{ dayId: day.id, label: day.title, message: `${day.date} 有 ${day.items.length} 个行程点。` }],
      id: `dense-day-${day.id}`,
      kind: 'suggestion',
      message: `当天超过 ${denseDayItemLimit} 个行程点，建议预留体力和机动时间。`,
      ruleId: 'dense_day',
      severity: 'warning',
      title: '当天安排偏密',
    })
  }

  analyzeDaySpan(day, result)

  day.items.forEach((item, index) => {
    analyzeItemBasics(day, item, result)

    if (index === 0) {
      return
    }

    const previousItem = day.items[index - 1]
    analyzeAdjacentItems(day, previousItem, item, result)
  })
}

function analyzeItemBasics(day: TripContextDay, item: TripContextItem, result: MutableTripCheckResult) {
  if (item.coordinateState === 'missing') {
    addFinding(result, {
      affectedDayIds: [day.id],
      affectedItemIds: [item.id],
      evidence: [{ dayId: day.id, itemId: item.id, label: item.title, message: '没有可用于地图展示的坐标。' }],
      id: `missing-coordinate-${item.id}`,
      kind: 'warning',
      message: '该行程点缺少坐标，地图概览和外部导航可能不完整。',
      ruleId: 'missing_coordinate',
      severity: 'warning',
      title: '缺少地点坐标',
    })
  }

  if (item.coordinateState === 'invalid') {
    addFinding(result, {
      affectedDayIds: [day.id],
      affectedItemIds: [item.id],
      evidence: [{ dayId: day.id, itemId: item.id, label: item.title, message: '坐标字段不完整或超出合法范围。' }],
      id: `invalid-coordinate-${item.id}`,
      kind: 'warning',
      message: '该行程点坐标不可用，建议重新确认地点。',
      ruleId: 'invalid_coordinate',
      severity: 'warning',
      title: '地点坐标异常',
    })
  }

  if (item.ticketCount === 0 && isTicketLikeItem(item)) {
    addFinding(result, {
      affectedDayIds: [day.id],
      affectedItemIds: [item.id],
      evidence: [{ dayId: day.id, itemId: item.id, label: item.title, message: '标题包含明显票据或预约关键词。' }],
      id: `missing-ticket-${item.id}`,
      kind: 'suggestion',
      message: '这个行程点看起来可能需要门票、预约或凭证，当前没有绑定票据。',
      ruleId: 'missing_ticket',
      severity: 'warning',
      title: '可能缺少票据',
    })
  }
}

function analyzeAdjacentItems(
  day: TripContextDay,
  previousItem: TripContextItem,
  item: TripContextItem,
  result: MutableTripCheckResult,
) {
  if (!item.previousTransport.hasDuration) {
    addFinding(result, {
      affectedDayIds: [day.id],
      affectedItemIds: [previousItem.id, item.id],
      evidence: [{
        dayId: day.id,
        itemId: item.id,
        label: item.title,
        message: `从「${previousItem.title}」到这里还没有交通耗时。`,
      }],
      id: `missing-transport-duration-${item.id}`,
      kind: 'warning',
      message: '相邻行程点之间缺少交通耗时，可能影响当天节奏判断。',
      ruleId: 'missing_transport_duration',
      severity: 'warning',
      title: '缺少交通耗时',
    })
  }

  const previousEnd = parseTimeMinutes(previousItem.endTime)
  const currentStart = parseTimeMinutes(item.startTime)
  if (previousEnd === null || currentStart === null) {
    return
  }

  const gap = currentStart - previousEnd
  if (gap < 0) {
    addFinding(result, {
      affectedDayIds: [day.id],
      affectedItemIds: [previousItem.id, item.id],
      evidence: [{
        dayId: day.id,
        itemId: item.id,
        label: item.title,
        message: `上一项结束 ${previousItem.endTime}，当前开始 ${item.startTime}。`,
      }],
      id: `overlap-time-${previousItem.id}-${item.id}`,
      kind: 'warning',
      message: '两个相邻行程点的时间发生重叠，请人工核对。',
      ruleId: 'overlap_time',
      severity: 'critical',
      title: '时间安排重叠',
    })
    return
  }

  if (gap < shortGapMinutes) {
    addFinding(result, {
      affectedDayIds: [day.id],
      affectedItemIds: [previousItem.id, item.id],
      evidence: [{
        dayId: day.id,
        itemId: item.id,
        label: item.title,
        message: `两项之间只有 ${gap} 分钟间隔。`,
      }],
      id: `short-gap-${previousItem.id}-${item.id}`,
      kind: 'warning',
      message: '相邻行程点之间间隔较短，建议确认交通和排队时间。',
      ruleId: 'short_gap',
      severity: 'warning',
      title: '行程间隔偏短',
    })
  }
}

function analyzeDaySpan(day: TripContextDay, result: MutableTripCheckResult) {
  const times = day.items.flatMap((item) => [parseTimeMinutes(item.startTime), parseTimeMinutes(item.endTime)])
    .filter((time): time is number => time !== null)
  if (times.length < 2) {
    return
  }

  const span = Math.max(...times) - Math.min(...times)
  if (span <= longDaySpanMinutes) {
    return
  }

  addFinding(result, {
    affectedDayIds: [day.id],
    affectedItemIds: day.items.map((item) => item.id),
    evidence: [{ dayId: day.id, label: day.title, message: `首尾时间跨度约 ${Math.round(span / 60)} 小时。` }],
    id: `long-day-span-${day.id}`,
    kind: 'suggestion',
    message: '当天首尾时间跨度较长，建议确认休息、用餐和返程安排。',
    ruleId: 'long_day_span',
    severity: 'warning',
    title: '当天跨度较长',
  })
}

function addFinding(result: MutableTripCheckResult, input: FindingInput) {
  const evidenceIds = input.evidence.map((evidenceInput, index) => {
    const id = `${input.id}-evidence-${index + 1}`
    result.evidence.push({ ...evidenceInput, id })
    return id
  })
  const card: TripCheckCard = {
    affectedDayIds: input.affectedDayIds ?? [],
    affectedItemIds: input.affectedItemIds ?? [],
    evidenceIds,
    id: input.id,
    message: input.message,
    ruleId: input.ruleId,
    severity: input.severity,
    source: 'local_rule',
    title: input.title,
  }

  if (input.kind === 'warning') {
    result.warnings.push(card)
  } else {
    result.suggestions.push(card)
  }
}

function parseTimeMinutes(value: string | undefined) {
  const match = /^(\d{2}):(\d{2})$/.exec(value?.trim() ?? '')
  if (!match) {
    return null
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    return null
  }

  return hour * 60 + minute
}

function severityRank(severity: TripCheckSeverity) {
  if (severity === 'critical') {
    return 3
  }
  if (severity === 'warning') {
    return 2
  }
  return 1
}
