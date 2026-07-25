// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../db/database'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../../../types'
import {
  buildDeterministicAiActionPlan,
  executeAiActionPlan,
  prepareAiActionPlan,
  validateAiActionPlan,
  type AiActionGatewayRuntimeContext,
} from '.'

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  db.close()
  await db.delete()
  await db.open()
})

describe('AI Action Gateway runtime', () => {
  it('opens a matching ticket without a provider request', async () => {
    const seed = buildSeed()
    const ticket: TicketMeta = {
      createdAt: 1,
      fileName: 'edinburgh.pdf',
      fileType: 'pdf',
      id: 'ticket-1',
      mimeType: 'application/pdf',
      scope: 'trip',
      size: 100,
      storageMode: 'reference',
      title: '爱丁堡城堡门票',
      tripId: seed.trip.id,
      updatedAt: 1,
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed, { tickets: [ticket] })
    const plan = buildDeterministicAiActionPlan('找一下爱丁堡的门票')
    expect(plan).not.toBeNull()

    const prepared = await prepareAiActionPlan(plan!, context)
    const result = await executeAiActionPlan(prepared, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.status).toBe('completed')
    expect(result.effects).toEqual([expect.objectContaining({
      kind: 'navigate',
      params: expect.objectContaining({ ticketId: ticket.id }),
      route: 'documents',
    })])
  })

  it('opens a registered semantic workspace target without a provider request', async () => {
    const seed = buildSeed()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('打开资料中心')
    expect(plan).not.toBeNull()

    const prepared = await prepareAiActionPlan(plan!, context)
    const result = await executeAiActionPlan(prepared, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(false)
    expect(result).toMatchObject({
      status: 'completed',
      effects: [{
        kind: 'navigate',
        params: { tab: 'documents', tripId: seed.trip.id },
        route: 'documents',
      }],
    })
  })

  it('previews an item time change and preserves duration until confirmed execution', async () => {
    const seed = buildSeed()
    seed.item.startTime = '09:00'
    seed.item.endTime = '10:30'
    await seedDatabase(seed)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('把第一站改到11点')
    expect(plan).not.toBeNull()

    const prepared = await prepareAiActionPlan(plan!, context)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepared.plan.requiresConfirmation).toBe(true)
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: [seed.item.title],
      hasWrite: true,
      preview: `${seed.item.title}：09:00-10:30 → 11:00-12:30。`,
      status: 'prepared',
    })
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      endTime: '10:30',
      startTime: '09:00',
    })

    const result = await executeAiActionPlan(prepared, context)

    expect(result.status).toBe('completed')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      endTime: '12:30',
      startTime: '11:00',
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('blocks a prepared item time change after the trip state becomes stale', async () => {
    const seed = buildSeed()
    seed.item.startTime = '09:00'
    seed.item.endTime = '10:00'
    await seedDatabase(seed)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('把第一站改到11点')!
    const prepared = await prepareAiActionPlan(plan, context)
    await db.itineraryItems.update(seed.item.id, { startTime: '08:30', updatedAt: 2 })

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({
      message: '旅行内容已变化，请重新生成预览。',
      status: 'failed',
    })
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      endTime: '10:00',
      startTime: '08:30',
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('previews a sourced place candidate and writes only after execution', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      operation: 'place_lookup',
      results: [{
        displayName: '伦敦希思罗机场',
        formattedAddress: 'Hounslow, United Kingdom',
        location: { lat: 51.47, lng: -0.4543 },
        placeId: 'places/heathrow',
        provider: 'google_places',
        retrievedAt: '2026-07-25T00:00:00.000Z',
      }],
      retrievedAt: '2026-07-25T00:00:00.000Z',
      source: 'mock',
    }), { status: 200 })) as unknown as typeof fetch)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('补全第一站地点信息')
    expect(plan).not.toBeNull()

    const prepared = await prepareAiActionPlan(plan!, context)
    await expect(db.itineraryItems.get(seed.item.id)).resolves.not.toMatchObject({ lat: 51.47 })
    expect(prepared.steps[0]).toMatchObject({
      affectedLabels: [seed.item.title],
      status: 'prepared',
    })

    const result = await executeAiActionPlan(prepared, context)
    expect(result.status).toBe('completed')
    await expect(db.itineraryItems.get(seed.item.id)).resolves.toMatchObject({
      address: 'Hounslow, United Kingdom',
      lat: 51.47,
      lng: -0.4543,
      locationName: '伦敦希思罗机场',
    })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
  })

  it('blocks a prepared write when the trip changed before confirmation', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      operation: 'place_lookup',
      results: [{
        displayName: '伦敦希思罗机场',
        formattedAddress: 'Hounslow, United Kingdom',
        location: { lat: 51.47, lng: -0.4543 },
        placeId: 'places/heathrow',
        provider: 'google_places',
        retrievedAt: '2026-07-25T00:00:00.000Z',
      }],
      retrievedAt: '2026-07-25T00:00:00.000Z',
      source: 'mock',
    }), { status: 200 })) as unknown as typeof fetch)
    const context = runtimeContext(seed)
    const plan = buildDeterministicAiActionPlan('补全第一站地点信息')!
    const prepared = await prepareAiActionPlan(plan, context)
    await db.itineraryItems.update(seed.item.id, { title: '用户刚刚修改的标题', updatedAt: 2 })

    const result = await executeAiActionPlan(prepared, context)

    expect(result).toMatchObject({ status: 'failed', message: '旅行内容已变化，请重新生成预览。' })
    await expect(db.itineraryItems.get(seed.item.id)).resolves.not.toMatchObject({ lat: 51.47 })
  })

  it('preserves completed step ids when a retry preview becomes stale', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      operation: 'place_lookup',
      results: [{
        displayName: '伦敦希思罗机场',
        formattedAddress: 'Hounslow, United Kingdom',
        location: { lat: 51.47, lng: -0.4543 },
        placeId: 'places/heathrow',
        provider: 'google_places',
        retrievedAt: '2026-07-25T00:00:00.000Z',
      }],
      retrievedAt: '2026-07-25T00:00:00.000Z',
      source: 'mock',
    }), { status: 200 })) as unknown as typeof fetch)
    const context = runtimeContext(seed)
    const validation = validateAiActionPlan({
      schemaVersion: 'ai_action_plan.v1',
      steps: [
        { actionId: 'ticket.open@1', args: {}, dependsOn: [], id: 'ticket' },
        { actionId: 'place.enrich@1', args: { target: 'first_item' }, dependsOn: [], id: 'place' },
      ],
      summary: '打开票据并补全地点',
    })
    expect(validation.ok).toBe(true)
    if (!validation.ok) return
    const prepared = await prepareAiActionPlan(validation.plan, context, {
      completedStepIds: ['ticket'],
    })
    await db.itineraryItems.update(seed.item.id, { title: '旅行已变化', updatedAt: 2 })

    const result = await executeAiActionPlan(prepared, context, {
      completedStepIds: ['ticket'],
    })

    expect(result).toMatchObject({
      completedStepIds: ['ticket'],
      failedStepIds: ['place'],
      status: 'partial',
      steps: [
        { id: 'ticket', status: 'skipped' },
        { id: 'place', status: 'failed' },
      ],
    })
  })

  it('rejects an ambiguous place target before calling the provider', async () => {
    const seed = buildSeed()
    const secondItem: ItineraryItem = {
      ...seed.item,
      id: 'item-2',
      sortOrder: 2,
      title: '伦敦塔',
    }
    seed.item.title = '伦敦眼'
    const context = runtimeContext(seed)
    context.commandContext.items = [seed.item, secondItem]
    const validation = validateAiActionPlan({
      schemaVersion: 'ai_action_plan.v1',
      steps: [{
        actionId: 'place.enrich@1',
        args: { target: '伦敦' },
        dependsOn: [],
        id: 'place',
      }],
      summary: '补全地点',
    })
    expect(validation.ok).toBe(true)
    if (!validation.ok) return
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const prepared = await prepareAiActionPlan(validation.plan, context)

    expect(prepared.steps[0]).toMatchObject({
      error: '找到多个匹配行程点，请写清楚名称。',
      status: 'failed',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('exposes high-risk issues as a manual entry without requesting write confirmation', async () => {
    const seed = buildSeed()
    const ticket: TicketMeta = {
      createdAt: 1,
      fileName: 'passport.pdf',
      fileType: 'pdf',
      id: 'ticket-risk',
      mimeType: 'application/pdf',
      scope: 'trip',
      size: 100,
      storageMode: 'reference',
      title: '护照复印件',
      tripId: seed.trip.id,
      updatedAt: 1,
    }
    await db.transaction('rw', [db.trips, db.ticketMetas, db.ticketBlobSyncStates], async () => {
      await db.trips.put(seed.trip)
      await db.ticketMetas.put(ticket)
      await db.ticketBlobSyncStates.put({
        cacheStatus: 'missing',
        fileName: ticket.fileName,
        ticketId: ticket.id,
        tripId: seed.trip.id,
        updatedAt: 1,
        uploadStatus: 'missing',
      })
    })
    const context = runtimeContext(seed, { tickets: [ticket] })
    context.commandContext.currentDay = undefined
    context.commandContext.currentItem = undefined
    context.commandContext.days = []
    context.commandContext.items = []
    const plan = buildDeterministicAiActionPlan('修复所有问题')
    expect(plan).not.toBeNull()

    const prepared = await prepareAiActionPlan(plan!, context)

    expect(prepared.plan.requiresConfirmation).toBe(false)
    expect(prepared.steps[0]).toMatchObject({
      hasWrite: false,
      manualEntry: {
        kind: 'navigate',
        params: { tripId: seed.trip.id },
        route: 'trip',
        scrollTargetId: 'trip-readiness-details-section',
      },
      status: 'prepared',
    })
    const result = await executeAiActionPlan(prepared, context)
    expect(result).toMatchObject({ status: 'completed' })
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
  })

  it('retries only failed steps and does not repeat completed navigation', async () => {
    const seed = buildSeed()
    await seedDatabase(seed)
    const ticket: TicketMeta = {
      createdAt: 1,
      fileName: 'edinburgh.pdf',
      fileType: 'pdf',
      id: 'ticket-1',
      mimeType: 'application/pdf',
      scope: 'trip',
      size: 100,
      storageMode: 'reference',
      title: '爱丁堡城堡门票',
      tripId: seed.trip.id,
      updatedAt: 1,
    }
    let lookupCount = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      lookupCount += 1
      if (lookupCount === 1) throw new Error('temporary provider failure')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'place_lookup',
        results: [{
          displayName: '伦敦希思罗机场',
          formattedAddress: 'Hounslow, United Kingdom',
          location: { lat: 51.47, lng: -0.4543 },
          placeId: 'places/heathrow',
          provider: 'google_places',
          retrievedAt: '2026-07-25T00:00:00.000Z',
        }],
        retrievedAt: '2026-07-25T00:00:00.000Z',
        source: 'mock',
      }), { status: 200 })
    }) as unknown as typeof fetch)
    const context = runtimeContext(seed, { tickets: [ticket] })
    const validation = validateAiActionPlan({
      schemaVersion: 'ai_action_plan.v1',
      steps: [
        { actionId: 'ticket.open@1', args: { query: '爱丁堡' }, dependsOn: [], id: 'ticket' },
        { actionId: 'place.enrich@1', args: { target: 'first_item' }, dependsOn: [], id: 'place' },
      ],
      summary: '打开票据并补全地点',
    })
    expect(validation.ok).toBe(true)
    if (!validation.ok) return

    const firstPrepared = await prepareAiActionPlan(validation.plan, context)
    const firstRun = await executeAiActionPlan(firstPrepared, context)
    expect(firstRun).toMatchObject({
      completedStepIds: ['ticket'],
      failedStepIds: ['place'],
      status: 'partial',
    })
    expect(firstRun.effects).toHaveLength(1)

    const retryPrepared = await prepareAiActionPlan(
      validation.plan,
      context,
      { completedStepIds: firstRun.completedStepIds },
    )
    const retryRun = await executeAiActionPlan(
      retryPrepared,
      context,
      { completedStepIds: firstRun.completedStepIds },
    )

    expect(retryRun.status).toBe('completed')
    expect(retryRun.effects).toHaveLength(0)
    expect(retryRun.steps[0]).toMatchObject({ id: 'ticket', status: 'skipped' })
    expect(lookupCount).toBe(2)
  })
})

