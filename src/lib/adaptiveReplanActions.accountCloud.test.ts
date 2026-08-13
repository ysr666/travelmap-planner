// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/database'
import type { Day, ItineraryItem, LedgerExpense, TicketMeta, Trip } from '../types'
import type { ProductAccountWorkflowInput } from './accountCloud/workflowMutationRuntime'
import type { ClientMutableAccountObjectType, JsonObject } from './accountCloud/contract'
import { parseAccountWorkflowRequestV1 } from './accountCloud/workflowContract'
import {
  buildAdaptiveReplanActionPreview,
  executeAdaptiveReplanAction,
  loadAdaptiveReplanActionContext,
} from './adaptiveReplanActions'

const mocks = vi.hoisted(() => ({ executeWorkflow: vi.fn() }))

vi.mock('./accountCloud/feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./accountCloud/feature')>()
  return { ...actual, isAccountCloudV2AccountEnabled: () => true }
})

vi.mock('./accountCloud/workflowRuntimeLoader', () => ({
  executeProductAccountWorkflowIfEnabled: mocks.executeWorkflow,
}))

beforeEach(async () => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  db.close()
  await db.delete()
  await db.open()
  mocks.executeWorkflow.mockReset()
  mocks.executeWorkflow.mockImplementation(async (input: ProductAccountWorkflowInput<unknown>) => {
    parseAccountWorkflowRequestV1({
      batchMutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      deviceId: 'device_test',
      schemaVersion: 1,
      steps: input.steps.map((step, index) => ({
        expectedRevision: step.objectType === 'trip' || step.objectType === 'item' ? 1 : 0,
        mutationId: deterministicUuid(index + 1),
        objectId: step.objectId,
        objectSchemaVersion: step.objectSchemaVersion ?? 1,
        objectType: step.objectType,
        operation: step.operation,
        ...(step.payload
          ? { payload: JSON.parse(JSON.stringify(step.payload)) as JsonObject }
          : {}),
        stepId: `step_${index + 1}`,
      })),
      tripId: input.tripId,
      workflowId: input.workflowId,
    })
    return { handled: true as const, value: await input.apply() }
  })
})

describe('adaptive replan Account Cloud product adapter', () => {
  it('submits one closed workflow and does not also write the legacy outbox', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    await seedRevisions(seed)
    const context = await loadAdaptiveReplanActionContext(seed.trip.id)
    const prepared = buildAdaptiveReplanActionPreview({
      context,
      day: seed.days[0],
      delayMinutes: 30,
      disruptionKind: 'late',
      item: seed.items[0],
      now: 100,
      operationFingerprint: 'ai-action-account-cloud-replan',
      strategy: 'least_change',
    })

    await expect(executeAdaptiveReplanAction(prepared)).resolves.toMatchObject({
      changed: true,
      changedItemCount: 2,
    })
    expect(mocks.executeWorkflow).toHaveBeenCalledTimes(1)
    const request = mocks.executeWorkflow.mock.calls[0]?.[0] as ProductAccountWorkflowInput<unknown>
    expect(request.workflowId).toBe('trip.replan.apply@1')
    expect(request.steps.map((step) => step.objectType)).toEqual([
      'trip',
      'item',
      'item',
      'replan_event',
      'replan_record',
      'trip_intelligence_applied_change',
    ])
    expect(request.steps.find((step) => step.objectType === 'replan_record')?.payload)
      .toMatchObject({
        accountObjectBaseline: expect.arrayContaining([
          { expectedRevision: 1, objectId: seed.trip.id, objectType: 'trip' },
          { expectedRevision: 1, objectId: seed.ticket.id, objectType: 'ticket_meta' },
          { expectedRevision: 1, objectId: seed.expense.id, objectType: 'ledger_expense' },
        ]),
      })
    await expect(db.syncOutbox.count()).resolves.toBe(0)
    await expect(db.tripReplanEvents.count()).resolves.toBe(1)
    await expect(db.tripReplanRecords.count()).resolves.toBe(1)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)

    await expect(executeAdaptiveReplanAction(prepared)).resolves.toMatchObject({
      changed: false,
      changedItemCount: 2,
    })
    expect(mocks.executeWorkflow).toHaveBeenCalledTimes(1)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
    await expect(executeAdaptiveReplanAction({
      ...prepared,
      previewFingerprint: 'substituted-preview',
    })).rejects.toThrow('已执行的突发重排策略不一致')
    expect(mocks.executeWorkflow).toHaveBeenCalledTimes(1)
  })

  it('removes V2 revision metadata before a legacy fallback write', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    await seedRevisions(seed)
    mocks.executeWorkflow.mockResolvedValueOnce({ handled: false })
    const context = await loadAdaptiveReplanActionContext(seed.trip.id)
    const prepared = buildAdaptiveReplanActionPreview({
      context,
      day: seed.days[0],
      delayMinutes: 30,
      disruptionKind: 'late',
      item: seed.items[0],
      now: 100,
      operationFingerprint: 'ai-action-account-cloud-fallback',
      strategy: 'least_change',
    })

    await expect(executeAdaptiveReplanAction(prepared)).resolves.toMatchObject({
      changed: true,
    })
    const record = await db.tripReplanRecords.get(prepared.recordId)
    expect(record).toBeDefined()
    expect(record).not.toHaveProperty('accountObjectBaseline')
    await expect(db.syncOutbox.count()).resolves.toBeGreaterThan(0)
  })

  it('falls back before mutation when the generated workflow exceeds cloud object limits', async () => {
    const seed = buildSeed()
    seed.items[0] = { ...seed.items[0], notes: 'x'.repeat(300_000) }
    await seedDatabase(seed)
    await seedRevisions(seed)
    const context = await loadAdaptiveReplanActionContext(seed.trip.id)
    const prepared = buildAdaptiveReplanActionPreview({
      context,
      day: seed.days[0],
      delayMinutes: 30,
      disruptionKind: 'late',
      item: seed.items[0],
      now: 100,
      operationFingerprint: 'ai-action-account-cloud-large-fallback',
      strategy: 'least_change',
    })

    await expect(executeAdaptiveReplanAction(prepared)).resolves.toMatchObject({
      changed: true,
    })
    expect(mocks.executeWorkflow).not.toHaveBeenCalled()
    const record = await db.tripReplanRecords.get(prepared.recordId)
    expect(record).not.toHaveProperty('accountObjectBaseline')
  })
})

