import type {
  Day,
  ItineraryItem,
  LedgerExpense,
  LedgerExpenseCategory,
  LedgerExpenseSource,
  LedgerParticipant,
  TicketCategory,
  TicketMeta,
  TransportBooking,
  TravelInboxEntry,
} from '../types'
import { parseMoneyInput } from './ledger'

export type LedgerExpenseDraftCandidate = {
  title: string
  date: string
  category: LedgerExpenseCategory
  amountMinor?: number
  currency?: string
  payerParticipantId?: string
  source: LedgerExpenseSource
  extractedText: string
  warnings: string[]
}

export function sanitizeLedgerExtractionTextForAi(text: string) {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[邮箱已移除]')
    .replace(/https?:\/\/\S+/gi, '[链接已移除]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[标识已移除]')
    .replace(/\bauthorization\b\s*[:=]?\s*bearer\s+\S+/gi, '[敏感字段已移除]')
    .replace(/\b(?:authorization|bearer|api[_ -]?key|password|passwd|otp|验证码)\b\s*[:=]?\s*\S+/gi, '[敏感字段已移除]')
    .slice(0, 6000)
    .trim()
}

export function buildLedgerExpenseDraftCandidates({
  bookings,
  days,
  existingExpenses,
  inboxEntries,
  items,
  participants,
  tickets,
  sourceTextOverrides = {},
  tripStartDate,
  tripCurrency,
}: {
  bookings: TransportBooking[]
  days: Day[]
  existingExpenses: LedgerExpense[]
  inboxEntries: TravelInboxEntry[]
  items: ItineraryItem[]
  participants: LedgerParticipant[]
  tickets: TicketMeta[]
  sourceTextOverrides?: Record<string, string>
  tripStartDate: string
  tripCurrency: string
}) {
  const existingSources = new Set(existingExpenses.map((expense) => `${expense.source.kind}:${expense.source.sourceId ?? ''}`))
  const dayById = new Map(days.map((day) => [day.id, day]))
  const itemById = new Map(items.map((item) => [item.id, item]))
  const candidates: LedgerExpenseDraftCandidate[] = []
  for (const ticket of tickets) {
    if (existingSources.has(`ticket:${ticket.id}`)) continue
    const text = [ticket.title, ticket.fileName, ticket.note, sourceTextOverrides[`ticket:${ticket.id}`]].filter(Boolean).join('\n')
    const item = ticket.itemId ? itemById.get(ticket.itemId) : undefined
    candidates.push(buildCandidate({
      category: mapTicketCategory(ticket.ticketCategory),
      date: item ? dayById.get(item.dayId)?.date : undefined,
      fallbackCurrency: tripCurrency,
      fallbackTitle: ticket.title || ticket.fileName,
      participants,
      source: { fingerprint: fingerprintText(text), kind: 'ticket', label: ticket.fileName, sourceId: ticket.id },
      text,
      tripStartDate,
    }))
  }
  for (const entry of inboxEntries) {
    if (existingSources.has(`inbox:${entry.id}`)) continue
    candidates.push(buildCandidate({
      date: extractDate(entry.extractedText),
      fallbackCurrency: tripCurrency,
      fallbackTitle: entry.label || entry.fileName || '收件箱费用',
      participants,
      source: { fingerprint: fingerprintText(entry.extractedText), kind: 'inbox', label: entry.label, sourceId: entry.id },
      text: entry.extractedText,
      tripStartDate,
    }))
  }
  for (const booking of bookings) {
    if (existingSources.has(`transport_booking:${booking.id}`)) continue
    const text = [booking.title, booking.providerName, booking.sourceLabel].filter(Boolean).join('\n')
    candidates.push(buildCandidate({
      category: 'transport',
      fallbackCurrency: tripCurrency,
      fallbackTitle: booking.title,
      participants,
      source: { fingerprint: fingerprintText(text), kind: 'transport_booking', label: booking.title, sourceId: booking.id },
      text,
      tripStartDate,
    }))
  }
  for (const item of items) {
    if (!item.notes || existingSources.has(`itinerary_note:${item.id}`) || !containsAmountHint(item.notes)) continue
    candidates.push(buildCandidate({
      date: dayById.get(item.dayId)?.date,
      fallbackCurrency: tripCurrency,
      fallbackTitle: item.title,
      participants,
      source: { fingerprint: fingerprintText(item.notes), kind: 'itinerary_note', label: item.title, sourceId: item.id },
      text: item.notes,
      tripStartDate,
    }))
  }
  return candidates.filter((candidate) => candidate.extractedText.trim() || candidate.source.kind === 'transport_booking')
}

