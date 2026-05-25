import type { AiTripEditContext } from '../../src/lib/aiTripEditContext'
import type { ProviderProxyAiTripEditPlanRequest } from '../../src/lib/providerProxyContract'
import type { AiBackendReasoningMode } from './aiReasoningPolicy'

export type AiTripEditProviderInput = {
  prompt: string
  maxOutputTokens: number
  reasoningMode?: AiBackendReasoningMode
}

const REALTIME_KEYWORDS = [
  '今天开放',
  '营业时间',
  '开放时间',
  '闭馆',
  '票价',
  '门票',
  '最新',
  '近期活动',
  '交通中断',
  '实时',
  '查一下',
  '搜索',
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
  return REALTIME_KEYWORDS.some((keyword) => command.includes(keyword))
}

function compactContext(context: AiTripEditContext): AiTripEditContext {
  return context
}
