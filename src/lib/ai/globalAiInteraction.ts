import {
  listLedgerExpenses,
  listTicketsByTrip,
  listTrips,
} from '../../db'
import { db } from '../../db/database'
import { resolveTripTimeZone } from '../timeZone'
import { todayInTimeZone } from '../timeSemantics'
import type {
  ProviderProxyAssistantAnswerRequest,
  ProviderProxyAssistantAnswerSourceCard,
  ProviderProxyAssistantAnswerSuccessResponse,
} from './providerProxyContract'
import {
  loadGlobalAiCommandContext,
  parseGlobalAiCommandIntent,
  resolveGlobalAiCommand,
  type GlobalAiCommandContext,
  type GlobalAiCommandResult,
} from './globalAiCommandRouter'
import { getGlobalAiCapabilityAnswer } from './capabilityRegistry'
import type { LedgerExpense, RouteId, Trip } from '../../types'

export type GlobalAiInteractionMode =
  | 'action_proposal'
  | 'assistant_answer'
  | 'help'
  | 'local_query'
  | 'navigation'

export type GlobalAiInteractionContext = GlobalAiCommandContext & {
  accountSummary: GlobalAiAccountSummary
  scopeLabel: string
  sourceCards: ProviderProxyAssistantAnswerSourceCard[]
}

export type GlobalAiAccountSummary = {
  draftExpenseCount: number
  inboxNeedsAssignmentCount: number
  recentTripCount: number
  ticketCount: number
  totalTripCount: number
  upcomingTrips: Array<{ date?: string; title: string }>
}

export type GlobalAiHelpResult = {
  answer: string
  caveats: string[]
  kind: 'help'
  mode: Extract<GlobalAiInteractionMode, 'help'>
  sourceCards: ProviderProxyAssistantAnswerSourceCard[]
  title: string
}

export type GlobalAiAssistantAnswerResult = {
  answer: string
  caveats: string[]
  fallbackAnswer: string
  kind: 'assistant_answer'
  mode: Extract<GlobalAiInteractionMode, 'assistant_answer'>
  providerRequest: ProviderProxyAssistantAnswerRequest
  source: 'fallback' | ProviderProxyAssistantAnswerSuccessResponse['source']
  sourceCards: ProviderProxyAssistantAnswerSourceCard[]
  title: string
}

export type GlobalAiInteractionResult =
  | GlobalAiAssistantAnswerResult
  | GlobalAiCommandResult
  | GlobalAiHelpResult

export async function loadGlobalAiInteractionContext(
  activeRoute: RouteId,
  hash = window.location.hash,
): Promise<GlobalAiInteractionContext> {
  const commandContext = await loadGlobalAiCommandContext(activeRoute, hash)
  const accountSummary = await buildGlobalAiAccountSummary(commandContext.trip?.id)
  const scopeLabel = buildScopeLabel(commandContext)
  const sourceCards = buildContextSourceCards(commandContext, accountSummary)
  return {
    ...commandContext,
    accountSummary,
    scopeLabel,
    sourceCards,
  }
}

export async function resolveGlobalAiInteraction(
  command: string,
  context: GlobalAiInteractionContext,
): Promise<GlobalAiInteractionResult> {
  const capability = getGlobalAiCapabilityAnswer(command)
  if (capability) {
    return {
      ...capability,
      kind: 'help',
      mode: 'help',
    }
  }

  const intent = parseGlobalAiCommandIntent(command)
  if (intent.kind === 'consultation') {
    const providerRequest = buildAssistantAnswerProviderRequest(command, context)
    const fallbackAnswer = buildLocalAssistantFallback(command, context)
    return {
      answer: fallbackAnswer,
      caveats: ['这是本地降级回答；需要实时信息时必须先确认来源。'],
      fallbackAnswer,
      kind: 'assistant_answer',
      mode: 'assistant_answer',
      providerRequest,
      source: 'fallback',
      sourceCards: context.sourceCards,
      title: context.trip ? '旅行助手回答' : '全局助手回答',
    }
  }

  return resolveGlobalAiCommand(command, context)
}

