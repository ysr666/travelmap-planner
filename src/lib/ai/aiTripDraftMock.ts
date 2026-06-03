import type { AiTripDraft, AiTripDraftDay, AiTripDraftItem } from './aiTripDraft'
import type { AiTripDraftRequest } from './aiTripDraftRequest'
import { listPlainDateRangeInclusive } from '../plainDate'

const MORNING_ITEMS: Array<Pick<AiTripDraftItem, 'title' | 'startTime' | 'endTime'>> = [
  { title: '上午游览', startTime: '09:00', endTime: '11:00' },
  { title: '上午参观', startTime: '09:30', endTime: '11:30' },
  { title: '上午探索', startTime: '08:30', endTime: '10:30' },
]

const LUNCH_ITEMS: Array<Pick<AiTripDraftItem, 'title' | 'startTime' | 'endTime'>> = [
  { title: '午餐体验', startTime: '12:00', endTime: '13:30' },
  { title: '午餐休息', startTime: '11:30', endTime: '13:00' },
  { title: '午餐时间', startTime: '12:30', endTime: '14:00' },
]

const AFTERNOON_ITEMS: Array<Pick<AiTripDraftItem, 'title' | 'startTime' | 'endTime'>> = [
  { title: '下午参观', startTime: '14:00', endTime: '16:30' },
  { title: '下午游览', startTime: '14:30', endTime: '17:00' },
  { title: '下午体验', startTime: '13:30', endTime: '16:00' },
]

const EVENING_ITEMS: Array<Pick<AiTripDraftItem, 'title' | 'startTime' | 'endTime'>> = [
  { title: '晚间散步', startTime: '18:00', endTime: '19:30' },
  { title: '晚间休息', startTime: '18:30', endTime: '20:00' },
  { title: '晚间活动', startTime: '17:30', endTime: '19:00' },
]

const DAY_TITLES = [
  '第一天',
  '第二天',
  '第三天',
  '第四天',
  '第五天',
  '第六天',
  '第七天',
]

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]
}

function generateDayItems(dayIndex: number, destinationHash: number): AiTripDraftItem[] {
  const seed = destinationHash + dayIndex
  const items: AiTripDraftItem[] = [
    { ...pick(MORNING_ITEMS, seed), previousTransportDurationMinutes: 0 },
    { ...pick(LUNCH_ITEMS, seed + 1), previousTransportDurationMinutes: 18, previousTransportMode: 'walk' },
    { ...pick(AFTERNOON_ITEMS, seed + 2), previousTransportDurationMinutes: 24, previousTransportMode: 'transit' },
  ]

  // Add evening item on ~half the days (deterministic based on seed)
  if ((seed + dayIndex) % 3 === 0) {
    items.push({ ...pick(EVENING_ITEMS, seed + 3), previousTransportDurationMinutes: 20, previousTransportMode: 'walk' })
  }

  return items
}

export function generateMockAiTripDraft(request: AiTripDraftRequest): AiTripDraft {
  const dates = listPlainDateRangeInclusive(request.startDate, request.endDate)
  const destinationHash = simpleHash(request.destination)
  const interestText = [
    ...(request.interestTags ?? []),
    request.interestText,
    request.mustVisitText,
  ].filter(Boolean).join('、')

  const days: AiTripDraftDay[] = dates.map((date, dayIndex) => ({
    date,
    title: `${pick(DAY_TITLES, dayIndex)} · ${request.destination}探索`,
    tips: [
      request.partySize ? `按 ${request.partySize} 人同行预留集合和用餐时间。` : '预留集合和用餐缓冲时间。',
      interestText ? `当天安排会照顾偏好：${interestText}。` : '出发前核对开放时间和现场预约要求。',
    ],
    items: generateDayItems(dayIndex, destinationHash).map((item, itemIndex) => ({
      ...item,
      locationName: `${request.destination}${item.title}`,
      note: item.note ?? (itemIndex === 0 && request.mustVisitText ? `优先覆盖必去地点：${request.mustVisitText}` : undefined),
      previousTransportMode: itemIndex === 0
        ? item.previousTransportMode
        : normalizeTransportModeForMock(request.preferTransport, item.previousTransportMode),
      previousTransportNote: itemIndex === 0
        ? undefined
        : `按${formatTransportPreference(request.preferTransport)}估算，导入后可生成路线预览核对。`,
    })),
  }))

  return {
    title: `${request.destination}之旅`,
    destination: request.destination,
    startDate: request.startDate,
    endDate: request.endDate,
    days,
  }
}

function normalizeTransportModeForMock(
  preference: AiTripDraftRequest['preferTransport'],
  fallback: AiTripDraftItem['previousTransportMode'],
) {
  if (preference === 'walking') return 'walk'
  if (preference === 'taxi') return 'car'
  if (preference === 'public_transport') return 'transit'
  return fallback
}

function formatTransportPreference(preference: AiTripDraftRequest['preferTransport']) {
  if (preference === 'walking') return '步行'
  if (preference === 'taxi') return '打车'
  if (preference === 'public_transport') return '公共交通'
  return '综合交通'
}
