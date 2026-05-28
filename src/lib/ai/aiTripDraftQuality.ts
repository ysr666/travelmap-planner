import type { AiTripDraft, AiTripDraftDay } from './aiTripDraft'
import type { TravelPace } from '../travelProfile'

const DENSE_DAY_LIMITS: Record<TravelPace, number> = {
  relaxed: 5,
  moderate: 6,
  compact: 8,
}

export type AiTripDraftQualityFinding = {
  id: string
  ruleId: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  dayDate?: string
  itemTitle?: string
}

export type AiTripDraftQualityOptions = {
  pace?: TravelPace
  mealTimeProtection?: boolean
}

export type AiTripDraftQualityResult = {
  status: 'clean' | 'has_warnings' | 'has_critical'
  infos: AiTripDraftQualityFinding[]
  warnings: AiTripDraftQualityFinding[]
  criticals: AiTripDraftQualityFinding[]
  summary: {
    infoCount: number
    warningCount: number
    criticalCount: number
    message: string
  }
}

let findingCounter = 0

function nextFindingId(): string {
  findingCounter += 1
  return `qf_${findingCounter}`
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

const GENERIC_TITLE_PATTERNS = [
  '景点参观',
  '自由活动',
  '上午游览',
  '下午参观',
  '上午参观',
  '下午游览',
  '景点游览',
  '景区游览',
  '自由游览',
  '自由参观',
  '观光游览',
  '景点活动',
]

function isGenericTitle(title: string): boolean {
  return GENERIC_TITLE_PATTERNS.some((p) => title === p)
}

const MEAL_KEYWORDS = ['午餐', '晚餐', '早餐', '餐', '用餐', '吃饭', 'lunch', 'dinner', 'breakfast', 'meal', 'cafe', 'coffee', '食']

function hasMealKeyword(title: string): boolean {
  const lower = title.toLowerCase()
  return MEAL_KEYWORDS.some((k) => lower.includes(k))
}

function checkDenseDay(
  day: AiTripDraftDay,
  dayLimit: number,
): AiTripDraftQualityFinding[] {
  const findings: AiTripDraftQualityFinding[] = []
  if (day.items.length > dayLimit) {
    findings.push({
      id: nextFindingId(),
      ruleId: 'dense_day',
      severity: 'warning',
      title: '当天行程偏密',
      message: `${day.date} 安排了 ${day.items.length} 个行程点，建议不超过 ${dayLimit} 个。`,
      dayDate: day.date,
    })
  }
  return findings
}

function checkTimeIssues(day: AiTripDraftDay): AiTripDraftQualityFinding[] {
  const findings: AiTripDraftQualityFinding[] = []
  const timed = day.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.startTime && item.endTime)

  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]
      const b = timed[j]
      const aStart = timeToMinutes(a.item.startTime!)
      const aEnd = timeToMinutes(a.item.endTime!)
      const bStart = timeToMinutes(b.item.startTime!)
      const bEnd = timeToMinutes(b.item.endTime!)

      if (aStart > bStart) {
        // check overlap
        if (aStart < bEnd && bStart < aEnd) {
          findings.push({
            id: nextFindingId(),
            ruleId: 'time_overlap',
            severity: 'critical',
            title: '时间重叠',
            message: `${day.date}「${a.item.title}」与「${b.item.title}」时间重叠。`,
            dayDate: day.date,
            itemTitle: a.item.title,
          })
        }
      } else {
        if (bStart < aEnd && aStart < bEnd) {
          findings.push({
            id: nextFindingId(),
            ruleId: 'time_overlap',
            severity: 'critical',
            title: '时间重叠',
            message: `${day.date}「${a.item.title}」与「${b.item.title}」时间重叠。`,
            dayDate: day.date,
            itemTitle: a.item.title,
          })
        }
      }
    }
  }

  // short gap between adjacent timed items
  const sorted = [...timed].sort(
    (a, b) => timeToMinutes(a.item.startTime!) - timeToMinutes(b.item.startTime!),
  )
  for (let i = 0; i < sorted.length - 1; i++) {
    const aEnd = timeToMinutes(sorted[i].item.endTime!)
    const bStart = timeToMinutes(sorted[i + 1].item.startTime!)
    const gap = bStart - aEnd
    if (gap >= 0 && gap < 30) {
      findings.push({
        id: nextFindingId(),
        ruleId: 'short_gap',
        severity: 'warning',
        title: '行程间隔较短',
        message: `${day.date}「${sorted[i].item.title}」到「${sorted[i + 1].item.title}」仅间隔 ${gap} 分钟。`,
        dayDate: day.date,
        itemTitle: sorted[i].item.title,
      })
    }
  }

  // long day span
  if (sorted.length >= 2) {
    const firstStart = timeToMinutes(sorted[0].item.startTime!)
    const lastEnd = timeToMinutes(sorted[sorted.length - 1].item.endTime!)
    if (lastEnd - firstStart > 720) {
      findings.push({
        id: nextFindingId(),
        ruleId: 'long_day_span',
        severity: 'warning',
        title: '当天跨度过长',
        message: `${day.date} 从 ${sorted[0].item.startTime} 到 ${sorted[sorted.length - 1].item.endTime}，跨度超过 12 小时。`,
        dayDate: day.date,
      })
    }
  }

  return findings
}

