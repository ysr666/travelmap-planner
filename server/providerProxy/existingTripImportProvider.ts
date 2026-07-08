import {
  type ProviderProxyErrorCode,
  type ProviderProxyExistingTripImportRequest,
} from '../../src/lib/ai/providerProxyContract'
import type {
  ExistingTripImportConfidence,
  ExistingTripImportProviderCandidateItem,
  ExistingTripImportProviderCandidateNote,
  ExistingTripImportProviderCandidateTicket,
  ExistingTripImportProviderResult,
} from '../../src/lib/ai/existingTripImport'
import { extractJsonFromAiText } from './aiJson'
import type { AiBackendReasoningMode } from './aiReasoningPolicy'
import { EXISTING_TRIP_IMPORT_MAX_OUTPUT_TOKENS_HINT } from './aiDraftLimits'

export type ExistingTripImportProviderErrorCode = Extract<ProviderProxyErrorCode, 'provider_unavailable' | 'provider_error' | 'network_error' | 'unsupported' | 'invalid_response' | 'quota_exceeded'>

export type ExistingTripImportProviderResultValue =
  | { ok: true; result: ExistingTripImportProviderResult; source: 'mock' | 'future_ai'; warnings?: string[] }
  | { errorCode: ExistingTripImportProviderErrorCode; message?: string; ok: false }

export type ExistingTripImportProvider = {
  readonly name: string
  importTrip(request: ProviderProxyExistingTripImportRequest, input: ExistingTripImportProviderInput): Promise<ExistingTripImportProviderResultValue>
}

export type ExistingTripImportProviderInput = {
  maxOutputTokens: number
  prompt: string
  reasoningMode?: AiBackendReasoningMode
}

type OpenAiCompatibleEnv = {
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
}

type OpenAiCompatibleMessage = {
  content: string
  role: 'system' | 'user'
}

const REQUEST_TIMEOUT_MS = 60_000
const CHAT_COMPLETIONS_PATH = '/chat/completions'
const OPENAI_COMPATIBLE_JSON_RESPONSE_FORMAT = { type: 'json_object' } as const
const OPENAI_COMPATIBLE_THINKING_DISABLED = { type: 'disabled' } as const
const OPENAI_COMPATIBLE_THINKING_ENABLED = { type: 'enabled' } as const

export function buildExistingTripImportProviderInput(
  request: ProviderProxyExistingTripImportRequest,
  requestId?: string,
): ExistingTripImportProviderInput {
  return {
    maxOutputTokens: EXISTING_TRIP_IMPORT_MAX_OUTPUT_TOKENS_HINT,
    prompt: [
      '你是 TripMap 的现有旅行导入识别助手，只输出 JSON。',
      '你只能基于下方 extracted sources 识别日期、时间、地点、交通、票据和备注；不要编造输入文本之外的票据、地点、开放时间或价格。',
      '当前旅行摘要只用于匹配现有日期/行程点，不能输出 route/cache/cloud/ticket blob/provider metadata 操作。',
      '若能高置信合并到现有行程点，填写 targetItemId；低置信不要强行合并。',
      '票据候选只能来自明确订单、门票、航班、火车、酒店确认、二维码/凭证等文本；sourceFileId 必须引用来源 id。',
      '多材料或长行程时保持输出紧凑：每天最多 3 个核心行程点，每个 reason 不超过 20 个中文字符，note 仅保留会影响执行的提醒。',
      '必须返回完整可解析 JSON；如果内容太多，优先保留日期、固定时间、酒店、交通、门票，省略低置信 notes。',
      '输出中文 reason，短句。不要输出 Markdown、解释文字或代码块。',
      '输出 schema：{"days":[{"candidateId":"d1","date":"YYYY-MM-DD","title":"...","confidence":"medium","reason":"...","sourceIds":["..."]}],"items":[{"candidateId":"i1","date":"YYYY-MM-DD","title":"...","startTime":"HH:mm","endTime":"HH:mm","locationName":"...","address":"...","transportMode":"walk","previousTransportMode":"transit","previousTransportDurationMinutes":30,"previousTransportNote":"...","note":"...","targetItemId":"...","confidence":"high","reason":"...","sourceIds":["..."]}],"tickets":[{"candidateId":"t1","title":"...","date":"YYYY-MM-DD","itemTitle":"...","targetItemId":"...","sourceFileId":"...","fileName":"...","confidence":"high","reason":"...","sourceIds":["..."]}],"notes":[{"candidateId":"n1","text":"...","date":"YYYY-MM-DD","confidence":"medium","reason":"...","sourceIds":["..."]}],"warnings":["..."]}',
      `requestId: ${requestId ?? request.requestId ?? 'unknown'}`,
      `request: ${JSON.stringify(compactRequest(request))}`,
    ].join('\n'),
    reasoningMode: 'off',
  }
}

