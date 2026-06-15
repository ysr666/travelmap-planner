import type {
  Day,
  ItineraryItem,
  LedgerExpense,
  LedgerExpenseCategory,
  LedgerExpenseLineItem,
  LedgerExpenseSource,
  LedgerExpenseSourceLink,
  LedgerOrderStatus,
  LedgerParticipant,
  LedgerPaymentStatus,
  LedgerSourceRole,
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
  sourceLink: LedgerExpenseSourceLink
  sourceRole: LedgerSourceRole
  extractedText: string
  merchant?: string
  city?: string
  orderNumber?: string
  itemIds: string[]
  bookedAt?: string
  paidAt?: string
  serviceStartAt?: string
  serviceEndAt?: string
  cancelledAt?: string
  refundedAt?: string
  paymentStatus: LedgerPaymentStatus
  orderStatus: LedgerOrderStatus
  recognitionConfidence: number
  lineItems: LedgerExpenseLineItem[]
  warnings: string[]
}

export function sanitizeLedgerExtractionTextForAi(text: string) {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[邮箱已移除]')
    .replace(/https?:\/\/\S+/gi, '[链接已移除]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[标识已移除]')
    .replace(/\bauthorization\b\s*[:=]?\s*bearer\s+\S+/gi, '[敏感字段已移除]')
    .replace(/\b(?:authorization|bearer|api[_ -]?key|password|passwd|otp|验证码)\b\s*[:=]?\s*\S+/gi, '[敏感字段已移除]')
    .replace(/(?:订单号|预订号|确认号|order|booking|confirmation)\s*(?:number|no\.?|#|编号|号)?\s*[:：#]?\s*[A-Z0-9-]{5,}/gi, '[订单号已移除]')
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
      itemIds: ticket.itemId ? [ticket.itemId] : [],
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
      itemIds: [],
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
      itemIds: [],
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
      itemIds: [item.id],
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
  itemIds = [],
}: {
  category?: LedgerExpenseCategory
  date?: string
  fallbackCurrency: string
  fallbackTitle: string
  participants: LedgerParticipant[]
  source: LedgerExpenseSource
  text: string
  tripStartDate: string
  itemIds?: string[]
}) {
  const currency = detectCurrency(text) ?? fallbackCurrency
  const amountText = extractAmountText(text)
  const amountMinor = amountText ? parseMoneyInput(amountText, currency) : undefined
  const payer = participants.find((participant) => text.toLocaleLowerCase().includes(participant.displayName.toLocaleLowerCase()))
  const warnings: string[] = []
  const sourceRole = detectSourceRole(text)
  const paymentStatus = detectPaymentStatus(text, sourceRole)
  const orderStatus = detectOrderStatus(text)
  const expenseCategory = category ?? detectCategory(text)
  const dates = extractLifecycleDates(text, date ?? tripStartDate)
  const orderNumber = extractOrderNumber(text)
  const merchant = extractMerchant(text, fallbackTitle)
  const city = extractCity(text)
  const lineItems = extractLineItems(text, currency, expenseCategory)
  if (amountMinor == null) warnings.push('未识别到金额')
  if (!payer) warnings.push('未识别到付款人')
  if (!orderNumber) warnings.push('缺少订单号')
  if (itemIds.length === 0) warnings.push('未关联行程')
  if (lineItems.length > 0 && amountMinor != null && lineItems.reduce((sum, item) => sum + item.amountMinor, 0) !== amountMinor) {
    warnings.push('账单明细与总额不一致')
  }
  const recognitionConfidence = calculateLedgerCandidateConfidence({
    amountMinor,
    category: expenseCategory,
    currency,
    date: dates.serviceStartAt ?? dates.paidAt ?? dates.bookedAt,
    orderNumber,
    paymentStatus,
  })
  const capturedAt = new Date().toISOString()
  return {
    amountMinor,
    category: expenseCategory,
    currency,
    date: (dates.serviceStartAt ?? dates.paidAt ?? dates.bookedAt ?? tripStartDate).slice(0, 10),
    extractedText: text,
    itemIds,
    lineItems: lineItems.length > 0 && amountMinor != null && lineItems.reduce((sum, item) => sum + item.amountMinor, 0) === amountMinor ? lineItems : [],
    merchant,
    city,
    orderNumber,
    orderStatus,
    paymentStatus,
    payerParticipantId: payer?.id,
    recognitionConfidence,
    source,
    sourceLink: {
      ...source,
      available: true,
      capturedAt,
      id: `${source.kind}:${source.sourceId ?? source.fingerprint ?? fingerprintText(text)}`,
      role: sourceRole,
      title: source.label ?? fallbackTitle,
    },
    sourceRole,
    title: fallbackTitle.trim() || '待整理费用',
    ...dates,
    warnings,
  } satisfies LedgerExpenseDraftCandidate
}

export function canAutoConfirmLedgerCandidate(candidate: LedgerExpenseDraftCandidate) {
  const lineItemsBalanced = candidate.lineItems.length === 0 || candidate.lineItems.reduce((sum, item) => sum + item.amountMinor, 0) === candidate.amountMinor
  return candidate.recognitionConfidence >= 0.85 &&
    candidate.amountMinor != null &&
    Boolean(candidate.currency) &&
    candidate.paymentStatus === 'paid' &&
    candidate.orderStatus !== 'cancelled' &&
    candidate.sourceRole !== 'refund_notice' &&
    lineItemsBalanced
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

function detectSourceRole(text: string): LedgerSourceRole {
  const value = text.toLocaleLowerCase()
  if (/退款|已退|refund|refunded/.test(value)) return 'refund_notice'
  if (/取消|cancel(?:led|ation)?/.test(value)) return 'cancellation_notice'
  if (/信用卡|银行卡|card ending|card charged|transaction alert/.test(value)) return 'credit_card_notice'
  if (/发票|invoice/.test(value)) return 'invoice'
  if (/实付|支付成功|已付款|payment received|paid|receipt/.test(value)) return 'payment_receipt'
  if (/订单确认|预订确认|booking confirmed|confirmation/.test(value)) return 'order_confirmation'
  return 'other'
}

function detectPaymentStatus(text: string, role: LedgerSourceRole): LedgerPaymentStatus {
  const value = text.toLocaleLowerCase()
  if (role === 'refund_notice') return /部分|partial/.test(value) ? 'partially_refunded' : 'refunded'
  if (role === 'payment_receipt' || role === 'credit_card_notice' || /已付款|支付成功|paid|charged/.test(value)) return 'paid'
  if (/未付款|待支付|unpaid|payment pending/.test(value)) return 'unpaid'
  return 'unknown'
}

function detectOrderStatus(text: string): LedgerOrderStatus {
  return /已取消|订单取消|cancel(?:led|ation)?/i.test(text) ? 'cancelled' : 'active'
}

function extractOrderNumber(text: string) {
  return text.match(/(?:订单号|预订号|确认号|order|booking|confirmation)\s*(?:number|no\.?|#|编号|号)?\s*[:：#]?\s*([A-Z0-9-]{5,})/i)?.[1]
}

function extractMerchant(text: string, fallback: string) {
  const labeled = text.match(/(?:商户|酒店|航空公司|merchant|vendor|provider)\s*[:：]\s*([^\n]{2,80})/i)?.[1]?.trim()
  return labeled || fallback.trim() || undefined
}

function extractCity(text: string) {
  const labeled = text.match(/(?:城市|目的地|city|destination)\s*[:：]\s*([^\n,，]{2,40})/i)?.[1]?.trim()
  if (labeled) return labeled
  return ['东京', '大阪', '京都', '首尔', '曼谷', '新加坡', '巴黎', '伦敦', '纽约', '上海', '北京', '杭州', '西安'].find((city) => text.includes(city))
}

function extractLifecycleDates(text: string, fallbackDate: string) {
  const find = (labels: string) => text.match(new RegExp(`(?:${labels})\\s*[:：]?\\s*(20\\d{2}-\\d{2}-\\d{2})(?:[ T](\\d{2}:\\d{2}))?`, 'i'))
  const format = (match: RegExpMatchArray | null) => match?.[1] ? `${match[1]}${match[2] ? `T${match[2]}` : ''}` : undefined
  const bookedAt = format(find('预订时间|下单时间|booking date|booked'))
  const paidAt = format(find('付款时间|支付时间|payment date|paid at'))
  const serviceStartAt = format(find('使用时间|入住时间|出发时间|演出时间|service date|check-in|departure'))
  const serviceEndAt = format(find('退房时间|结束时间|service end|check-out|arrival'))
  const cancelledAt = format(find('取消时间|cancelled at'))
  const refundedAt = format(find('退款时间|refunded at'))
  const generic = extractDate(text) ?? fallbackDate
  return {
    bookedAt: bookedAt ?? (detectSourceRole(text) === 'order_confirmation' ? generic : undefined),
    paidAt: paidAt ?? (detectPaymentStatus(text, detectSourceRole(text)) === 'paid' ? generic : undefined),
    serviceStartAt,
    serviceEndAt,
    cancelledAt: cancelledAt ?? (detectOrderStatus(text) === 'cancelled' ? generic : undefined),
    refundedAt: refundedAt ?? (detectSourceRole(text) === 'refund_notice' ? generic : undefined),
  }
}

function extractLineItems(text: string, currency: string, category: LedgerExpenseCategory): LedgerExpenseLineItem[] {
  const definitions: Array<{ kind: LedgerExpenseLineItem['kind']; label: string; pattern: RegExp }> = [
    { kind: 'base', label: '基础费用', pattern: /(?:小计|未税金额|subtotal|base fare|room charge)\s*[:：]?\s*(?:[A-Z]{3}|[¥￥$€£])?\s*(-?\d[\d,.]*)/i },
    { kind: 'tax', label: '税费', pattern: /(?:税费|税金|tax)\s*[:：]?\s*(?:[A-Z]{3}|[¥￥$€£])?\s*(-?\d[\d,.]*)/i },
    { kind: 'tip', label: '小费', pattern: /(?:小费|tip|gratuity)\s*[:：]?\s*(?:[A-Z]{3}|[¥￥$€£])?\s*(-?\d[\d,.]*)/i },
    { kind: 'discount', label: '折扣', pattern: /(?:折扣|优惠|discount)\s*[:：]?\s*(?:[A-Z]{3}|[¥￥$€£])?\s*(-?\d[\d,.]*)/i },
    { kind: 'refund', label: '退款', pattern: /(?:退款|refund)\s*[:：]?\s*(?:[A-Z]{3}|[¥￥$€£])?\s*(-?\d[\d,.]*)/i },
  ]
  return definitions.flatMap((definition, index) => {
    const raw = definition.pattern.exec(text)?.[1]
    if (!raw) return []
    const parsed = parseMoneyInput(raw.replace(/^-/, ''), currency)
    if (parsed == null) return []
    const negative = definition.kind === 'discount' || definition.kind === 'refund' || raw.startsWith('-')
    return [{ amountMinor: negative ? -parsed : parsed, category, currency, id: `line:${index}`, kind: definition.kind, title: definition.label }]
  })
}

export function calculateLedgerCandidateConfidence(input: {
  amountMinor?: number
  category: LedgerExpenseCategory
  currency?: string
  date?: string
  orderNumber?: string
  paymentStatus: LedgerPaymentStatus
}) {
  let score = 0
  if (input.amountMinor != null) score += 0.35
  if (input.currency) score += 0.15
  if (input.date) score += 0.1
  if (input.category !== 'other') score += 0.1
  if (input.paymentStatus === 'paid') score += 0.2
  if (input.orderNumber) score += 0.1
  return Math.round(score * 100) / 100
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
