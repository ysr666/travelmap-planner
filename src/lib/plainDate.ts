export type PlainDateParts = {
  year: number
  month: number
  day: number
}

const PLAIN_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const CHINESE_WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function parsePlainDate(value: string | null | undefined): PlainDateParts | null {
  if (typeof value !== 'string') {
    return null
  }

  const match = PLAIN_DATE_PATTERN.exec(value)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12) {
    return null
  }

  const maxDay = getDaysInMonth(year, month)
  if (day < 1 || day > maxDay) {
    return null
  }

  return { year, month, day }
}

export function isValidPlainDate(value: string | null | undefined): value is string {
  return parsePlainDate(value) !== null
}

export function formatPlainDate(parts: PlainDateParts) {
  return `${parts.year.toString().padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}`
}

export function formatPlainDateChinese(value: string) {
  const parts = parsePlainDate(value)
  return parts ? `${parts.year}年${parts.month}月${parts.day}日` : null
}

export function formatPlainShortDateChinese(value: string) {
  const parts = parsePlainDate(value)
  return parts ? `${parts.month}月${parts.day}日` : null
}

export function getPlainDateChineseWeekday(value: string) {
  const parts = parsePlainDate(value)
  return parts ? CHINESE_WEEKDAYS[getWeekdayIndex(parts)] : null
}

export function formatPlainShortDateWithWeekdayChinese(value: string) {
  const shortDate = formatPlainShortDateChinese(value)
  const weekday = getPlainDateChineseWeekday(value)
  return shortDate && weekday ? `${shortDate} ${weekday}` : null
}

export function listPlainDateRangeInclusive(startDate: string, endDate: string) {
  const start = parsePlainDate(startDate)
  const end = parsePlainDate(endDate)
  if (!start || !end || startDate > endDate) {
    return []
  }

  const dates: string[] = []
  let cursor = start
  let cursorKey = formatPlainDate(cursor)

  while (cursorKey <= endDate) {
    dates.push(cursorKey)
    cursor = addOneDay(cursor)
    cursorKey = formatPlainDate(cursor)
  }

  return dates
}

function addOneDay(parts: PlainDateParts): PlainDateParts {
  const maxDay = getDaysInMonth(parts.year, parts.month)
  if (parts.day < maxDay) {
    return { ...parts, day: parts.day + 1 }
  }

  if (parts.month < 12) {
    return { year: parts.year, month: parts.month + 1, day: 1 }
  }

  return { year: parts.year + 1, month: 1, day: 1 }
}

function getWeekdayIndex(parts: PlainDateParts) {
  const monthOffsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  let year = parts.year
  if (parts.month < 3) {
    year -= 1
  }
  const index =
    year +
    Math.floor(year / 4) -
    Math.floor(year / 100) +
    Math.floor(year / 400) +
    monthOffsets[parts.month - 1] +
    parts.day

  return ((index % 7) + 7) % 7
}

function getDaysInMonth(year: number, month: number) {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function pad(value: number) {
  return value.toString().padStart(2, '0')
}
