import type { AiTripEditContext } from '../../src/lib/aiTripEditContext'
import type { ProviderProxyAiTripEditPlanRequest } from '../../src/lib/providerProxyContract'
import type { AiBackendReasoningMode } from './aiReasoningPolicy'

export type AiTripEditProviderInput = {
  prompt: string
  maxOutputTokens: number
  reasoningMode?: AiBackendReasoningMode
}

const CHINESE_REALTIME_KEYWORDS = [
  '今天开放',
  '今天开门吗',
  '营业时间',
  '开放时间',
  '查询开放时间',
  '闭馆',
  '票价',
  '门票价格',
  '最新',
  '近期',
  '近期活动',
  '停运',
  '交通中断',
  '实时',
  '查一下',
  '搜索',
  '查询',
  '官网',
  '官方网站',
  '附近吃饭',
  '附近餐厅',
]

const ENGLISH_REALTIME_PATTERNS = [
  /\bopen\s+today\b/,
  /\bhours\s+today\b/,
  /\bopening\s+hours\b/,
  /\bcurrently\s+open\b/,
  /\bclosed\s+today\b/,
  /\bopen\s+now\b/,
  /\bcheck\s+whether\b.{0,80}\bopen\b/,
  /\bcheck\s+if\b.{0,80}\bopen\b/,
  /\bticket\s+prices?\b/,
  /\btickets?\s+today\b/,
  /\blatest\b/,
  /\brecent\b/,
  /\blook\s+up\b/,
  /\bsearch\b/,
  /\bofficial\s+(?:site|website)\b/,
  /\bnearby\s+(?:food|restaurants?)\b/,
  /\bweather\b/,
  /\btransport\s+disruptions?\b/,
  /\bclosures?\b/,
  /\bevents?\b/,
  /\breviews?\b/,
  /\breal[-\s]?time\b/,
  /\bcurrent\s+(?:opening\s+hours|status|ticket\s+price|tickets?|closures?|events?|reviews?|weather)\b/,
]

export function buildAiTripEditProviderInput(
  request: ProviderProxyAiTripEditPlanRequest,
  requestId?: string,
): AiTripEditProviderInput {
  const hasSearchSources = Boolean(request.searchResults?.results.length)
  const realtimeWarning = commandNeedsRealtimeSearch(request.command) && !hasSearchSources
    ? '\n用户请求可能需要实时网页信息；联网搜索暂未接入，必须在 warnings 中写入“联网搜索暂未接入，未查询实时信息。”，不要编造事实。'
    : ''
  const searchBoundary = hasSearchSources
    ? '不要自行联网搜索；只能使用下方已提供的 travel_search 来源作为实时/网页信息依据。涉及开放时间、票价、官网、交通、附近餐厅、最新信息时必须基于这些来源，并在 reason 或 warnings 中简短说明来源依据。不要编造来源之外的实时事实。'
    : '不要联网搜索，不要声称查询了实时网页信息，不要编造开放时间、票价、闭馆、交通中断、近期评价或活动。'
  const searchSources = hasSearchSources
    ? `travel_search 来源摘要：${JSON.stringify(compactSearchResults(request.searchResults!))}`
    : ''

  return {
    maxOutputTokens: 1800,
    prompt: [
      '你是 TripMap 的行程修改规划器，只输出 JSON。',
      '根据用户的一次性修改指令和已脱敏的本地旅行上下文，生成安全的 patch plan。',
      '不要输出 Markdown、解释文字或代码块。',
      '不要直接修改旅行；你只能返回 patch plan，用户会在本地预览并确认后才应用。',
      searchBoundary,
      'summary、operation reason 和 warnings 必须使用中文；不要不必要地翻译 Tower of London、British Museum 等专有名词。',
      realtimeWarning,
      '只允许以下 operation type：update_item_title、update_item_time、update_item_location_text、update_item_note、update_item_transport、add_item、remove_item、move_item、reorder_day_items、update_day_title。',
      '不允许 update_trip、delete_day、delete_trip、bulk_replace_day、rewrite_all 或其他未知操作。',
      '所有 operation 必须有简短中文 reason。',
      'item 相关操作必须使用 context 中存在的 itemId；add_item/move_item 必须使用 context 中存在的 targetDayId；reorder_day_items 必须完整列出该日期全部 itemId 且不重复。',
      '不要输出 affectedIds、affectedCounts、source、metadata 或任意自定义字段；这些由本地验证器计算。',
      '不要包含 ticket、route、cloud、provider、coordinate、url、notes、headers、token、fileName、blob 等字段。',
      'remove_item 不要针对 ticketBoundState=item_bound、ticketCount>0 或 hasTicketBindings=true 的项目；如果用户要求删除这类项目，请在 warnings 中说明需要先手动处理票据。',
      '如果无法安全修改，返回 {"summary":"未生成可写入修改","operations":[],"warnings":["说明原因"]}。',
      '输出 schema：{"summary":"...","operations":[...],"warnings":["..."]}。',
      'operation 示例：',
      '{"type":"update_item_title","itemId":"item_x","title":"新标题","reason":"..."}',
      '{"type":"update_item_time","itemId":"item_x","startTime":"10:00","endTime":"11:00","reason":"..."}',
      '{"type":"update_item_location_text","itemId":"item_x","locationName":"地点","address":"地址","reason":"..."}',
      '{"type":"update_item_note","itemId":"item_x","note":"缺少地址，请补充。","reason":"..."}',
      '{"type":"update_item_transport","itemId":"item_x","previousTransportMode":"walk","previousTransportDurationMinutes":15,"reason":"..."}',
      '{"type":"move_item","itemId":"item_x","targetDayId":"day_y","targetSortOrder":2,"targetStartTime":"14:00","reason":"..."}',
      '{"type":"remove_item","itemId":"item_x","reason":"..."}',
      '{"type":"add_item","targetDayId":"day_y","targetSortOrder":3,"item":{"title":"咖啡休息","startTime":"15:30","endTime":"16:00"},"reason":"..."}',
      '{"type":"reorder_day_items","dayId":"day_y","orderedItemIds":["item_1","item_2"],"reason":"..."}',
      '{"type":"update_day_title","dayId":"day_y","title":"轻松第二天","reason":"..."}',
      `requestId: ${requestId ?? request.requestId ?? 'unknown'}`,
      `用户指令：${request.command}`,
      searchSources,
      `已脱敏旅行上下文：${JSON.stringify(compactContext(request.context))}`,
    ].filter(Boolean).join('\n'),
  }
}

export function commandNeedsRealtimeSearch(command: string): boolean {
  const normalizedCommand = command.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
  return CHINESE_REALTIME_KEYWORDS.some((keyword) => command.includes(keyword))
    || ENGLISH_REALTIME_PATTERNS.some((pattern) => pattern.test(normalizedCommand))
}

function compactContext(context: AiTripEditContext): AiTripEditContext {
  return context
}

function compactSearchResults(searchResults: NonNullable<ProviderProxyAiTripEditPlanRequest['searchResults']>) {
  return {
    query: searchResults.query,
    results: searchResults.results.slice(0, 3).map((result) => ({
      confidence: result.confidence,
      displayUrl: result.displayUrl,
      domain: result.domain,
      retrievedAt: result.retrievedAt,
      snippet: result.snippet,
      sourceType: result.sourceType,
      title: result.title,
    })),
    retrievedAt: searchResults.retrievedAt,
    source: searchResults.source,
  }
}
