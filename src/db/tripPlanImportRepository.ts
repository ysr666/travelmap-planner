import type {
  Day,
  ItineraryItem,
  LedgerBudget,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
  TicketBlob,
  TicketMeta,
  Trip,
} from '../types'
import { db } from './database'

export type ImportTripPlanRecordsInput = {
  trip: Trip
  days: Day[]
  itineraryItems: ItineraryItem[]
  ticketMetas: TicketMeta[]
  ticketBlobs: TicketBlob[]
  ledgerSettings?: LedgerSettings[]
  ledgerParticipants?: LedgerParticipant[]
  ledgerBudgets?: LedgerBudget[]
  ledgerExpenses?: LedgerExpense[]
}

export type TripPlanImportPlan = {
  days: Day[]
  fingerprint: string
  itineraryItems: ItineraryItem[]
  ledgerBudgets: LedgerBudget[]
  ledgerExpenses: LedgerExpense[]
  ledgerParticipants: LedgerParticipant[]
  ledgerSettings: LedgerSettings[]
  ticketBlobs: TicketBlob[]
  ticketMetas: TicketMeta[]
  trip: Trip
}

export class TripPlanImportConflictError extends Error {}

export async function importTripPlanRecords(
  input: ImportTripPlanRecordsInput,
): Promise<{ title: string; tripId: string }> {
  const plan = await prepareTripPlanImport(input)
  return applyTripPlanImportPlan(plan)
}

export async function prepareTripPlanImport(
  input: ImportTripPlanRecordsInput,
): Promise<TripPlanImportPlan> {
  const plan = buildTripPlanImportPlan(input)
  await assertTripPlanImportBaselineEmpty(plan)
  return plan
}

export async function applyTripPlanImportPlan(
  plan: TripPlanImportPlan,
): Promise<{ title: string; tripId: string }> {
  return db.transaction(
    'rw',
    [
      db.trips,
      db.days,
      db.itineraryItems,
      db.ticketMetas,
      db.ticketBlobs,
      db.ledgerSettings,
      db.ledgerParticipants,
      db.ledgerBudgets,
      db.ledgerExpenses,
      db.tripIntelligenceAppliedChanges,
      db.tripIntelligenceSuggestionStates,
      db.tripReplanEvents,
      db.tripReplanRecords,
    ],
    async () => {
      const verified = buildTripPlanImportPlan(plan)
      if (verified.fingerprint !== plan.fingerprint) {
        throw new TripPlanImportConflictError('导入计划已变化，请重新生成预览。')
      }
      await assertTripPlanImportBaselineEmpty(verified)
      await db.trips.add(verified.trip)
      if (verified.days.length > 0) await db.days.bulkAdd(verified.days)
      if (verified.itineraryItems.length > 0) await db.itineraryItems.bulkAdd(verified.itineraryItems)
      if (verified.ticketMetas.length > 0) await db.ticketMetas.bulkAdd(verified.ticketMetas)
      if (verified.ticketBlobs.length > 0) await db.ticketBlobs.bulkAdd(verified.ticketBlobs)
      if (verified.ledgerSettings.length > 0) await db.ledgerSettings.bulkAdd(verified.ledgerSettings)
      if (verified.ledgerParticipants.length > 0) await db.ledgerParticipants.bulkAdd(verified.ledgerParticipants)
      if (verified.ledgerBudgets.length > 0) await db.ledgerBudgets.bulkAdd(verified.ledgerBudgets)
      if (verified.ledgerExpenses.length > 0) await db.ledgerExpenses.bulkAdd(verified.ledgerExpenses)

      return { title: verified.trip.title, tripId: verified.trip.id }
    },
  )
}

function buildTripPlanImportPlan(input: ImportTripPlanRecordsInput): TripPlanImportPlan {
  const normalized = {
    days: [...input.days],
    itineraryItems: [...input.itineraryItems],
    ledgerBudgets: [...(input.ledgerBudgets ?? [])],
    ledgerExpenses: [...(input.ledgerExpenses ?? [])],
    ledgerParticipants: [...(input.ledgerParticipants ?? [])],
    ledgerSettings: [...(input.ledgerSettings ?? [])],
    ticketBlobs: [...input.ticketBlobs],
    ticketMetas: [...input.ticketMetas],
    trip: input.trip,
  }
  assertTripPlanImportGraph(normalized)
  return {
    ...normalized,
    fingerprint: JSON.stringify({
      ...normalized,
      ticketBlobs: normalized.ticketBlobs.map(({ blob, ticketId }) => ({
        mimeType: blob.type,
        size: blob.size,
        ticketId,
      })),
    }),
  }
}