function checkMissingLocation(day: AiTripDraftDay): AiTripDraftQualityFinding[] {
  const findings: AiTripDraftQualityFinding[] = []
  for (const item of day.items) {
    if (!item.locationName && !item.address) {
      findings.push({
        id: nextFindingId(),
        ruleId: 'missing_location',
        severity: 'warning',
        title: '缺少地点信息',
        message: `${day.date}「${item.title}」没有地点名称或地址。`,
        dayDate: day.date,
        itemTitle: item.title,
      })
    }
  }
  return findings
}

function checkGenericTitles(day: AiTripDraftDay): AiTripDraftQualityFinding[] {
  const findings: AiTripDraftQualityFinding[] = []
  const genericItems = day.items.filter((item) => isGenericTitle(item.title))
  if (genericItems.length >= 2) {
    findings.push({
      id: nextFindingId(),
      ruleId: 'generic_title',
      severity: 'warning',
      title: '标题过于笼统',
      message: `${day.date} 有 ${genericItems.length} 个行程点使用了笼统标题（如「${genericItems[0].title}」），建议补充具体内容。`,
      dayDate: day.date,
    })
  }
  return findings
}

function checkMealGap(
  day: AiTripDraftDay,
): AiTripDraftQualityFinding[] {
  const findings: AiTripDraftQualityFinding[] = []
  const timed = day.items.filter((item) => item.startTime)

  if (timed.length === 0) return findings

  const hasLunch = day.items.some(
    (item) => item.startTime && timeToMinutes(item.startTime) >= 690 && timeToMinutes(item.startTime) <= 810 && hasMealKeyword(item.title),
  )
  const hasDinner = day.items.some(
    (item) => item.startTime && timeToMinutes(item.startTime) >= 1050 && timeToMinutes(item.startTime) <= 1170 && hasMealKeyword(item.title),
  )

  const hasLunchTimeItems = timed.some(
    (item) => timeToMinutes(item.startTime!) >= 690 && timeToMinutes(item.startTime!) <= 810,
  )
  const hasDinnerTimeItems = timed.some(
    (item) => timeToMinutes(item.startTime!) >= 1050 && timeToMinutes(item.startTime!) <= 1170,
  )

  if (!hasLunch && hasLunchTimeItems) {
    findings.push({
      id: nextFindingId(),
      ruleId: 'meal_gap',
      severity: 'warning',
      title: '缺少午餐安排',
      message: `${day.date} 中午时段没有发现用餐安排。`,
      dayDate: day.date,
    })
  }

  if (!hasDinner && hasDinnerTimeItems) {
    findings.push({
      id: nextFindingId(),
      ruleId: 'meal_gap',
      severity: 'warning',
      title: '缺少晚餐安排',
      message: `${day.date} 傍晚时段没有发现用餐安排。`,
      dayDate: day.date,
    })
  }

  return findings
}

function checkMissingTransport(day: AiTripDraftDay): AiTripDraftQualityFinding[] {
  const findings: AiTripDraftQualityFinding[] = []
  for (let i = 1; i < day.items.length; i++) {
    const prev = day.items[i - 1]
    const curr = day.items[i]
    if (
      (prev.locationName || prev.address) &&
      (curr.locationName || curr.address) &&
      !curr.previousTransportMode
    ) {
      findings.push({
        id: nextFindingId(),
        ruleId: 'missing_transport',
        severity: 'info',
        title: '缺少交通信息',
        message: `${day.date}「${prev.title}」到「${curr.title}」缺少交通方式。`,
        dayDate: day.date,
        itemTitle: curr.title,
      })
    }
  }
  return findings
}

export function analyzeAiTripDraftQuality(
  draft: AiTripDraft,
  options?: AiTripDraftQualityOptions,
): AiTripDraftQualityResult {
  const pace = options?.pace ?? 'moderate'
  const mealTimeProtection = options?.mealTimeProtection ?? true
  const dayLimit = DENSE_DAY_LIMITS[pace] ?? DENSE_DAY_LIMITS.moderate

  const allInfos: AiTripDraftQualityFinding[] = []
  const allWarnings: AiTripDraftQualityFinding[] = []
  const allCriticals: AiTripDraftQualityFinding[] = []

  for (const day of draft.days) {
    const dayFindings = [
      ...checkDenseDay(day, dayLimit),
      ...checkTimeIssues(day),
      ...checkMissingLocation(day),
      ...checkGenericTitles(day),
      ...(mealTimeProtection ? checkMealGap(day) : []),
      ...checkMissingTransport(day),
    ]

    for (const f of dayFindings) {
      if (f.severity === 'critical') allCriticals.push(f)
      else if (f.severity === 'info') allInfos.push(f)
      else allWarnings.push(f)
    }
  }

  const infoCount = allInfos.length
  const warningCount = allWarnings.length
  const criticalCount = allCriticals.length

  let status: AiTripDraftQualityResult['status'] = 'clean'
  if (criticalCount > 0) status = 'has_critical'
  else if (warningCount > 0) status = 'has_warnings'

  let message = '未发现明显问题。'
  if (status === 'has_critical') {
    message = `发现 ${criticalCount} 个需要关注的问题和 ${warningCount} 个提醒。`
  } else if (status === 'has_warnings') {
    message = `发现 ${warningCount} 个提醒。`
  } else if (infoCount > 0) {
    message = `未发现明显问题，有 ${infoCount} 条补充信息。`
  }

  return {
    status,
    infos: allInfos,
    warnings: allWarnings,
    criticals: allCriticals,
    summary: { infoCount, warningCount, criticalCount, message },
  }
}

export function summarizeAiTripDraftQuality(result: AiTripDraftQualityResult): string {
  return result.summary.message
}
