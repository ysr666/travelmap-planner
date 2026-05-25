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
  '营业时间',
  '开放时间',
  '闭馆',
  '票价',
  '门票',
  '最新',
  '近期',
  '近期活动',
  '停运',
  '交通中断',
  '实时',
  '查一下',
  '搜索',
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
  const realtimeWarning = commandNeedsRealtimeSearch(request.command)
    ? '\n用户请求可能需要实时网页信息；联网搜索暂未接入，必须在 warnings 中写入“联网搜索暂未接入，未查询实时信息。”，不要编造事实。'
    : ''

  return {
    maxOutputTokens: 1800,
    prompt: [
      '你是 TripMap 的行程修改规划器，只输出 JSON。',
      '根据用户的一次性修改指令和已脱敏的本地旅行上下文，生成安全的 patch plan。',
      '不要输出 Markdown、解释文字或代码块。',
      '不要直接修改旅行；你只能返回 patch plan，用户会在本地预览并确认后才应用。',
      '不要联网搜索，不要声称查询了实时网页信息，不要编造开放时间、票价、闭馆、交通中断、近期评价或活动。',
      'summary、operation reason 和 warnings 必须使用中文；不要不必要地翻译 Tower of London、British Museum 等专有名词。',
      realtimeWarning,
      '只允许以下 operation type：update_item、move_item、delete_item、add_item。',
      '不允许 update_trip、delete_day、delete_trip、bulk_replace_day、rewrite_all 或其他未知操作。',
      'update/move/delete 必须使用 context 中存在的 itemId；add_item/move_item 必须使用 context 中存在的 targetDayId。',
      '不要包含 ticket、route、cloud、provider、coordinate、url、notes、headers、token 等字段。',
      'delete_item 不要针对 hasTicketBindings=true 的项目；如果用户要求删除这类项目，请在 warnings 中说明需要先手动处理票据。',
      '输出 schema：{"summary":"...","operations":[...],"warnings":["..."]}。',
      'operation 示例：',
      '{"type":"update_item","itemId":"item_x","changes":{"title":"新标题","startTime":"10:00","endTime":"11:00","locationName":"地点"},"reason":"..."}',
      '{"type":"move_item","itemId":"item_x","targetDayId":"day_y","targetSortOrder":2,"targetStartTime":"14:00","reason":"..."}',
      '{"type":"delete_item","itemId":"item_x","reason":"..."}',
      '{"type":"add_item","targetDayId":"day_y","targetSortOrder":3,"item":{"title":"咖啡休息","startTime":"15:30","endTime":"16:00"},"reason":"..."}',
      `requestId: ${requestId ?? request.requestId ?? 'unknown'}`,
      `用户指令：${request.command}`,
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
