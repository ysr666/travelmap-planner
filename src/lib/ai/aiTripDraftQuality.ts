import type { AiTripDraft, AiTripDraftDay, AiTripDraftItem } from './aiTripDraft'
import type { TravelPace } from '../travelProfile'

const DENSE_DAY_LIMITS: Record<TravelPace, number> = {
  relaxed: 5,
  moderate: 6,
  compact: 8,
}

export type AiTripDraftQualityFinding = {
  category: AiTripDraftQualityCategory
  id: string
  repairable: boolean
  ruleId: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  dayDate?: string
  itemTitle?: string
}

export type AiTripDraftQualityCategory =
  | 'dense_schedule'
  | 'duplicate_sight'
  | 'location'
  | 'meal'
  | 'time_conflict'
  | 'title_specificity'
  | 'transport'

export const AI_TRIP_DRAFT_QUALITY_CATEGORY_LABELS: Record<AiTripDraftQualityCategory, string> = {
  dense_schedule: '过密日程',
  duplicate_sight: '重复景点',
  location: '缺地点信息',
  meal: '用餐安排',
  time_conflict: '时间冲突',
  title_specificity: '标题具体度',
  transport: '交通合理性',
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

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function makeFinding({
  category,
  dayDate,
  itemTitle,
  message,
  repairable = true,
  ruleId,
  severity,
  stableKey,
  title,
}: Omit<AiTripDraftQualityFinding, 'id'> & { stableKey?: string }): AiTripDraftQualityFinding {
  return {
    category,
    dayDate,
    id: [
      ruleId,
      dayDate ?? 'trip',
      stableKey ?? itemTitle ?? title,
    ].map(stableIdPart).join(':'),
    itemTitle,
    message,
    repairable,
    ruleId,
    severity,
    title,
  }
}

function stableIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '')
    .slice(0, 80) || 'item'
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
      category: 'dense_schedule',
      id: '',
      repairable: true,
      ruleId: 'dense_day',
      severity: 'warning',
      title: '当天行程偏密',
      message: `${day.date} 安排了 ${day.items.length} 个行程点，建议不超过 ${dayLimit} 个。`,
      dayDate: day.date,
    })
  }
  return findings.map(makeFinding)
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
          findings.push(makeFinding({
            category: 'time_conflict',
            ruleId: 'time_overlap',
            repairable: true,
            severity: 'critical',
            title: '时间重叠',
            message: `${day.date}「${a.item.title}」与「${b.item.title}」时间重叠。`,
            dayDate: day.date,
            itemTitle: a.item.title,
            stableKey: `${a.index}-${a.item.title}-${b.index}-${b.item.title}`,
          }))
        }
      } else {
        if (bStart < aEnd && aStart < bEnd) {
          findings.push(makeFinding({
            category: 'time_conflict',
            ruleId: 'time_overlap',
            repairable: true,
            severity: 'critical',
            title: '时间重叠',
            message: `${day.date}「${a.item.title}」与「${b.item.title}」时间重叠。`,
            dayDate: day.date,
            itemTitle: a.item.title,
            stableKey: `${a.index}-${a.item.title}-${b.index}-${b.item.title}`,
          }))
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
      findings.push(makeFinding({
        category: 'transport',
        ruleId: 'short_gap',
        repairable: true,
        severity: 'warning',
        title: '行程间隔较短',
        message: `${day.date}「${sorted[i].item.title}」到「${sorted[i + 1].item.title}」仅间隔 ${gap} 分钟。`,
        dayDate: day.date,
        itemTitle: sorted[i].item.title,
        stableKey: `${sorted[i].index}-${sorted[i].item.title}-${sorted[i + 1].index}-${sorted[i + 1].item.title}`,
      }))
    }
  }

  // long day span
  if (sorted.length >= 2) {
    const firstStart = timeToMinutes(sorted[0].item.startTime!)
    const lastEnd = timeToMinutes(sorted[sorted.length - 1].item.endTime!)
    if (lastEnd - firstStart > 720) {
      findings.push(makeFinding({
        category: 'dense_schedule',
        ruleId: 'long_day_span',
        repairable: true,
        severity: 'warning',
        title: '当天跨度过长',
        message: `${day.date} 从 ${sorted[0].item.startTime} 到 ${sorted[sorted.length - 1].item.endTime}，跨度超过 12 小时。`,
        dayDate: day.date,
      }))
    }
  }

  return findings
}

