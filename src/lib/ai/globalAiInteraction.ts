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
import type { TripIntelligenceSuggestion } from '../tripIntelligence'

export type GlobalAiInteractionMode =
  | 'action_proposal'
  | 'assistant_answer'
  | 'help'
  | 'local_query'
  | 'navigation'

export type GlobalAiInteractionContextMode = 'account' | 'current_page'

export type GlobalAiInteractionContext = GlobalAiCommandContext & {
  accountSummary: GlobalAiAccountSummary
  pageContextTools: GlobalAiPageContextTool[]
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

export type GlobalAiSourceCard = ProviderProxyAssistantAnswerSourceCard

export type GlobalAiFailureRecord = {
  errorCode: string
  failureStage: 'context' | 'provider' | 'render' | 'schema_validation' | 'write'
  mode: GlobalAiInteractionMode
  occurredAt: number
  operation: string
  schemaVersion: string
}

export type GlobalAiPageContextKind =
  | 'account'
  | 'day'
  | 'document'
  | 'inbox'
  | 'item'
  | 'ledger'
  | 'shared_trip'
  | 'ticket'
  | 'trip'

export type GlobalAiPageContextTool = {
  kind: GlobalAiPageContextKind
  label: string
  sourceCard: ProviderProxyAssistantAnswerSourceCard
  summary: string
}

export type GlobalAiActionProposalKind =
  | 'ai_trip_edit_patch_preview'
  | 'ledger_open_review'
  | 'navigation_existing_flow'
  | 'preference_preview'
  | 'replan_preview'

export type GlobalAiActionProposal = {
  actionLabel: string
  id: string
  kind: GlobalAiActionProposalKind
  message: string
  requiresConfirmation: boolean
  sourceCards: ProviderProxyAssistantAnswerSourceCard[]
  suggestion: TripIntelligenceSuggestion
  title: string
}

export type GlobalAiCommandInteractionResult = GlobalAiCommandResult & {
  actionProposal?: GlobalAiActionProposal
}

export type GlobalAiInteractionResult =
  | GlobalAiAssistantAnswerResult
  | GlobalAiCommandInteractionResult
  | GlobalAiHelpResult

export async function loadGlobalAiInteractionContext(
  activeRoute: RouteId,
  hash = window.location.hash,
): Promise<GlobalAiInteractionContext> {
  const commandContext = await loadGlobalAiCommandContext(activeRoute, hash)
  const accountSummary = await buildGlobalAiAccountSummary(commandContext.trip?.id)
  const scopeLabel = buildScopeLabel(commandContext)
  const pageContextTools = buildPageContextTools(commandContext, accountSummary)
  const sourceCards = buildContextSourceCards(commandContext, accountSummary, pageContextTools)
  return {
    ...commandContext,
    accountSummary,
    pageContextTools,
    scopeLabel,
    sourceCards,
  }
}

export async function resolveGlobalAiInteraction(
  command: string,
  context: GlobalAiInteractionContext,
  options: { forceMode?: Extract<GlobalAiInteractionMode, 'assistant_answer'> } = {},
): Promise<GlobalAiInteractionResult> {
  const capability = getGlobalAiCapabilityAnswer(command)
  if (capability && options.forceMode !== 'assistant_answer') {
    return {
      ...capability,
      kind: 'help',
      mode: 'help',
    }
  }

  const intent = parseGlobalAiCommandIntent(command)
  if (intent.kind === 'consultation' || options.forceMode === 'assistant_answer') {
    const providerRequest = buildAssistantAnswerProviderRequest(command, context)
    const fallbackAnswer = buildLocalAssistantFallback(command, context)
    return {
      answer: fallbackAnswer,
      caveats: ['需要实时信息时，我会先让你确认来源。'],
      fallbackAnswer,
      kind: 'assistant_answer',
      mode: 'assistant_answer',
      providerRequest,
      source: 'fallback',
      sourceCards: context.sourceCards,
      title: '旅图助手',
    }
  }

  const commandResult = await resolveGlobalAiCommand(command, context)
  return attachActionProposal(command, context, commandResult)
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
    caveats: [...draft.caveats, '我先根据当前资料回答。'].slice(0, 2),
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
  const selectedTicket = context.params.get('ticketId')
    ? context.tickets.find((ticket) => ticket.id === context.params.get('ticketId'))
    : undefined
  if (context.activeRoute === 'inbox') return '旅行材料输入'
  if (context.activeRoute === 'ledger') return context.trip ? `账本 / ${context.trip.title}` : '账本'
  if (context.activeRoute === 'documents') return context.trip ? `资料 / ${context.trip.title}` : '资料'
  if (context.activeRoute === 'shared-trip') return '同行'
  if ((context.activeRoute === 'tickets' || selectedTicket) && selectedTicket) return `当前票据 / ${selectedTicket.title}`
  if (context.activeRoute === 'tickets' && context.trip) return `票据 / ${context.trip.title}`
  if (context.currentItem) return `当前行程点 / ${context.currentItem.title}`
  if (context.currentDay) {
    const dayIndex = context.days.findIndex((day) => day.id === context.currentDay?.id)
    return `Day ${dayIndex >= 0 ? dayIndex + 1 : ''} / ${context.currentDay.title ?? context.currentDay.date}`.replace('Day  /', 'Day /')
  }
  if (context.trip) return `当前旅行 / ${context.trip.title}`
  return '全部旅行'
}

function buildAssistantContextSummaries(context: GlobalAiInteractionContext) {
  const summaries = [
    { key: 'scope', label: '上下文', value: context.scopeLabel },
    ...context.pageContextTools.map((tool) => ({
      key: `tool:${tool.kind}`,
      label: tool.label,
      value: tool.summary,
    })),
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
  pageContextTools: GlobalAiPageContextTool[],
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
  pageContextTools.forEach((tool) => {
    if (!cards.some((card) => card.id === tool.sourceCard.id)) cards.push(tool.sourceCard)
  })
  cards.push({
    detail: '普通问答不会读取资料库明文、票据 blob 或原始 provider payload。',
    id: 'privacy-boundary',
    kind: 'provider_caveat',
    title: '隐私边界',
  })
  return cards.slice(0, 8)
}

function buildPageContextTools(
  context: GlobalAiCommandContext,
  accountSummary: GlobalAiAccountSummary,
): GlobalAiPageContextTool[] {
  const tools: GlobalAiPageContextTool[] = [{
    kind: 'account',
    label: '账户摘要',
    sourceCard: {
      detail: `${accountSummary.totalTripCount} 个旅行，${accountSummary.draftExpenseCount} 笔待确认费用。`,
      id: 'context-tool:account',
      kind: 'local_context',
      title: '账户级上下文',
    },
    summary: `${accountSummary.totalTripCount} 个旅行，${accountSummary.inboxNeedsAssignmentCount} 条材料待分配，${accountSummary.draftExpenseCount} 笔费用待确认`,
  }]
  if (context.trip) {
    tools.push({
      kind: 'trip',
      label: '当前旅行',
      sourceCard: {
        detail: `${context.days.length} 天，${context.items.length} 个行程点，${context.tickets.length} 张票据。`,
        id: `context-tool:trip:${context.trip.id}`,
        kind: 'local_context',
        title: '当前旅行上下文',
      },
      summary: `${context.trip.title}，${context.days.length} 天，${context.items.length} 个行程点`,
    })
  }
  if (context.currentDay) {
    const dayItems = context.items.filter((item) => item.dayId === context.currentDay?.id)
    tools.push({
      kind: 'day',
      label: '当天安排',
      sourceCard: {
        detail: `${context.currentDay.title ?? context.currentDay.date}，${dayItems.length} 个行程点。`,
        id: `context-tool:day:${context.currentDay.id}`,
        kind: 'local_context',
        title: 'Day 上下文',
      },
      summary: `${context.currentDay.title ?? context.currentDay.date} 有 ${dayItems.length} 个行程点`,
    })
  }
  if (context.currentItem) {
    tools.push({
      kind: 'item',
      label: '当前行程点',
      sourceCard: {
        detail: `${context.currentItem.startTime ?? '时间未定'}，${context.currentItem.ticketIds.length} 张绑定票据。`,
        id: `context-tool:item:${context.currentItem.id}`,
        kind: 'local_context',
        title: '行程点上下文',
      },
      summary: `${context.currentItem.title}，${context.currentItem.startTime ?? '时间未定'}，${context.currentItem.ticketIds.length} 张票据`,
    })
  }
  const ticketId = context.params.get('ticketId')
  const selectedTicket = ticketId ? context.tickets.find((ticket) => ticket.id === ticketId) : undefined
  if (context.activeRoute === 'tickets' || selectedTicket) {
    tools.push({
      kind: 'ticket',
      label: '票据',
      sourceCard: {
        detail: selectedTicket ? '当前票据只使用 metadata，不读取附件 blob。' : `${context.tickets.length} 张当前旅行票据。`,
        id: `context-tool:ticket:${selectedTicket?.id ?? context.trip?.id ?? 'account'}`,
        kind: 'local_context',
        title: selectedTicket ? '当前票据上下文' : '票据库上下文',
      },
      summary: selectedTicket
        ? `${selectedTicket.title}，${selectedTicket.scope === 'item' ? '已关联行程点' : '未关联具体行程点'}`
        : `${context.tickets.length} 张票据`,
    })
  }
  if (context.activeRoute === 'ledger') {
    const draftCount = context.ledgerExpenses.filter((expense) => expense.status === 'draft' || expense.reviewStatus === 'needs_review').length
    tools.push({
      kind: 'ledger',
      label: '账本',
      sourceCard: {
        detail: `${context.ledgerExpenses.length} 笔记录，${draftCount} 笔待确认。`,
        id: `context-tool:ledger:${context.trip?.id ?? 'account'}`,
        kind: 'local_context',
        title: '账本上下文',
      },
      summary: `${context.ledgerExpenses.length} 笔账本记录，${draftCount} 笔待确认`,
    })
  }
  if (context.activeRoute === 'documents') {
    tools.push({
      kind: 'document',
      label: '资料',
      sourceCard: {
        detail: '资料上下文只包含类型、状态和数量，不读取或发送资料库明文。',
        id: `context-tool:document:${context.trip?.id ?? 'account'}`,
        kind: 'local_context',
        title: '资料上下文',
      },
      summary: '只使用资料类型、状态和数量，不包含证件号、附件名或备注',
    })
  }
  if (context.activeRoute === 'inbox') {
    tools.push({
      kind: 'inbox',
      label: '材料输入',
      sourceCard: {
        detail: `${accountSummary.inboxNeedsAssignmentCount} 条账号材料待分配。`,
        id: 'context-tool:inbox',
        kind: 'local_context',
        title: '旅行材料上下文',
      },
      summary: `${accountSummary.inboxNeedsAssignmentCount} 条材料待分配`,
    })
  }
  if (context.activeRoute === 'shared-trip') {
    tools.push({
      kind: 'shared_trip',
      label: '同行',
      sourceCard: {
        detail: '同行上下文只用于解释现有流程，不读取同伴备注或 mutation payload。',
        id: 'context-tool:shared-trip',
        kind: 'local_context',
        title: '同行上下文',
      },
      summary: '只使用协作状态摘要，不自动同步或撤销同行变更',
    })
  }
  return tools.slice(0, 6)
}

function attachActionProposal(
  command: string,
  context: GlobalAiInteractionContext,
  result: GlobalAiCommandResult,
): GlobalAiCommandInteractionResult {
  const actionProposal = buildActionProposal(command, context, result)
  return actionProposal ? { ...result, actionProposal } : result
}

function buildActionProposal(
  command: string,
  context: GlobalAiInteractionContext,
  result: GlobalAiCommandResult,
): GlobalAiActionProposal | undefined {
  const now = Date.now()
  if (result.kind === 'ai_trip_edit' && context.trip) {
    return {
      actionLabel: '生成修改预览',
      id: `global-ai:proposal:ai-trip-edit:${context.trip.id}:${hashString(command)}`,
      kind: 'ai_trip_edit_patch_preview',
      message: '只会生成可检查的修改预览；应用前还要再确认。',
      requiresConfirmation: true,
      sourceCards: context.sourceCards,
      suggestion: buildActionProposalSuggestion({
        actionKind: 'ai_trip_edit_patch_preview',
        affectedDayIds: context.days.map((day) => day.id),
        affectedItemIds: [],
        key: `global_ai:ai_trip_edit:${context.trip.id}:${hashString(command)}`,
        message: 'AI 会返回结构化 patch，确认前不会写入。',
        now,
        scope: 'trip',
        sourceId: 'ai_trip_edit',
        title: result.title,
      }),
      title: 'AI 修改建议',
    }
  }
  if (result.kind === 'preference_preview') {
    return {
      actionLabel: '确认保存偏好',
      id: `global-ai:proposal:preference:${result.item.id}:${hashString(command)}`,
      kind: 'preference_preview',
      message: '这是行程点重排偏好，确认后只影响后续重排判断。',
      requiresConfirmation: true,
      sourceCards: context.sourceCards,
      suggestion: buildActionProposalSuggestion({
        actionKind: 'preference_preview',
        affectedDayIds: [result.item.dayId],
        affectedItemIds: [result.item.id],
        key: `global_ai:preference:${result.item.id}:${hashString(command)}`,
        message: result.message,
        now,
        scope: 'item',
        sourceId: 'global_ai_preference',
        title: result.title,
      }),
      title: '重排偏好建议',
    }
  }
  if (result.kind === 'replan_preview' && context.trip) {
    return {
      actionLabel: '确认应用重排',
      id: `global-ai:proposal:replan:${context.trip.id}:${hashString(command)}`,
      kind: 'replan_preview',
      message: '将先创建可撤销的 Live Mode 重排记录；票据、账本和交通订单仍需人工处理。',
      requiresConfirmation: true,
      sourceCards: context.sourceCards,
      suggestion: buildActionProposalSuggestion({
        actionKind: 'replan_apply_option',
        affectedDayIds: result.eventDraft.dayId ? [result.eventDraft.dayId] : [],
        affectedItemIds: result.targetItem ? [result.targetItem.id] : [],
        key: `global_ai:replan:${context.trip.id}:${hashString(command)}`,
        message: '确认后才会写入重排结果，并保留撤销入口。',
        now,
        scope: 'live',
        sourceId: 'global_ai_replan',
        sourceKind: 'live',
        title: result.title,
      }),
      title: 'Live Mode 重排建议',
    }
  }
  if (result.kind === 'ledger_summary') {
    return {
      actionLabel: result.actionLabel,
      id: `global-ai:proposal:ledger:${context.trip?.id ?? 'account'}:${hashString(command)}`,
      kind: 'navigation_existing_flow',
      message: '账本写入仍在账本页完成；这里仅提供导航和只读摘要。',
      requiresConfirmation: false,
      sourceCards: context.sourceCards,
      suggestion: buildActionProposalSuggestion({
        actionKind: 'ledger_open_review',
        key: `global_ai:ledger:${context.trip?.id ?? 'account'}:${hashString(command)}`,
        message: '打开账本查看待确认费用，不自动写入。',
        now,
        scope: 'finance',
        sourceId: 'global_ai_ledger',
        sourceKind: 'ledger',
        title: result.title,
      }),
      title: '账本流程入口',
    }
  }
  return undefined
}

function buildActionProposalSuggestion({
  actionKind,
  affectedDayIds = [],
  affectedItemIds = [],
  key,
  message,
  now,
  scope,
  sourceId,
  sourceKind = 'operations',
  title,
}: {
  actionKind: string
  affectedDayIds?: string[]
  affectedItemIds?: string[]
  key: string
  message: string
  now: number
  scope: TripIntelligenceSuggestion['scope']
  sourceId: string
  sourceKind?: TripIntelligenceSuggestion['source']['kind']
  title: string
}): TripIntelligenceSuggestion {
  return {
    action: {
      kind: actionKind,
      label: title,
      mode: 'confirm_required',
      sourceActionKind: actionKind,
    },
    affectedDayIds,
    affectedItemIds,
    id: `${key}:${now}`,
    key,
    message,
    priority: 20,
    requiresConfirmation: true,
    requiresPreview: true,
    scope,
    severity: 'medium',
    source: { id: sourceId, kind: sourceKind, label: 'Global AI' },
    status: 'needs_confirmation',
    ticketIds: [],
    title,
  }
}

function buildLocalAssistantFallback(command: string, context: GlobalAiInteractionContext) {
  const summaries = buildAssistantContextSummaries(context)
  if (context.trip) {
    const current = context.currentItem
      ? `当前正在看「${context.currentItem.title}」。`
      : context.currentDay
        ? `当前正在看「${context.currentDay.title ?? context.currentDay.date}」。`
        : `当前正在看「${context.trip.title}」。`
    return `${current} 我看到：${summaries.slice(1, 4).map((summary) => `${summary.label} ${summary.value}`).join('；')}。要修改行程，直接说想怎么改。`
  }
  if (command.includes('新建') || command.includes('生成')) {
    return '打开 AI 生成行程后，我会先生成草案，再让你确认导入。'
  }
  return `我现在在「${context.scopeLabel}」。当前资料：${summaries.slice(1, 4).map((summary) => `${summary.label} ${summary.value}`).join('；')}。`
}

function formatUpcomingTrips(trips: GlobalAiAccountSummary['upcomingTrips']) {
  if (trips.length === 0) return '暂无即将开始或进行中的旅行'
  return trips.map((trip) => [trip.date, trip.title].filter(Boolean).join(' ')).join('；')
}

function formatCurrentTripFinance(expenses: LedgerExpense[]) {
  const draftCount = expenses.filter((expense) => expense.status === 'draft' || expense.reviewStatus === 'needs_review').length
  return `${expenses.length} 笔记录，其中 ${draftCount} 笔待确认`
}

function hashString(input: string) {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