export function createMockExistingTripImportProvider(): ExistingTripImportProvider {
  return {
    name: 'mock',
    async importTrip(request) {
      return {
        ok: true,
        result: buildMockExistingTripImportResult(request),
        source: 'mock',
        warnings: ['当前为本地示例识别，非真实 AI 解析。'],
      }
    },
  }
}

export function createUnavailableExistingTripImportProvider(): ExistingTripImportProvider {
  return {
    name: 'unavailable',
    async importTrip() {
      return { errorCode: 'provider_unavailable', message: 'Existing trip import provider is not configured.', ok: false }
    },
  }
}

export function createDisabledExistingTripImportProvider(): ExistingTripImportProvider {
  return {
    name: 'disabled',
    async importTrip() {
      return { errorCode: 'unsupported', message: 'Existing trip import provider is disabled.', ok: false }
    },
  }
}

export function createOpenAiCompatibleExistingTripImportProvider(
  env: OpenAiCompatibleEnv,
  fetchImpl: typeof fetch = fetch,
): ExistingTripImportProvider {
  const apiKey = env.TRIPMAP_AI_API_KEY?.trim()
  const baseUrl = env.TRIPMAP_AI_BASE_URL?.trim()
  const model = env.TRIPMAP_AI_MODEL?.trim()

  return {
    name: 'openai_compatible',
    async importTrip(request, input): Promise<ExistingTripImportProviderResultValue> {
      if (!apiKey || !baseUrl || !model) {
        return { errorCode: 'provider_unavailable', message: 'AI provider environment is not fully configured.', ok: false }
      }
      const response = await requestOpenAiCompatibleExistingTripImport({
        apiKey,
        endpoint: joinUrl(baseUrl, CHAT_COMPLETIONS_PATH),
        fetchImpl,
        maxTokens: input.maxOutputTokens,
        messages: [{ content: input.prompt, role: 'system' }],
        model,
        reasoningMode: input.reasoningMode,
      })
      if (!response.ok) {
        return response
      }
      const normalized = normalizeExistingTripImportProviderOutput(response.rawText, request)
      if (!normalized.ok) {
        return normalized
      }
      return {
        ok: true,
        result: normalized.result,
        source: 'future_ai',
        warnings: normalized.warnings,
      }
    },
  }
}

export function normalizeExistingTripImportProviderOutput(
  rawText: string,
  request: ProviderProxyExistingTripImportRequest,
): { ok: true; result: ExistingTripImportProviderResult; warnings?: string[] } | { errorCode: 'invalid_response'; ok: false } {
  const parsed = extractJsonFromAiText(rawText)
  const record = readRecord(parsed)
  const validSourceIds = new Set(request.sources.map((source) => source.id))
  const itemIds = new Set(request.items.map((item) => item.id))
  const days = normalizeDays(record.days, validSourceIds)
  const items = normalizeItems(record.items, validSourceIds, itemIds)
  const tickets = normalizeTickets(record.tickets, validSourceIds, itemIds)
  const notes = normalizeNotes(record.notes, validSourceIds)
  if (!days && !items && !tickets && !notes) {
    return { errorCode: 'invalid_response', ok: false }
  }
  return {
    ok: true,
    result: {
      days,
      items,
      notes,
      tickets,
      warnings: readWarnings(record.warnings),
    },
    warnings: readWarnings(record.warnings),
  }
}