export function buildCandidate({
  category,
  date,
  fallbackCurrency,
  fallbackTitle,
  participants,
  source,
  text,
  tripStartDate,
}: {
  category?: LedgerExpenseCategory
  date?: string
  fallbackCurrency: string
  fallbackTitle: string
  participants: LedgerParticipant[]
  source: LedgerExpenseSource
  text: string
  tripStartDate: string
}) {
  const currency = detectCurrency(text) ?? fallbackCurrency
  const amountText = extractAmountText(text)
  const amountMinor = amountText ? parseMoneyInput(amountText, currency) : undefined
  const payer = participants.find((participant) => text.toLocaleLowerCase().includes(participant.displayName.toLocaleLowerCase()))
  const warnings: string[] = []
  if (amountMinor == null) warnings.push('未识别到金额')
  if (!payer) warnings.push('未识别到付款人')
  return {
    amountMinor,
    category: category ?? detectCategory(text),
    currency,
    date: date ?? extractDate(text) ?? tripStartDate,
    extractedText: text,
    payerParticipantId: payer?.id,
    source,
    title: fallbackTitle.trim() || '待整理费用',
    warnings,
  } satisfies LedgerExpenseDraftCandidate
}

function extractAmountText(text: string) {
  const normalized = text.replace(/\s+/g, ' ')
  const labeled = normalized.match(/(?:总计|合计|实付|支付|amount|total|paid)\s*[:：]?\s*(?:CNY|RMB|USD|EUR|JPY|HKD|GBP|THB|KRW|SGD|AUD|CAD|¥|￥|\$|€|£)?\s*(-?\d[\d,.]*)/i)
  if (labeled?.[1]) return labeled[1]
  const symbol = normalized.match(/(?:CNY|RMB|USD|EUR|JPY|HKD|GBP|THB|KRW|SGD|AUD|CAD|¥|￥|\$|€|£)\s*(-?\d[\d,.]*)/i)
  return symbol?.[1]
}

function containsAmountHint(text: string) {
  return Boolean(extractAmountText(text) || /\d+(?:[.,]\d{1,2})?\s*(?:元|美元|欧元|日元|港币|泰铢|韩元)/.test(text))
}

function detectCurrency(text: string) {
  const value = text.toUpperCase()
  if (/\b(?:CNY|RMB)\b|￥/.test(value)) return 'CNY'
  if (/\bUSD\b|\$/.test(value)) return 'USD'
  if (/\bEUR\b|€/.test(value)) return 'EUR'
  if (/\bJPY\b|日元/.test(value)) return 'JPY'
  if (/\bHKD\b|港币/.test(value)) return 'HKD'
  if (/\bGBP\b|£/.test(value)) return 'GBP'
  if (/\bTHB\b|泰铢/.test(value)) return 'THB'
  if (/\bKRW\b|韩元/.test(value)) return 'KRW'
  if (/\bSGD\b/.test(value)) return 'SGD'
  if (/\bAUD\b/.test(value)) return 'AUD'
  if (/\bCAD\b/.test(value)) return 'CAD'
  return undefined
}

function detectCategory(text: string): LedgerExpenseCategory {
  const value = text.toLocaleLowerCase()
  if (/酒店|住宿|hotel|hostel|民宿/.test(value)) return 'lodging'
  if (/机票|火车|高铁|地铁|出租|打车|公交|flight|train|taxi|uber|交通/.test(value)) return 'transport'
  if (/门票|入场|museum|ticket|admission/.test(value)) return 'admission'
  if (/餐|饭|咖啡|酒吧|restaurant|cafe|food/.test(value)) return 'food'
  if (/保险|insurance/.test(value)) return 'insurance'
  if (/电话卡|流量|漫游|sim|esim|wifi/.test(value)) return 'connectivity'
  if (/购物|商场|纪念品|shopping|store/.test(value)) return 'shopping'
  return 'other'
}

function mapTicketCategory(category: TicketCategory | undefined): LedgerExpenseCategory {
  if (category === 'hotel_booking') return 'lodging'
  if (category === 'restaurant_reservation') return 'food'
  if (category === 'admission_ticket') return 'admission'
  if (category === 'flight_ticket' || category === 'train_ticket' || category === 'transport_booking') return 'transport'
  return 'other'
}

function extractDate(text: string) {
  return text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]
}

function fingerprintText(text: string) {
  let hash = 2166136261
  for (const character of text.trim().toLocaleLowerCase()) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
