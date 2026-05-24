export type AiSearchFutureOperation =
  | 'travel_search'
  | 'place_research'
  | 'opening_hours_lookup'

export type AiSearchPolicyInput = {
  text?: string
  operation?: 'ai_trip_draft' | 'ai_trip_draft_repair'
}

export type AiSearchDecision = {
  needed: false
  reason?: string
  futureOperation?: AiSearchFutureOperation
}

export function decideAiSearchNeed(input: AiSearchPolicyInput): AiSearchDecision {
  const text = input.text?.trim().toLowerCase() ?? ''
  if (!text) return { needed: false }

  if (containsAny(text, ['营业时间', '开门', '闭馆', '关门', 'opening hour', 'hours', 'closed', 'closure'])) {
    return {
      futureOperation: 'opening_hours_lookup',
      needed: false,
      reason: 'future_opening_hours_or_closure_lookup',
    }
  }

  if (containsAny(text, ['门票', '票价', '预约', '订票', 'ticket', 'reservation', 'booking'])) {
    return {
      futureOperation: 'travel_search',
      needed: false,
      reason: 'future_ticket_or_reservation_lookup',
    }
  }

  if (containsAny(text, ['停运', '延误', '中断', '罢工', 'disruption', 'delay', 'suspended', 'strike'])) {
    return {
      futureOperation: 'travel_search',
      needed: false,
      reason: 'future_transport_disruption_lookup',
    }
  }

  if (containsAny(text, ['最近评价', '近期活动', 'recent review', 'recent event'])) {
    return {
      futureOperation: 'place_research',
      needed: false,
      reason: 'future_recent_review_or_event_lookup',
    }
  }

  return { needed: false }
}

function containsAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern))
}