function assertTripPlanImportGraph(input: Omit<TripPlanImportPlan, 'fingerprint'>) {
  const {
    days,
    itineraryItems,
    ledgerBudgets,
    ledgerExpenses,
    ledgerParticipants,
    ledgerSettings,
    ticketBlobs,
    ticketMetas,
    trip,
  } = input
  if (!trip?.id) throw new Error('导入行程缺少旅行 ID。')
  assertUniqueIds('Day', days.map((day) => day.id))
  assertUniqueIds('ItineraryItem', itineraryItems.map((item) => item.id))
  assertUniqueIds('Ticket', ticketMetas.map((ticket) => ticket.id))
  assertUniqueIds('TicketBlob', ticketBlobs.map((ticket) => ticket.ticketId))
  assertUniqueIds('LedgerSettings', ledgerSettings.map((settings) => settings.id))
  assertUniqueIds('LedgerParticipant', ledgerParticipants.map((participant) => participant.id))
  assertUniqueIds('LedgerBudget', ledgerBudgets.map((budget) => budget.id))
  assertUniqueIds('LedgerExpense', ledgerExpenses.map((expense) => expense.id))
  if (ledgerSettings.length > 1) throw new Error('一趟旅行只能导入一组账本设置。')

  const tripRecords = [
    ...days,
    ...itineraryItems,
    ...ticketMetas,
    ...ledgerSettings,
    ...ledgerParticipants,
    ...ledgerBudgets,
    ...ledgerExpenses,
  ]
  if (tripRecords.some((record) => record.tripId !== trip.id)) {
    throw new Error('导入记录不属于同一趟旅行。')
  }

  assertContiguousImportOrder('旅行日期', days.map((day) => day.sortOrder))
  const dayIds = new Set(days.map((day) => day.id))
  const itemsByDay = new Map<string, ItineraryItem[]>()
  for (const item of itineraryItems) {
    if (!dayIds.has(item.dayId)) throw new Error(`行程点引用了未导入的日期：${item.dayId}`)
    const siblings = itemsByDay.get(item.dayId) ?? []
    siblings.push(item)
    itemsByDay.set(item.dayId, siblings)
  }
  for (const [dayId, items] of itemsByDay) {
    assertContiguousImportOrder(`日期 ${dayId} 的行程点`, items.map((item) => item.sortOrder))
  }

  const itemById = new Map(itineraryItems.map((item) => [item.id, item]))
  const ticketById = new Map(ticketMetas.map((ticket) => [ticket.id, ticket]))
  for (const item of itineraryItems) {
    if (!Array.isArray(item.ticketIds) || new Set(item.ticketIds).size !== item.ticketIds.length) {
      throw new Error(`行程点票据关系无效：${item.id}`)
    }
    for (const ticketId of item.ticketIds) {
      const ticket = ticketById.get(ticketId)
      if (!ticket || ticket.itemId !== item.id || ticket.scope !== 'item') {
        throw new Error(`行程点引用了不匹配的票据：${ticketId}`)
      }
    }
  }
  for (const ticket of ticketMetas) {
    if ((ticket.scope === 'item') !== Boolean(ticket.itemId)) {
      throw new Error(`票据范围与行程点关系不一致：${ticket.id}`)
    }
    if (!ticket.itemId) continue
    const item = itemById.get(ticket.itemId)
    if (!item || !item.ticketIds.includes(ticket.id)) {
      throw new Error(`票据引用了未导入或未反向关联的行程点：${ticket.itemId}`)
    }
  }
  for (const ticketBlob of ticketBlobs) {
    const ticket = ticketById.get(ticketBlob.ticketId)
    if (!ticket) throw new Error(`票据文件缺少对应 metadata：${ticketBlob.ticketId}`)
    if ((ticket.storageMode ?? 'copy') !== 'copy') {
      throw new Error(`非复制票据不能包含本机文件：${ticketBlob.ticketId}`)
    }
  }

  const participantIds = new Set(ledgerParticipants.map((participant) => participant.id))
  const itemIds = new Set(itineraryItems.map((item) => item.id))
  const expenseIds = new Set(ledgerExpenses.map((expense) => expense.id))
  for (const expense of ledgerExpenses) {
    if (expense.payerParticipantId && !participantIds.has(expense.payerParticipantId)) {
      throw new Error(`账单付款人未包含在导入参与人中：${expense.payerParticipantId}`)
    }
    if (!Array.isArray(expense.splitShares)) throw new Error(`账单缺少分摊信息：${expense.id}`)
    const shareIds = expense.splitShares.map((share) => share.participantId)
    if (
      new Set(shareIds).size !== shareIds.length
      || shareIds.some((participantId) => !participantIds.has(participantId))
    ) {
      throw new Error(`账单分摊引用了未导入或重复的参与人：${expense.id}`)
    }
    if (expense.itemIds && (
      new Set(expense.itemIds).size !== expense.itemIds.length
      || expense.itemIds.some((itemId) => !itemIds.has(itemId))
    )) {
      throw new Error(`账单引用了未导入或重复的行程点：${expense.id}`)
    }
    if (expense.originalExpenseId && !expenseIds.has(expense.originalExpenseId)) {
      throw new Error(`账单引用了未导入的原始费用：${expense.originalExpenseId}`)
    }
    if (
      expense.source.kind === 'ticket'
      && expense.source.sourceId
      && !ticketById.has(expense.source.sourceId)
    ) {
      throw new Error(`账单引用了未导入的票据：${expense.source.sourceId}`)
    }
  }
}