export function mergeAssistantAnswerProviderResponse(
  draft: GlobalAiAssistantAnswerResult,
  response: ProviderProxyAssistantAnswerSuccessResponse,
): GlobalAiAssistantAnswerResult {
  return {
    ...draft,
    answer: response.answer,
    caveats: response.caveats,
    source: response.source,
    sourceCards: response.sourceCards.length > 0 ? response.sourceCards : draft.sourceCards,
  }
}

export function buildAssistantAnswerFallbackAfterError(
  draft: GlobalAiAssistantAnswerResult,
): GlobalAiAssistantAnswerResult {
  return {
    ...draft,
    answer: draft.fallbackAnswer,
    caveats: ['AI 助手问答暂不可用，已改用本地脱敏摘要回答。', ...draft.caveats].slice(0, 4),
    source: 'fallback',
  }
}

function buildAssistantAnswerProviderRequest(
  command: string,
  context: GlobalAiInteractionContext,
): ProviderProxyAssistantAnswerRequest {
  return {
    context: {
      scopeLabel: context.scopeLabel,
      sourceCards: context.sourceCards,
      summaries: buildAssistantContextSummaries(context),
    },
    locale: 'zh-CN',
    operation: 'assistant_answer',
    question: command.trim(),
  }
}

async function buildGlobalAiAccountSummary(currentTripId?: string): Promise<GlobalAiAccountSummary> {
  const trips = await listTrips()
  const upcomingTrips = trips
    .filter((trip) => {
      const today = todayInTimeZone(resolveTripTimeZone(trip))
      return trip.endDate >= today
    })
    .sort((first, second) => first.startDate.localeCompare(second.startDate))
    .slice(0, 3)
    .map((trip) => ({ date: trip.startDate, title: trip.title }))
  const summaryTrips = prioritizeSummaryTrips(trips, currentTripId).slice(0, 5)
  const [ticketLists, expenseLists, inboxSources] = await Promise.all([
    Promise.all(summaryTrips.map((trip) => listTicketsByTrip(trip.id))),
    Promise.all(summaryTrips.map((trip) => listLedgerExpenses(trip.id))),
    db.travelInboxAccountSources.toArray(),
  ])
  return {
    draftExpenseCount: expenseLists.flat().filter((expense) => expense.status === 'draft' || expense.reviewStatus === 'needs_review').length,
    inboxNeedsAssignmentCount: inboxSources.filter((source) => source.status === 'needs_assignment' || !source.targetTripId).length,
    recentTripCount: summaryTrips.length,
    ticketCount: ticketLists.flat().length,
    totalTripCount: trips.length,
    upcomingTrips,
  }
}

function prioritizeSummaryTrips(trips: Trip[], currentTripId?: string) {
  const current = currentTripId ? trips.find((trip) => trip.id === currentTripId) : undefined
  return [
    ...(current ? [current] : []),
    ...trips.filter((trip) => trip.id !== currentTripId),
  ]
}

function buildScopeLabel(context: GlobalAiCommandContext) {
  if (context.currentItem) return `当前行程点 / ${context.currentItem.title}`
  if (context.currentDay) return `当前日期 / ${context.currentDay.title ?? context.currentDay.date}`
  if (context.trip) return `当前旅行 / ${context.trip.title}`
  return '全部旅行'
}

