import {
  DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
  extractExistingTripImportSources,
  type ExistingTripImportOcrLanguage,
} from './ai/existingTripImportExtraction'
import type {
  StructuredTravelFieldEvidence,
  TransportBookingKind,
} from '../types'

export type TransportImportFieldKey =
  | 'arrivalCode'
  | 'arrivalDate'
  | 'arrivalPlace'
  | 'arrivalPlatform'
  | 'arrivalTerminal'
  | 'arrivalTime'
  | 'departureCode'
  | 'departureDate'
  | 'departurePlace'
  | 'departurePlatform'
  | 'departureTerminal'
  | 'departureTime'
  | 'providerCode'
  | 'providerName'
  | 'serviceNumber'

export type TransportImportPreview = {
  arrivalCode?: string
  arrivalDate?: string
  arrivalPlace?: string
  arrivalPlatform?: string
  arrivalTerminal?: string
  arrivalTime?: string
  departureCode?: string
  departureDate?: string
  departurePlace?: string
  departurePlatform?: string
  departureTerminal?: string
  departureTime?: string
  extractedText: string
  fieldEvidence: Partial<Record<TransportImportFieldKey, StructuredTravelFieldEvidence>>
  kind: TransportBookingKind
  privateFields?: {
    orderNumber?: string
    pnr?: string
    seat?: string
  }
  providerCode?: string
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
  const providerCode = inferProviderCode(kind, serviceNumber)
  const terminals = inferTerminals(normalized)
  const platforms = inferPlatforms(normalized)
  const privateFields = inferPrivateFields(normalized)
  const warnings: string[] = []
  if (!normalized) warnings.push('没有可供提取的文本。')
  if (!route) warnings.push('未可靠识别起终点，请手动填写。')
  if (!dates[0]) warnings.push('未识别出发日期，请手动填写。')
  warnings.push('地点无法在离线模式下可靠推断 IANA 时区，预览将继承旅行默认时区。')
  const routeTitle = route ? `${route.departurePlace} → ${route.arrivalPlace}` : '导入的交通订单'
  const result: Omit<TransportImportPreview, 'fieldEvidence'> = {
    arrivalCode: route?.arrivalCode,
    arrivalDate: dates[1] ?? dates[0],
    arrivalPlace: route?.arrivalPlace,
    arrivalPlatform: platforms.arrival,
    arrivalTerminal: terminals.arrival,
    arrivalTime: times[1],
    departureCode: route?.departureCode,
    departureDate: dates[0],
    departurePlace: route?.departurePlace,
    departurePlatform: platforms.departure,
    departureTerminal: terminals.departure,
    departureTime: times[0],
    extractedText: normalized,
    kind,
    privateFields: Object.values(privateFields).some(Boolean) ? privateFields : undefined,
    providerCode,
    providerName,
    serviceNumber,
    title: serviceNumber ? `${serviceNumber} ${routeTitle}` : routeTitle,
    warnings,
  }
  return {
    ...result,
    fieldEvidence: buildFieldEvidence(result),
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

function inferProviderCode(kind: TransportBookingKind, serviceNumber?: string) {
  if (kind !== 'flight' || !serviceNumber) return undefined
  return /^([A-Z0-9]{2})\d{2,4}$/.exec(serviceNumber)?.[1]
    ?? /^([A-Z]{3})\d{2,4}$/.exec(serviceNumber)?.[1]
}

function inferRoute(text: string) {
  const arrow = /(?:from\s+)?([^\n|]{2,40}?)\s*(?:→|->|—>|至|到)\s*(?:to\s+)?([^\n|]{2,40})/i.exec(text)
  if (arrow) {
    const departure = parsePlaceAndCode(arrow[1])
    const arrival = parsePlaceAndCode(arrow[2])
    return {
      arrivalCode: arrival.code,
      arrivalPlace: arrival.place,
      departureCode: departure.code,
      departurePlace: departure.place,
    }
  }
  const labeledFrom = /(?:出发地|departure|from)\s*[:：]?\s*([^\n,;|]{2,40})/i.exec(text)?.[1]
  const labeledTo = /(?:到达地|arrival|destination|to)\s*[:：]?\s*([^\n,;|]{2,40})/i.exec(text)?.[1]
  if (labeledFrom && labeledTo) {
    const departure = parsePlaceAndCode(labeledFrom)
    const arrival = parsePlaceAndCode(labeledTo)
    return {
      arrivalCode: arrival.code,
      arrivalPlace: arrival.place,
      departureCode: departure.code,
      departurePlace: departure.place,
    }
  }
  return undefined
}

function parsePlaceAndCode(value: string) {
  const cleaned = cleanPlace(value)
  const codeMatch = /(?:\(|\b)([A-Z]{3})(?:\)|\b)\s*$/i.exec(cleaned)
  const code = codeMatch?.[1]?.toUpperCase()
  const place = codeMatch
    ? cleaned.slice(0, codeMatch.index).replace(/[（(\s]+$/, '').trim()
    : cleaned
  return { code, place: place || cleaned }
}

function inferTerminals(text: string) {
  return inferPairedLabels(text, {
    arrival: /(?:到达航站楼|arrival\s+terminal)\s*[:：]?\s*([A-Z0-9-]{1,12})/i,
    departure: /(?:出发航站楼|departure\s+terminal)\s*[:：]?\s*([A-Z0-9-]{1,12})/i,
  })
}

function inferPlatforms(text: string) {
  return inferPairedLabels(text, {
    arrival: /(?:到达站台|arrival\s+platform)\s*[:：]?\s*([A-Z0-9-]{1,12})/i,
    departure: /(?:出发站台|departure\s+platform|站台|platform)\s*[:：]?\s*([A-Z0-9-]{1,12})/i,
  })
}

function inferPairedLabels(text: string, patterns: { arrival: RegExp; departure: RegExp }) {
  return {
    arrival: patterns.arrival.exec(text)?.[1]?.toUpperCase(),
    departure: patterns.departure.exec(text)?.[1]?.toUpperCase(),
  }
}

function inferPrivateFields(text: string): NonNullable<TransportImportPreview['privateFields']> {
  return {
    orderNumber: /(?:订单号|order\s*(?:number|no\.?))\s*[:：#]?\s*([A-Z0-9-]{4,40})/i.exec(text)?.[1]?.toUpperCase(),
    pnr: /(?:PNR|预订编号|booking\s*(?:reference|ref))\s*[:：#]?\s*([A-Z0-9]{4,12})/i.exec(text)?.[1]?.toUpperCase(),
    seat: /(?:座位|seat)\s*[:：#]?\s*([A-Z0-9-]{1,12})/i.exec(text)?.[1]?.toUpperCase(),
  }
}

function buildFieldEvidence(
  preview: Omit<TransportImportPreview, 'fieldEvidence'>,
): TransportImportPreview['fieldEvidence'] {
  const evidence: TransportImportPreview['fieldEvidence'] = {}
  const highConfidence = new Set<TransportImportFieldKey>([
    'arrivalCode',
    'arrivalDate',
    'arrivalPlatform',
    'arrivalTerminal',
    'arrivalTime',
    'departureCode',
    'departureDate',
    'departurePlatform',
    'departureTerminal',
    'departureTime',
    'serviceNumber',
  ])
  const values: Partial<Record<TransportImportFieldKey, unknown>> = {
    arrivalCode: preview.arrivalCode,
    arrivalDate: preview.arrivalDate,
    arrivalPlace: preview.arrivalPlace,
    arrivalPlatform: preview.arrivalPlatform,
    arrivalTerminal: preview.arrivalTerminal,
    arrivalTime: preview.arrivalTime,
    departureCode: preview.departureCode,
    departureDate: preview.departureDate,
    departurePlace: preview.departurePlace,
    departurePlatform: preview.departurePlatform,
    departureTerminal: preview.departureTerminal,
    departureTime: preview.departureTime,
    providerCode: preview.providerCode,
    providerName: preview.providerName,
    serviceNumber: preview.serviceNumber,
  }
  for (const [key, value] of Object.entries(values) as Array<[TransportImportFieldKey, unknown]>) {
    if (!value) continue
    evidence[key] = {
      confidence: highConfidence.has(key) ? 'high' : 'medium',
      sourceType: 'local_import',
    }
  }
  return evidence
}

function cleanPlace(value: string) {
  return value.replace(/(?:出发地|到达地|departure|arrival|from|to)\s*[:：]?/gi, '').trim().slice(0, 80)
}