function assertContiguousImportOrder(label: string, orders: number[]) {
  if (orders.length === 0) return
  if (orders.some((order) => !Number.isSafeInteger(order) || order < 0)) {
    throw new Error(`${label}排序无效。`)
  }
  const sorted = [...orders].sort((first, second) => first - second)
  if (
    new Set(sorted).size !== sorted.length
    || (sorted[0] !== 0 && sorted[0] !== 1)
    || sorted.some((order, index) => order !== (sorted[0] ?? 0) + index)
  ) {
    throw new Error(`${label}排序必须连续。`)
  }
}

async function assertTripPlanImportBaselineEmpty(plan: TripPlanImportPlan) {
  const targetChecks = await Promise.all([
    db.trips.get(plan.trip.id),
    db.days.bulkGet(plan.days.map((day) => day.id)),
    db.itineraryItems.bulkGet(plan.itineraryItems.map((item) => item.id)),
    db.ticketMetas.bulkGet(plan.ticketMetas.map((ticket) => ticket.id)),
    db.ticketBlobs.bulkGet(plan.ticketBlobs.map((ticket) => ticket.ticketId)),
    db.ledgerSettings.bulkGet(plan.ledgerSettings.map((settings) => settings.id)),
    db.ledgerParticipants.bulkGet(plan.ledgerParticipants.map((participant) => participant.id)),
    db.ledgerBudgets.bulkGet(plan.ledgerBudgets.map((budget) => budget.id)),
    db.ledgerExpenses.bulkGet(plan.ledgerExpenses.map((expense) => expense.id)),
  ])
  const sameTripCounts = await Promise.all([
    db.days.where('tripId').equals(plan.trip.id).count(),
    db.itineraryItems.where('tripId').equals(plan.trip.id).count(),
    db.ticketMetas.where('tripId').equals(plan.trip.id).count(),
    db.ledgerSettings.where('tripId').equals(plan.trip.id).count(),
    db.ledgerParticipants.where('tripId').equals(plan.trip.id).count(),
    db.ledgerBudgets.where('tripId').equals(plan.trip.id).count(),
    db.ledgerExpenses.where('tripId').equals(plan.trip.id).count(),
    db.tripIntelligenceAppliedChanges.where('tripId').equals(plan.trip.id).count(),
    db.tripIntelligenceSuggestionStates.where('tripId').equals(plan.trip.id).count(),
    db.tripReplanEvents.where('tripId').equals(plan.trip.id).count(),
    db.tripReplanRecords.where('tripId').equals(plan.trip.id).count(),
  ])
  const targetExists = targetChecks.some((result) => (
    Array.isArray(result) ? result.some(Boolean) : Boolean(result)
  ))
  if (targetExists || sameTripCounts.some((count) => count > 0)) {
    throw new TripPlanImportConflictError('导入目标已存在或旅行数据已变化，请重新生成预览。')
  }
}

function assertUniqueIds(label: string, ids: string[]) {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} 数据包含重复 ID。`)
  }
}
