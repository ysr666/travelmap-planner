import {
  DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
  extractExistingTripImportSources,
  type ExistingTripImportOcrLanguage,
} from './ai/existingTripImportExtraction'
import type { TransportBookingKind } from '../types'

export type TransportImportPreview = {
  arrivalDate?: string
  arrivalPlace?: string
  arrivalTime?: string
  departureDate?: string
  departurePlace?: string
  departureTime?: string
  extractedText: string
  kind: TransportBookingKind
  providerName?: string
  serviceNumber?: string
  title: string
  warnings: string[]
}

export async function extractTransportImportPreview({
  file,
  languages = [...DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES],
  pastedText,
}: {
  file?: File
  languages?: ExistingTripImportOcrLanguage[]
  pastedText?: string
}): Promise<TransportImportPreview> {
  const extraction = await extractExistingTripImportSources({
    files: file ? [file] : [],
    languages,
    pastedText,
  })
  const extractedText = extraction.sources.map((source) => source.text).filter(Boolean).join('\n\n')
  const preview = buildTransportImportPreview(extractedText)
  return {
    ...preview,
    warnings: [
      ...extraction.warnings,
      ...preview.warnings,
      '交通票据仅在本机提取；应用后仍需逐项核对票面信息。',
    ],
  }
}

export function buildTransportImportPreview(text: string): TransportImportPreview {
  const normalized = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()
  const kind = inferKind(normalized)
  const dates = [...normalized.matchAll(/\b(20\d{2})[./-](0?[1-9]|1[0-2])[./-]([0-2]?\d|3[01])\b/g)]
    .map((match) => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`)
  const times = [...normalized.matchAll(/(?:^|\s)([0-2]?\d:[0-5]\d)(?=\s|$)/gm)].map((match) => match[1].padStart(5, '0'))
  const route = inferRoute(normalized)
  const serviceNumber = inferServiceNumber(normalized, kind)
  const providerName = inferProvider(normalized, serviceNumber)
  const warnings: string[] = []
  if (!normalized) warnings.push('没有可供提取的文本。')
  if (!route) warnings.push('未可靠识别起终点，请手动填写。')
  if (!dates[0]) warnings.push('未识别出发日期，请手动填写。')
  warnings.push('地点无法在离线模式下可靠推断 IANA 时区，预览将继承旅行默认时区。')
  const routeTitle = route ? `${route.departurePlace} → ${route.arrivalPlace}` : '导入的交通订单'
  return {
    arrivalDate: dates[1] ?? dates[0],
    arrivalPlace: route?.arrivalPlace,
    arrivalTime: times[1],
    departureDate: dates[0],
    departurePlace: route?.departurePlace,
    departureTime: times[0],
    extractedText: normalized,
    kind,
    providerName,
    serviceNumber,
    title: serviceNumber ? `${serviceNumber} ${routeTitle}` : routeTitle,
    warnings,
  }
}

function inferKind(text: string): TransportBookingKind {
  if (/(?:航班|flight|boarding|机场|airport|airlines?)/i.test(text)) return 'flight'
  if (/(?:火车|列车|train|railway|铁路|车次|12306)/i.test(text)) return 'train'
  if (/(?:邮轮|cruise)/i.test(text)) return 'cruise'
  if (/(?:轮渡|ferry)/i.test(text)) return 'ferry'
  if (/(?:巴士|大巴|coach|\bbus\b)/i.test(text)) return 'bus'
  return 'other'
}

function inferServiceNumber(text: string, kind: TransportBookingKind) {
  const pattern = kind === 'train'
    ? /(?:车次|train)?\s*([GCDZTKYSL]\s?\d{1,4})\b/i
    : /(?:航班|flight)?\s*([A-Z0-9]{2,3}\s?\d{2,4})\b/i
  return pattern.exec(text)?.[1]?.replace(/\s+/g, '').toUpperCase()
}

function inferProvider(text: string, serviceNumber?: string) {
  const labeled = /(?:承运方|航空公司|airline|carrier|operator)\s*[:：]?\s*([^\n]{2,40})/i.exec(text)?.[1]?.trim()
  if (labeled) return labeled
  if (!serviceNumber) return undefined
  return serviceNumber.replace(/\d+$/, '') || undefined
}

function inferRoute(text: string) {
  const arrow = /(?:from\s+)?([^\n|]{2,40}?)\s*(?:→|->|—>|至|到)\s*(?:to\s+)?([^\n|]{2,40})/i.exec(text)
  if (arrow) return { arrivalPlace: cleanPlace(arrow[2]), departurePlace: cleanPlace(arrow[1]) }
  const labeledFrom = /(?:出发地|departure|from)\s*[:：]?\s*([^\n,;|]{2,40})/i.exec(text)?.[1]
  const labeledTo = /(?:到达地|arrival|destination|to)\s*[:：]?\s*([^\n,;|]{2,40})/i.exec(text)?.[1]
  if (labeledFrom && labeledTo) return { arrivalPlace: cleanPlace(labeledTo), departurePlace: cleanPlace(labeledFrom) }
  return undefined
}

function cleanPlace(value: string) {
  return value.replace(/(?:出发地|到达地|departure|arrival|from|to)\s*[:：]?/gi, '').trim().slice(0, 80)
}