function buildSeed() {
  const trip: Trip = {
    createdAt: 1,
    destination: '英国',
    endDate: '2026-07-21',
    id: 'trip-1',
    startDate: '2026-07-10',
    title: '英国旅行',
    updatedAt: 1,
  }
  const day: Day = {
    date: '2026-07-10',
    id: 'day-1',
    sortOrder: 1,
    title: '抵达伦敦',
    tripId: trip.id,
  }
  const item: ItineraryItem = {
    createdAt: 1,
    dayId: day.id,
    id: 'item-1',
    sortOrder: 1,
    ticketIds: [],
    title: '抵达伦敦',
    tripId: trip.id,
    updatedAt: 1,
  }
  return { day, item, trip }
}

function runtimeContext(
  seed: ReturnType<typeof buildSeed>,
  overrides: { tickets?: TicketMeta[] } = {},
): AiActionGatewayRuntimeContext {
  return {
    command: '测试',
    commandContext: {
      activeRoute: 'item',
      currentDay: seed.day,
      currentItem: seed.item,
      days: [seed.day],
      hash: `#/item?tripId=${seed.trip.id}&dayId=${seed.day.id}&itemId=${seed.item.id}`,
      items: [seed.item],
      ledgerExpenses: [],
      params: new URLSearchParams(`tripId=${seed.trip.id}&dayId=${seed.day.id}&itemId=${seed.item.id}`),
      tickets: overrides.tickets ?? [],
      trip: seed.trip,
    },
    providerConfig: {
      configured: true,
      provider: 'google',
      proxyUrl: '/api/provider-proxy',
      source: 'proxy',
    },
  }
}

async function seedDatabase(seed: ReturnType<typeof buildSeed>) {
  await db.transaction('rw', [db.trips, db.days, db.itineraryItems], async () => {
    await db.trips.put(seed.trip)
    await db.days.put(seed.day)
    await db.itineraryItems.put(seed.item)
  })
}