function buildSeed() {
  const trip: Trip = {
    createdAt: 1,
    destination: '英国',
    endDate: '2026-07-11',
    id: 'trip-1',
    startDate: '2026-07-10',
    title: '英国旅行',
    updatedAt: 1,
  }
  const days: Day[] = [
    { date: '2026-07-10', id: 'day-1', sortOrder: 1, title: '伦敦', tripId: trip.id },
    { date: '2026-07-11', id: 'day-2', sortOrder: 2, title: '爱丁堡', tripId: trip.id },
  ]
  const items: ItineraryItem[] = [
    {
      createdAt: 1,
      dayId: 'day-1',
      endTime: '11:00',
      id: 'item-1',
      sortOrder: 1,
      startTime: '10:00',
      ticketIds: [],
      title: '伦敦眼',
      tripId: trip.id,
      updatedAt: 1,
    },
    {
      createdAt: 1,
      dayId: 'day-1',
      endTime: '13:00',
      id: 'item-2',
      sortOrder: 2,
      startTime: '12:00',
      ticketIds: ['ticket-1'],
      title: '大本钟',
      tripId: trip.id,
      updatedAt: 1,
    },
  ]
  const ticket: TicketMeta = {
    createdAt: 1,
    fileName: 'ticket.pdf',
    fileType: 'pdf',
    id: 'ticket-1',
    itemId: 'item-2',
    mimeType: 'application/pdf',
    scope: 'item',
    size: 100,
    storageMode: 'reference',
    title: '大本钟门票',
    tripId: trip.id,
    updatedAt: 1,
  }
  const expense: LedgerExpense = {
    amountMinor: 5_000,
    category: 'admission',
    createdAt: 1,
    currency: 'GBP',
    date: days[0].date,
    id: 'expense-1',
    itemIds: ['item-2'],
    source: { kind: 'ticket', sourceId: ticket.id },
    splitMode: 'equal',
    splitShares: [],
    status: 'confirmed',
    title: '大本钟门票',
    tripId: trip.id,
    updatedAt: 1,
  }
  return { days, expense, items, ticket, trip }
}

async function seedDatabase(seed: ReturnType<typeof buildSeed>) {
  await db.trips.put(seed.trip)
  await db.days.bulkPut(seed.days)
  await db.itineraryItems.bulkPut(seed.items)
  await db.ticketMetas.put(seed.ticket)
  await db.ledgerExpenses.put(seed.expense)
}

async function seedRevisions(seed: ReturnType<typeof buildSeed>) {
  const objects: Array<{
    object: Trip | Day | ItineraryItem | TicketMeta | LedgerExpense
    objectType: ClientMutableAccountObjectType
  }> = [
    { object: seed.trip, objectType: 'trip' as const },
    ...seed.days.map((object) => ({ object, objectType: 'day' as const })),
    ...seed.items.map((object) => ({ object, objectType: 'item' as const })),
    { object: seed.ticket, objectType: 'ticket_meta' as const },
    { object: seed.expense, objectType: 'ledger_expense' as const },
  ]
  await db.accountObjectRevisions.bulkPut(objects.map(({ object, objectType }, index) => ({
    acknowledgedAt: 1,
    actorId: '22222222-2222-4222-8222-222222222222',
    deletedAt: null,
    deviceId: 'device_test',
    mutationId: deterministicUuid(index + 20),
    objectId: object.id,
    objectKey: `${objectType}:${object.id}`,
    objectSchemaVersion: 1,
    objectType,
    payload: object as unknown as JsonObject,
    revision: 1,
    serverCreatedAt: '2026-08-11T12:00:00.000Z',
    serverUpdatedAt: '2026-08-11T12:00:00.000Z',
    tombstone: false,
    tripId: seed.trip.id,
    updatedAt: 1,
  })))
}

function deterministicUuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}
