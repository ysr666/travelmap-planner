// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addSharedTripComment,
  buildSharedTripProjection,
  canCompanionCollaborate,
  canCompanionComment,
  claimSharedTripInvite,
  createSharedTripInvite,
  getCompanionPermissionRank,
  loadCompanionSharedTrip,
  loadOwnerSharedTripState,
  publishSharedTripFromLocal,
  submitSharedTripMutation,
  syncSharedTripForOwner,
} from './companion'
import { createDay, createItineraryItem, createTicketMeta, createTrip, getItineraryItem, listTripDisruptionEventsByTrip } from '../db'
import { db } from '../db/database'
import type { ItineraryItem } from '../types'

const fixtureKey = 'tripmap:e2e:cloud-fixture'

beforeEach(async () => {
  window.localStorage.clear()
  await db.delete()
  await db.open()
})

describe('companion permissions', () => {
  it('ranks read comment and collaborate permissions', () => {
    expect(getCompanionPermissionRank('read')).toBe(1)
    expect(getCompanionPermissionRank('comment')).toBe(2)
    expect(getCompanionPermissionRank('collaborate')).toBe(3)
    expect(canCompanionComment('read')).toBe(false)
    expect(canCompanionComment('comment')).toBe(true)
    expect(canCompanionCollaborate('comment')).toBe(false)
    expect(canCompanionCollaborate('collaborate')).toBe(true)
  })
})

describe('shared trip projection', () => {
  it('keeps ticket files and enrichment data out of the shared projection', () => {
    const trip = {
      createdAt: 1,
      destination: '东京',
      endDate: '2026-04-03',
      id: 'trip_1',
      startDate: '2026-04-01',
      title: '东京旅行',
      updatedAt: 1,
    }
    const day = {
      date: '2026-04-01',
      id: 'day_1',
      sortOrder: 1,
      title: '第一天',
      tripId: trip.id,
    }
    const item: ItineraryItem = {
      contentEnrichment: {
        baselineFingerprint: 'secret',
        generatedAt: '2026-04-01T00:00:00.000Z',
        notices: [],
        schemaVersion: 1,
        sources: [],
        warnings: [],
      },
      createdAt: 1,
      dayId: day.id,
      id: 'item_1',
      sortOrder: 1,
      ticketIds: ['ticket_1'],
      title: '美术馆',
      tripId: trip.id,
      updatedAt: 1,
    }
    const projection = buildSharedTripProjection({
      days: [day],
      items: [item],
      tickets: [{
        createdAt: 1,
        externalUrl: 'https://tickets.example/secret',
        fileName: 'passport-name-ticket.pdf',
        fileType: 'pdf',
        id: 'ticket_1',
        mimeType: 'application/pdf',
        note: '敏感备注',
        size: 123,
        storageMode: 'external',
        title: '美术馆门票',
        tripId: trip.id,
        updatedAt: 1,
      }],
      trip,
    })

    expect(JSON.stringify(projection)).not.toContain('contentEnrichment')
    expect(JSON.stringify(projection)).not.toContain('passport-name-ticket.pdf')
    expect(JSON.stringify(projection)).not.toContain('https://tickets.example/secret')
    expect(JSON.stringify(projection)).not.toContain('敏感备注')
    expect(projection.schemaVersion).toBe(2)
    expect(projection.items[0]).toMatchObject({ ticketSummaryIds: ['ticket_1'] })
    expect(projection.ticketSummaries[0]).toMatchObject({ title: '美术馆门票', fileType: 'pdf' })
  })

  it('includes the latest applied replan summary without exposing snapshots', () => {
    const trip = {
      createdAt: 1,
      destination: '东京',
      endDate: '2026-04-03',
      id: 'trip_1',
      startDate: '2026-04-01',
      title: '东京旅行',
      updatedAt: 1,
    }
    const day = { date: '2026-04-01', id: 'day_1', sortOrder: 1, title: '第一天', tripId: trip.id }
    const projection = buildSharedTripProjection({
      days: [day],
      items: [],
      replanEvents: [{
        createdAt: 1,
        evidence: [],
        id: 'event_1',
        kind: 'late',
        occurredAt: '2026-04-01T01:00:00.000Z',
        reportedByRole: 'owner',
        status: 'applied',
        tripId: trip.id,
        updatedAt: 1,
      }],
      replanRecords: [{
        baselineFingerprint: 'before-secret',
        beforeSnapshot: { days: [day], items: [] },
        createdAt: 1,
        eventId: 'event_1',
        evidence: [],
        id: 'record_1',
        options: [{
          diff: {
            companionImpacts: [{ meetingTime: '10:30', summary: '集合时间更新为 10:30。', title: '美术馆' }],
            itemChanges: [],
            ledgerImpacts: [],
            routeImpacts: [],
            ticketImpacts: [],
            warnings: [],
          },
          id: 'option_1',
          itemPatches: [],
          score: 1,
          strategy: 'least_change',
          summary: '调整 1 个行程点。',
          title: '最少改动',
        }],
        selectedDiff: {
          companionImpacts: [{ meetingTime: '10:30', summary: '集合时间更新为 10:30。', title: '美术馆' }],
          itemChanges: [],
          ledgerImpacts: [],
          routeImpacts: [],
          ticketImpacts: [],
          warnings: [],
        },
        selectedOptionId: 'option_1',
        status: 'applied',
        tripId: trip.id,
        updatedAt: 2,
      }],
      tickets: [],
      trip,
    })

    expect(projection.latestReplanSummary).toMatchObject({ eventKind: 'late', recordId: 'record_1' })
    expect(projection.meetingChangeSummaries?.[0]).toMatchObject({ meetingTime: '10:30' })
    expect(JSON.stringify(projection)).not.toContain('before-secret')
  })
})

