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
    { ...pick(MORNING_ITEMS, seed) },
    { ...pick(LUNCH_ITEMS, seed + 1) },
    { ...pick(AFTERNOON_ITEMS, seed + 2) },
  ]

  // Add evening item on ~half the days (deterministic based on seed)
  if ((seed + dayIndex) % 3 === 0) {
    items.push({ ...pick(EVENING_ITEMS, seed + 3) })
  }

  return items
}

export function generateMockAiTripDraft(request: AiTripDraftRequest): AiTripDraft {
  const dates = listPlainDateRangeInclusive(request.startDate, request.endDate)
  const destinationHash = simpleHash(request.destination)

  const days: AiTripDraftDay[] = dates.map((date, dayIndex) => ({
    date,
    title: pick(DAY_TITLES, dayIndex),
    items: generateDayItems(dayIndex, destinationHash),
  }))

  return {
    title: `${request.destination}之旅`,
    destination: request.destination,
    startDate: request.startDate,
    endDate: request.endDate,
    days,
  }
}