function checkMissingLocation(day: AiTripDraftDay): AiTripDraftQualityFinding[] {
  const findings: AiTripDraftQualityFinding[] = []
  for (const [index, item] of day.items.entries()) {
    if (!item.locationName && !item.address) {
      findings.push(makeFinding({
        category: 'location',
        ruleId: 'missing_location',
        repairable: true,
        severity: 'warning',
        title: '缺少地点信息',
        message: `${day.date}「${item.title}」没有地点名称或地址。`,
        dayDate: day.date,
        itemTitle: item.title,
        stableKey: `${index}-${item.title}`,
      }))
    }
  }
  return findings
}

function checkGenericTitles(day: AiTripDraftDay): AiTripDraftQualityFinding[] {
  const findings: AiTripDraftQualityFinding[] = []
  const genericItems = day.items.filter((item) => isGenericTitle(item.title))
  if (genericItems.length >= 2) {
    findings.push(makeFinding({
      category: 'title_specificity',
      ruleId: 'generic_title',
      repairable: true,
      severity: 'warning',
      title: '标题过于笼统',
      message: `${day.date} 有 ${genericItems.length} 个行程点使用了笼统标题（如「${genericItems[0].title}」），建议补充具体内容。`,
      dayDate: day.date,
      stableKey: genericItems.map((item) => item.title).join('-'),
    }))
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
    findings.push(makeFinding({
      category: 'meal',
      ruleId: 'meal_gap',
      repairable: true,
      severity: 'warning',
      title: '缺少午餐安排',
      message: `${day.date} 中午时段没有发现用餐安排。`,
      dayDate: day.date,
      stableKey: 'lunch',
    }))
  }

  if (!hasDinner && hasDinnerTimeItems) {
    findings.push(makeFinding({
      category: 'meal',
      ruleId: 'meal_gap',
      repairable: true,
      severity: 'warning',
      title: '缺少晚餐安排',
      message: `${day.date} 傍晚时段没有发现用餐安排。`,
      dayDate: day.date,
      stableKey: 'dinner',
    }))
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
      findings.push(makeFinding({
        category: 'transport',
        ruleId: 'missing_transport',
        repairable: true,
        severity: 'info',
        title: '缺少交通信息',
        message: `${day.date}「${prev.title}」到「${curr.title}」缺少交通方式。`,
        dayDate: day.date,
        itemTitle: curr.title,
        stableKey: `${i}-${prev.title}-${curr.title}`,
      }))
    }
  }
  return findings
}