function buildAssistantContextSummaries(context: GlobalAiInteractionContext) {
  const summaries = [
    { key: 'scope', label: '上下文', value: context.scopeLabel },
    { key: 'trip_count', label: '旅行数量', value: `${context.accountSummary.totalTripCount} 个旅行` },
    { key: 'upcoming', label: '近期旅行', value: formatUpcomingTrips(context.accountSummary.upcomingTrips) },
    { key: 'inbox', label: '材料输入', value: `${context.accountSummary.inboxNeedsAssignmentCount} 条待分配材料` },
    { key: 'finance', label: '费用', value: `${context.accountSummary.draftExpenseCount} 笔待确认费用草稿` },
    { key: 'tickets', label: '票据', value: `${context.accountSummary.ticketCount} 张近期/当前旅行票据` },
  ]
  if (context.trip) {
    summaries.push(
      { key: 'current_trip', label: '当前旅行', value: `${context.trip.title}，${context.days.length} 天，${context.items.length} 个行程点` },
      { key: 'current_trip_finance', label: '当前账本', value: formatCurrentTripFinance(context.ledgerExpenses) },
      { key: 'current_trip_tickets', label: '当前票据', value: `${context.tickets.length} 张票据` },
    )
  }
  if (context.currentDay) {
    const dayItems = context.items.filter((item) => item.dayId === context.currentDay?.id)
    summaries.push({ key: 'current_day', label: '当前日期', value: `${context.currentDay.title ?? context.currentDay.date}，${dayItems.length} 个行程点` })
  }
  return summaries.filter((summary) => summary.value.trim().length > 0).slice(0, 12)
}

function buildContextSourceCards(
  context: GlobalAiCommandContext,
  accountSummary: GlobalAiAccountSummary,
): ProviderProxyAssistantAnswerSourceCard[] {
  const cards: ProviderProxyAssistantAnswerSourceCard[] = [{
    detail: `${accountSummary.totalTripCount} 个旅行，${accountSummary.inboxNeedsAssignmentCount} 条待分配材料。`,
    id: 'account-summary',
    kind: 'local_context',
    title: '账户级脱敏摘要',
  }]
  if (context.trip) {
    cards.push({
      detail: `${context.days.length} 天，${context.items.length} 个行程点，${context.tickets.length} 张票据。`,
      id: `trip-summary:${context.trip.id}`,
      kind: 'local_context',
      title: '当前旅行摘要',
    })
  }
  cards.push({
    detail: '普通问答不会读取资料库明文、票据 blob 或原始 provider payload。',
    id: 'privacy-boundary',
    kind: 'provider_caveat',
    title: '隐私边界',
  })
  return cards.slice(0, 8)
}

function buildLocalAssistantFallback(command: string, context: GlobalAiInteractionContext) {
  const summaries = buildAssistantContextSummaries(context)
  if (context.trip) {
    const current = context.currentItem
      ? `当前正在看「${context.currentItem.title}」。`
      : context.currentDay
        ? `当前正在看「${context.currentDay.title ?? context.currentDay.date}」。`
        : `当前正在看「${context.trip.title}」。`
    return `${current} 我能基于本地脱敏摘要回答：${summaries.slice(1, 5).map((summary) => `${summary.label} ${summary.value}`).join('；')}。如果你要我实际修改，请使用明确的修改指令并确认预览。`
  }
  if (command.includes('新建') || command.includes('生成')) {
    return '可以输入“新建行程”打开 AI 行程草稿；生成后仍需要预览并确认导入。'
  }
  return `我现在在「${context.scopeLabel}」上下文，只会使用账户级脱敏摘要：${summaries.slice(1, 5).map((summary) => `${summary.label} ${summary.value}`).join('；')}。`
}

function formatUpcomingTrips(trips: GlobalAiAccountSummary['upcomingTrips']) {
  if (trips.length === 0) return '暂无即将开始或进行中的旅行'
  return trips.map((trip) => [trip.date, trip.title].filter(Boolean).join(' ')).join('；')
}

function formatCurrentTripFinance(expenses: LedgerExpense[]) {
  const draftCount = expenses.filter((expense) => expense.status === 'draft' || expense.reviewStatus === 'needs_review').length
  return `${expenses.length} 笔记录，其中 ${draftCount} 笔待确认`
}