describe('companion fixture flow', () => {
  it('allows comments but denies collaborator mutations for comment-only members', async () => {
    const { item, trip } = await seedTrip()
    setFixtureUser('owner_1', 'owner@example.com')
    const { sharedTrip } = await publishSharedTripFromLocal(trip.id)
    const invite = await createSharedTripInvite({ permission: 'comment', sharedTripId: sharedTrip.id })

    setFixtureUser('member_1', 'member@example.com')
    const claimed = await claimSharedTripInvite(invite.token, '小叶')
    expect(claimed.permission).toBe('comment')
    await addSharedTripComment(claimed.sharedTripId, item.id, '我已到集合点')
    await expect(submitSharedTripMutation(claimed.sharedTripId, {
      mutationType: 'update_item',
      payload: { itemId: item.id, patch: { title: '改标题' } },
    })).rejects.toThrow('当前权限不能协作修改行程')

    const bundle = await loadCompanionSharedTrip(claimed.sharedTripId)
    expect(bundle.comments).toHaveLength(1)
    expect(bundle.comments[0]).toMatchObject({ body: '我已到集合点', displayName: '小叶' })
  })

  it('lets the owner apply safe collaborator itinerary mutations', async () => {
    const { item, trip } = await seedTrip()
    setFixtureUser('owner_1', 'owner@example.com')
    const { sharedTrip } = await publishSharedTripFromLocal(trip.id)
    const invite = await createSharedTripInvite({ permission: 'collaborate', sharedTripId: sharedTrip.id })

    setFixtureUser('member_2', 'collab@example.com')
    await claimSharedTripInvite(invite.token, '协作者')
    await submitSharedTripMutation(sharedTrip.id, {
      mutationType: 'update_item',
      payload: {
        baselineUpdatedAt: item.updatedAt,
        itemId: item.id,
        patch: { startTime: '10:30', title: '协作修改后的美术馆' },
      },
    })

    setFixtureUser('owner_1', 'owner@example.com')
    const ownerState = await loadOwnerSharedTripState(trip.id)
    expect(ownerState.configured && ownerState.signedIn ? ownerState.mutations.filter((mutation) => mutation.status === 'pending') : []).toHaveLength(1)
    await expect(syncSharedTripForOwner(trip.id)).resolves.toMatchObject({ applied: 1, conflicts: 0, published: true })
    await expect(getItineraryItem(item.id)).resolves.toMatchObject({
      startTime: '10:30',
      title: '协作修改后的美术馆',
    })
  })

  it('allows comment members to report disruptions without applying itinerary changes', async () => {
    const { item, trip } = await seedTrip()
    setFixtureUser('owner_1', 'owner@example.com')
    const { sharedTrip } = await publishSharedTripFromLocal(trip.id)
    const invite = await createSharedTripInvite({ permission: 'comment', sharedTripId: sharedTrip.id })

    setFixtureUser('member_3', 'member@example.com')
    await claimSharedTripInvite(invite.token, '小叶')
    await submitSharedTripMutation(sharedTrip.id, {
      mutationType: 'report_disruption',
      payload: { delayMinutes: 20, itemId: item.id, kind: 'late', notes: '我会晚到 20 分钟' },
    })

    setFixtureUser('owner_1', 'owner@example.com')
    await expect(syncSharedTripForOwner(trip.id)).resolves.toMatchObject({ applied: 1, conflicts: 0, published: true })
    const events = await listTripDisruptionEventsByTrip(trip.id)
    expect(events[0]).toMatchObject({
      delayMinutes: 20,
      itemId: item.id,
      kind: 'late',
      reportedByDisplayName: '小叶',
      reportedByRole: 'companion',
    })
    await expect(getItineraryItem(item.id)).resolves.toMatchObject({ startTime: '09:00' })
  })

  it('keeps replan undo requests pending for owner approval', async () => {
    const { trip } = await seedTrip()
    setFixtureUser('owner_1', 'owner@example.com')
    const { sharedTrip } = await publishSharedTripFromLocal(trip.id)
    const invite = await createSharedTripInvite({ permission: 'collaborate', sharedTripId: sharedTrip.id })

    setFixtureUser('member_4', 'collab@example.com')
    await claimSharedTripInvite(invite.token, '协作者')
    await submitSharedTripMutation(sharedTrip.id, {
      mutationType: 'request_replan_undo',
      payload: { recordId: 'record_1', notes: '集合时间看起来不对' },
    })

    setFixtureUser('owner_1', 'owner@example.com')
    await expect(syncSharedTripForOwner(trip.id)).resolves.toMatchObject({ applied: 0, conflicts: 0, published: true })
    const ownerState = await loadOwnerSharedTripState(trip.id)
    const pending = ownerState.configured && ownerState.signedIn
      ? ownerState.mutations.filter((mutation) => mutation.mutationType === 'request_replan_undo' && mutation.status === 'pending')
      : []
    expect(pending).toHaveLength(1)
  })
})

async function seedTrip() {
  const trip = await createTrip({
    destination: '东京',
    endDate: '2026-04-03',
    startDate: '2026-04-01',
    title: '东京旅行',
  })
  const day = await createDay({
    date: '2026-04-01',
    sortOrder: 1,
    title: '第一天',
    tripId: trip.id,
  })
  const item = await createItineraryItem({
    dayId: day.id,
    sortOrder: 1,
    startTime: '09:00',
    ticketIds: [],
    title: '美术馆',
    tripId: trip.id,
  })
  await createTicketMeta({
    fileName: 'ticket.pdf',
    fileType: 'pdf',
    mimeType: 'application/pdf',
    size: 3,
    storageMode: 'copy',
    title: '美术馆门票',
    tripId: trip.id,
  })
  return { day, item, trip }
}

function setFixtureUser(id: string, email: string) {
  const current = JSON.parse(window.localStorage.getItem(fixtureKey) ?? '{}') as Record<string, unknown>
  window.localStorage.setItem(fixtureKey, JSON.stringify({
    ...current,
    user: { email, id },
  }))
}