function checkUnreasonableTransport(day: AiTripDraftDay): AiTripDraftQualityFinding[] {
  const findings: AiTripDraftQualityFinding[] = []
  for (let i = 1; i < day.items.length; i++) {
    const prev = day.items[i - 1]
    const curr = day.items[i]
    const duration = curr.previousTransportDurationMinutes
    if (duration === undefined || duration === null) continue

    const samePlace = normalizeSightKey(curr) && normalizeSightKey(curr) === normalizeSightKey(prev)
    if (duration <= 0 && !samePlace) {
      findings.push(makeFinding({
        category: 'transport',
        dayDate: day.date,
        itemTitle: curr.title,
        message: `${day.date}「${prev.title}」到「${curr.title}」交通耗时为 ${duration} 分钟，建议重新估算。`,
        repairable: true,
        ruleId: 'unreasonable_transport',
        severity: 'warning',
        stableKey: `${i}-${prev.title}-${curr.title}-zero`,
        title: '交通耗时不合理',
      }))
    } else if (curr.previousTransportMode === 'walk' && duration > 60) {
      findings.push(makeFinding({
        category: 'transport',
        dayDate: day.date,
        itemTitle: curr.title,
        message: `${day.date}「${prev.title}」到「${curr.title}」步行约 ${duration} 分钟，建议改用公共交通或打车。`,
        repairable: true,
        ruleId: 'unreasonable_transport',
        severity: 'warning',
        stableKey: `${i}-${prev.title}-${curr.title}-walk-long`,
        title: '交通方式不合理',
      }))
    } else if ((curr.previousTransportMode === 'car' || curr.previousTransportMode === 'transit' || curr.previousTransportMode === 'bus') && duration < 3 && !samePlace) {
      findings.push(makeFinding({
        category: 'transport',
        dayDate: day.date,
        itemTitle: curr.title,
        message: `${day.date}「${prev.title}」到「${curr.title}」交通耗时仅 ${duration} 分钟，建议确认地点是否重复或耗时是否低估。`,
        repairable: true,
        ruleId: 'unreasonable_transport',
        severity: 'warning',
        stableKey: `${i}-${prev.title}-${curr.title}-too-short`,
        title: '交通耗时可能低估',
      }))
    }
  }
  return findings
}

function checkDuplicateSights(draft: AiTripDraft): AiTripDraftQualityFinding[] {
  const sightings = new Map<string, Array<{ dayDate: string; item: AiTripDraftItem }>>()
  for (const day of draft.days) {
    for (const item of day.items) {
      const key = normalizeSightKey(item)
      if (!key) continue
      const values = sightings.get(key) ?? []
      values.push({ dayDate: day.date, item })
      sightings.set(key, values)
    }
  }

  const findings: AiTripDraftQualityFinding[] = []
  for (const [key, values] of sightings.entries()) {
    if (values.length < 2) continue
    const first = values[0]
    findings.push(makeFinding({
      category: 'duplicate_sight',
      dayDate: first.dayDate,
      itemTitle: first.item.title,
      message: `「${first.item.locationName || first.item.title}」在草案中出现了 ${values.length} 次，建议合并或替换其中一次。`,
      repairable: true,
      ruleId: 'duplicate_sight',
      severity: 'warning',
      stableKey: key,
      title: '重复景点',
    }))
  }
  return findings
}

function normalizeSightKey(item: AiTripDraftItem): string {
  const value = item.locationName || item.address || item.title
  return normalizeComparableText(value)
}

function normalizeComparableText(value?: string): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s+/g, '')
    .replace(/[·・.,，。:：;；'"“”‘’]/g, '')
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
      ...checkUnreasonableTransport(day),
    ]

    for (const f of dayFindings) {
      if (f.severity === 'critical') allCriticals.push(f)
      else if (f.severity === 'info') allInfos.push(f)
      else allWarnings.push(f)
    }
  }

  for (const f of checkDuplicateSights(draft)) {
    if (f.severity === 'critical') allCriticals.push(f)
    else if (f.severity === 'info') allInfos.push(f)
    else allWarnings.push(f)
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

export function flattenAiTripDraftQualityFindings(result: AiTripDraftQualityResult): AiTripDraftQualityFinding[] {
  return [...result.criticals, ...result.warnings, ...result.infos]
}

export function shouldSelectAiTripDraftQualityFindingByDefault(finding: AiTripDraftQualityFinding): boolean {
  return finding.repairable && finding.severity !== 'info'
}

export function selectDefaultAiTripDraftQualityFindingIds(result: AiTripDraftQualityResult): string[] {
  return flattenAiTripDraftQualityFindings(result)
    .filter(shouldSelectAiTripDraftQualityFindingByDefault)
    .map((finding) => finding.id)
}