function buildMockExistingTripImportResult(request: ProviderProxyExistingTripImportRequest): ExistingTripImportProviderResult {
  const text = request.sources.map((source) => source.text).join('\n')
  const firstSource = request.sources[0]
  const date = findDate(text) ?? request.trip.startDate
  const time = findTime(text) ?? '10:00'
  const existingItem = request.items.find((item) => item.date === date)
  const title = findTitle(text) ?? '导入行程点'
  const sourceIds = firstSource ? [firstSource.id] : []
  const items: ExistingTripImportProviderCandidateItem[] = [{
    candidateId: 'mock-item-1',
    confidence: existingItem && similarity(title, existingItem.title) > 0.5 ? 'high' : 'medium',
    date,
    locationName: title,
    note: '由导入文本识别，应用前请核对。',
    reason: 'Mock 根据文本中的日期、时间和地点生成候选。',
    sourceIds,
    startTime: time,
    targetItemId: existingItem && similarity(title, existingItem.title) > 0.5 ? existingItem.id : undefined,
    title,
  }]
  const tickets: ExistingTripImportProviderCandidateTicket[] = /票|ticket|booking|order|订单|门票|凭证|二维码/i.test(text)
    ? [{
      candidateId: 'mock-ticket-1',
      confidence: 'medium',
      date,
      fileName: firstSource?.fileName,
      itemTitle: title,
      reason: 'Mock 识别到票据或订单关键词。',
      sourceFileId: firstSource?.id,
      sourceIds,
      targetItemId: items[0].targetItemId,
      title: `${title} 票据`,
    }]
    : []
  const notes: ExistingTripImportProviderCandidateNote[] = /备注|note|提醒|注意/i.test(text)
    ? [{
      candidateId: 'mock-note-1',
      confidence: 'medium',
      date,
      reason: 'Mock 识别到备注类文本。',
      sourceIds,
      text: '导入内容包含补充备注，请在预览中确认是否追加。',
    }]
    : []
  return {
    days: request.days.some((day) => day.date === date) ? [] : [{
      candidateId: 'mock-day-1',
      confidence: 'medium',
      date,
      reason: '导入内容包含当前旅行外的日期。',
      sourceIds,
      title: `导入 ${date}`,
    }],
    items,
    notes,
    tickets,
  }
}

function compactRequest(request: ProviderProxyExistingTripImportRequest) {
  return {
    days: request.days,
    items: request.items,
    locale: request.locale,
    sources: request.sources.map((source) => ({
      fileName: source.fileName,
      id: source.id,
      kind: source.kind,
      label: source.label,
      mimeType: source.mimeType,
      size: source.size,
      text: source.text,
      warnings: source.warnings,
    })),
    trip: request.trip,
  }
}

function normalizeDays(input: unknown, validSourceIds: Set<string>): ExistingTripImportProviderResult['days'] {
  if (!Array.isArray(input)) return undefined
  return input.flatMap((rawDay, index) => {
    const record = readRecord(rawDay)
    const date = readDate(record.date)
    if (!date) return []
    return [{
      candidateId: readText(record.candidateId, 80) || `day-${index + 1}`,
      confidence: readConfidence(record.confidence),
      date,
      reason: readText(record.reason, 300),
      sourceIds: readSourceIds(record.sourceIds, validSourceIds),
      targetDayId: readText(record.targetDayId, 128),
      title: readText(record.title, 120),
    }]
  }).slice(0, 80)
}

function normalizeItems(
  input: unknown,
  validSourceIds: Set<string>,
  itemIds: Set<string>,
): ExistingTripImportProviderResult['items'] {
  if (!Array.isArray(input)) return undefined
  return input.flatMap((rawItem, index) => {
    const record = readRecord(rawItem)
    const date = readDate(record.date)
    const title = readText(record.title, 160)
    if (!date || !title) return []
    const targetItemId = readText(record.targetItemId, 128)
    return [{
      address: readText(record.address, 240),
      candidateId: readText(record.candidateId, 80) || `item-${index + 1}`,
      confidence: readConfidence(record.confidence),
      date,
      endTime: readTime(record.endTime),
      locationName: readText(record.locationName, 180),
      note: readText(record.note, 700),
      previousTransportDurationMinutes: readDuration(record.previousTransportDurationMinutes),
      previousTransportMode: readText(record.previousTransportMode, 40) as ExistingTripImportProviderCandidateItem['previousTransportMode'],
      previousTransportNote: readText(record.previousTransportNote, 180),
      reason: readText(record.reason, 300),
      sourceIds: readSourceIds(record.sourceIds, validSourceIds),
      startTime: readTime(record.startTime),
      targetItemId: targetItemId && itemIds.has(targetItemId) ? targetItemId : undefined,
      title,
      transportMode: readText(record.transportMode, 40) as ExistingTripImportProviderCandidateItem['transportMode'],
    }]
  }).slice(0, 200)
}

function normalizeTickets(
  input: unknown,
  validSourceIds: Set<string>,
  itemIds: Set<string>,
): ExistingTripImportProviderResult['tickets'] {
  if (!Array.isArray(input)) return undefined
  return input.flatMap((rawTicket, index) => {
    const record = readRecord(rawTicket)
    const title = readText(record.title, 160)
    if (!title) return []
    const targetItemId = readText(record.targetItemId, 128)
    return [{
      candidateId: readText(record.candidateId, 80) || `ticket-${index + 1}`,
      confidence: readConfidence(record.confidence),
      date: readDate(record.date),
      fileName: readText(record.fileName, 180),
      itemTitle: readText(record.itemTitle, 160),
      note: readText(record.note, 700),
      reason: readText(record.reason, 300),
      sourceFileId: readText(record.sourceFileId, 128),
      sourceIds: readSourceIds(record.sourceIds, validSourceIds),
      targetItemId: targetItemId && itemIds.has(targetItemId) ? targetItemId : undefined,
      title,
    }]
  }).slice(0, 100)
}

function normalizeNotes(input: unknown, validSourceIds: Set<string>): ExistingTripImportProviderResult['notes'] {
  if (!Array.isArray(input)) return undefined
  return input.flatMap((rawNote, index) => {
    const record = readRecord(rawNote)
    const text = readText(record.text, 1200)
    if (!text) return []
    return [{
      candidateId: readText(record.candidateId, 80) || `note-${index + 1}`,
      confidence: readConfidence(record.confidence),
      date: readDate(record.date),
      reason: readText(record.reason, 300),
      sourceIds: readSourceIds(record.sourceIds, validSourceIds),
      text,
    }]
  }).slice(0, 100)
}

function requestOpenAiCompatibleExistingTripImport({
  apiKey,
  endpoint,
  fetchImpl,
  maxTokens,
  messages,
  model,
  reasoningMode,
}: {
  apiKey: string
  endpoint: string
  fetchImpl: typeof fetch
  maxTokens: number
  messages: OpenAiCompatibleMessage[]
  model: string
  reasoningMode?: AiBackendReasoningMode
}): Promise<{ ok: true; rawText: string } | { errorCode: ExistingTripImportProviderErrorCode; ok: false }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  return fetchImpl(endpoint, {
    body: JSON.stringify({
      max_tokens: maxTokens,
      messages,
      model,
      response_format: OPENAI_COMPATIBLE_JSON_RESPONSE_FORMAT,
      stream: false,
      thinking: reasoningMode === 'auto' || reasoningMode === 'high'
        ? OPENAI_COMPATIBLE_THINKING_ENABLED
        : OPENAI_COMPATIBLE_THINKING_DISABLED,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: controller.signal,
  }).then(async (response) => {
    clearTimeout(timeout)
    if (!response.ok) {
      return { errorCode: 'provider_error', ok: false }
    }
    const body = await response.json().catch(() => null)
    const rawText = readOpenAiCompatibleText(body)
    if (!rawText) {
      return { errorCode: 'invalid_response', ok: false }
    }
    return { ok: true, rawText }
  }).catch((caught) => {
    clearTimeout(timeout)
    const name = caught && typeof caught === 'object' && 'name' in caught ? String((caught as { name?: unknown }).name) : ''
    return { errorCode: name === 'AbortError' ? 'network_error' : 'provider_error', ok: false }
  })
}

function readOpenAiCompatibleText(input: unknown) {
  const record = readRecord(input)
  const choices = Array.isArray(record.choices) ? record.choices : []
  const first = readRecord(choices[0])
  const message = readRecord(first.message)
  return typeof message.content === 'string' ? message.content : ''
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function readText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) || undefined : undefined
}

function readDate(value: unknown) {
  const text = readText(value, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text ?? '') ? text : undefined
}

function readTime(value: unknown) {
  const text = readText(value, 5)
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text ?? '') ? text : undefined
}

function readDuration(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(number) && number >= 0 && number <= 24 * 60 ? number : undefined
}

function readConfidence(value: unknown): ExistingTripImportConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function readSourceIds(input: unknown, validSourceIds: Set<string>) {
  if (!Array.isArray(input)) return []
  return Array.from(new Set(input.filter((value): value is string => typeof value === 'string' && validSourceIds.has(value)))).slice(0, 6)
}

function readWarnings(input: unknown) {
  return Array.isArray(input) ? input.filter((warning): warning is string => typeof warning === 'string' && warning.trim().length > 0).slice(0, 8) : undefined
}

function findDate(text: string) {
  const match = text.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (!match) return null
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function findTime(text: string) {
  const match = text.match(/\b([01]?\d|2[0-3])[:：]([0-5]\d)\b/)
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null
}

function findTitle(text: string) {
  const locationMatch = text.match(/(?:地点|景点|目的地|酒店|场馆|Place|Location)[:：]\s*([^\n\r，,]{2,40})/i)
  if (locationMatch) return locationMatch[1].trim()
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  return lines.find((line) => line.length >= 2 && line.length <= 30)?.replace(/^[-*]\s*/, '')
}

function similarity(first: string, second: string) {
  const a = first.toLowerCase().replace(/\s+/g, '')
  const b = second.toLowerCase().replace(/\s+/g, '')
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.8
  const aChars = new Set([...a])
  const bChars = new Set([...b])
  const overlap = [...aChars].filter((char) => bChars.has(char)).length
  return overlap / Math.max(aChars.size, bChars.size)
}
