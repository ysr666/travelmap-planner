// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildAssignedTicketSummariesForMember,
  addSharedTripComment,
  buildSharedTripProjection,
  canCompanionCollaborate,
  canCompanionComment,
  claimSharedTripInvite,
  createSharedTripInvite,
  getCompanionPermissionRank,
  loadCompanionSharedTrip,
  loadOwnerSharedTripState,
  normalizeTicketSharedVisibility,
  openSharedTripTicketFile,
  publishSharedTripFromLocal,
  removeSharedTripMember,
  submitSharedTripMutation,
  syncSharedTripForOwner,
  updateSharedTripMemberProfile,
} from './companion'
import { createDay, createItineraryItem, createTicketMeta, createTrip, getItineraryItem, listTripDisruptionEventsByTrip, saveTicketBlob, updateItineraryItem, updateTicketMeta } from '../db'
import { db } from '../db/database'
import type { ItineraryItem } from '../types'

const fixtureKey = 'tripmap:e2e:cloud-fixture'

beforeEach(async () => {
  window.localStorage.clear()
  await db.delete()
  await db.open()
})

describe('companion permissions', () => {
  it('keeps an explicit empty assigned ticket visibility as shared with nobody', () => {
    expect(normalizeTicketSharedVisibility({ memberIds: [], mode: 'assigned' })).toEqual({
      memberIds: [],
      mode: 'assigned',
    })
    expect(normalizeTicketSharedVisibility(undefined)).toEqual({ mode: 'all' })
  })

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

  it('does not expose fallback ticket text or member-assigned summaries in the global projection', () => {
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
      createdAt: 1,
      dayId: day.id,
      id: 'item_1',
      sortOrder: 1,
      ticketIds: ['ticket_public', 'ticket_juan'],
      title: '集合',
      tripId: trip.id,
      updatedAt: 1,
    }
    const tickets = [{
      createdAt: 1,
      externalUrl: 'https://tickets.example/order-secret',
      fileName: 'secret-public-ticket.pdf',
      fileType: 'pdf' as const,
      id: 'ticket_public',
      mimeType: 'application/pdf',
      note: 'PUBLIC-PNR-112233',
      size: 123,
      storageMode: 'external' as const,
      ticketCategory: 'train_ticket' as const,
      tripId: trip.id,
      updatedAt: 1,
    }, {
      createdAt: 2,
      fileName: 'juan-private-ticket.pdf',
      fileType: 'pdf' as const,
      id: 'ticket_juan',
      itemId: item.id,
      mimeType: 'application/pdf',
      sharedVisibility: { memberIds: ['member_juan'], mode: 'assigned' as const },
      size: 456,
      storageMode: 'copy' as const,
      ticketCategory: 'flight_ticket' as const,
      title: 'JUAN 专属机票',
      tripId: trip.id,
      updatedAt: 2,
    }]

    const projection = buildSharedTripProjection({ days: [day], items: [item], tickets, trip })

    expect(projection.ticketSummaries).toHaveLength(1)
    expect(projection.ticketSummaries[0]).toMatchObject({ id: 'ticket_public', title: '火车票' })
    expect(projection.items[0].ticketSummaryIds).toEqual(['ticket_public'])
    expect(JSON.stringify(projection)).not.toContain('secret-public-ticket.pdf')
    expect(JSON.stringify(projection)).not.toContain('https://tickets.example/order-secret')
    expect(JSON.stringify(projection)).not.toContain('PUBLIC-PNR-112233')
    expect(JSON.stringify(projection)).not.toContain('JUAN 专属机票')
    expect(buildAssignedTicketSummariesForMember(tickets, 'member_juan')).toEqual([
      expect.objectContaining({ id: 'ticket_juan', itemId: item.id, title: 'JUAN 专属机票' }),
    ])
    expect(buildAssignedTicketSummariesForMember(tickets, 'member_dongjun')).toEqual([])
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

  it('keeps member profiles and assigned ticket summaries scoped to the selected companion', async () => {
    const { item, trip } = await seedTrip()
    const assignedTicket = await createTicketMeta({
      fileName: 'juan-ticket.pdf',
      fileType: 'pdf',
      itemId: item.id,
      mimeType: 'application/pdf',
      scope: 'item',
      size: 3,
      storageMode: 'copy',
      ticketCategory: 'flight_ticket',
      title: 'JUAN 机票',
      tripId: trip.id,
    })
    await saveTicketBlob(assignedTicket.id, new Blob(['JUAN-PDF'], { type: 'application/pdf' }))
    await updateItineraryItem(item.id, { ticketIds: [assignedTicket.id] })

    setFixtureUser('owner_1', 'owner@example.com')
    const { sharedTrip } = await publishSharedTripFromLocal(trip.id)
    const invite = await createSharedTripInvite({ permission: 'read', sharedTripId: sharedTrip.id })

    setFixtureUser('member_juan', 'juan@example.com')
    await claimSharedTripInvite(invite.token, 'JUAN')
    setFixtureUser('member_dongjun', 'dongjun@example.com')
    await claimSharedTripInvite(invite.token, 'DONGJUN')

    setFixtureUser('owner_1', 'owner@example.com')
    await updateSharedTripMemberProfile(sharedTrip.id, 'member_juan', {
      birthday: '1990-01-02',
      emergencyContact: '妈妈 13800000000',
      passport: '护照已核对',
      room: '1208',
      seat: '12A',
      visa: '签证已确认',
    })
    await updateTicketMeta(assignedTicket.id, {
      itemId: item.id,
      scope: 'item',
      sharedVisibility: { memberIds: ['member_juan'], mode: 'assigned' },
      ticketCategory: 'flight_ticket',
      title: 'JUAN 机票',
    })
    await publishSharedTripFromLocal(trip.id)

    setFixtureUser('member_juan', 'juan@example.com')
    const juanBundle = await loadCompanionSharedTrip(sharedTrip.id)
    expect(juanBundle.member?.profile).toMatchObject({ birthday: '1990-01-02', passport: '护照已核对', seat: '12A' })
    expect(juanBundle.sharedTrip.projection.ticketSummaries).toContainEqual(
      expect.objectContaining({ id: assignedTicket.id, title: 'JUAN 机票' }),
    )
    expect(juanBundle.sharedTrip.projection.items[0].ticketSummaryIds).toEqual([assignedTicket.id])
    const juanFile = await openSharedTripTicketFile(sharedTrip.id, assignedTicket.id)
    expect(juanFile).toMatchObject({
      fileName: 'juan-ticket.pdf',
      mimeType: 'application/pdf',
      ticketId: assignedTicket.id,
      title: 'JUAN 机票',
    })
    expect(juanFile.blob).toBeTruthy()

    setFixtureUser('member_dongjun', 'dongjun@example.com')
    const dongjunBundle = await loadCompanionSharedTrip(sharedTrip.id)
    expect(JSON.stringify(dongjunBundle.sharedTrip.projection)).not.toContain('JUAN 机票')
    expect(dongjunBundle.sharedTrip.projection.ticketSummaries).not.toContainEqual(
      expect.objectContaining({ id: assignedTicket.id }),
    )
    expect(dongjunBundle.sharedTrip.projection.items[0].ticketSummaryIds).toEqual([])
    await expect(openSharedTripTicketFile(sharedTrip.id, assignedTicket.id)).rejects.toThrow('没有权限查看这张票据原件')

    setFixtureUser('owner_1', 'owner@example.com')
    const ownerState = await loadOwnerSharedTripState(trip.id)
    const juanMember = ownerState.configured && ownerState.signedIn
      ? ownerState.members.find((member) => member.userId === 'member_juan')
      : null
    expect(juanMember?.profile).toMatchObject({ room: '1208', visa: '签证已确认' })
    expect(juanMember?.assignedTicketSummaries).toEqual([
      expect.objectContaining({ id: assignedTicket.id, title: 'JUAN 机票' }),
    ])
    expect(ownerState.configured && ownerState.signedIn ? ownerState.ticketFileEvents : []).toContainEqual(
      expect.objectContaining({
        eventType: 'file_opened',
        fileName: 'juan-ticket.pdf',
        ticketId: assignedTicket.id,
        userId: 'member_juan',
      }),
    )
  })

  it('treats an empty assigned ticket visibility as not visible to any companion', async () => {
    const { item, trip } = await seedTrip()
    const privateTicket = await createTicketMeta({
      fileName: 'private-ticket.pdf',
      fileType: 'pdf',
      itemId: item.id,
      mimeType: 'application/pdf',
      scope: 'item',
      size: 3,
      storageMode: 'copy',
      ticketCategory: 'flight_ticket',
      title: '暂不共享票据',
      tripId: trip.id,
    })
    await saveTicketBlob(privateTicket.id, new Blob(['PRIVATE-PDF'], { type: 'application/pdf' }))
    await updateItineraryItem(item.id, { ticketIds: [privateTicket.id] })

    setFixtureUser('owner_1', 'owner@example.com')
    const { sharedTrip } = await publishSharedTripFromLocal(trip.id)
    const invite = await createSharedTripInvite({ permission: 'read', sharedTripId: sharedTrip.id })

    setFixtureUser('member_juan', 'juan@example.com')
    await claimSharedTripInvite(invite.token, 'JUAN')

    setFixtureUser('owner_1', 'owner@example.com')
    await updateTicketMeta(privateTicket.id, {
      itemId: item.id,
      scope: 'item',
      sharedVisibility: { memberIds: [], mode: 'assigned' },
      ticketCategory: 'flight_ticket',
      title: '暂不共享票据',
    })
    await publishSharedTripFromLocal(trip.id)

    setFixtureUser('member_juan', 'juan@example.com')
    const bundle = await loadCompanionSharedTrip(sharedTrip.id)
    expect(JSON.stringify(bundle.sharedTrip.projection)).not.toContain('暂不共享票据')
    expect(bundle.sharedTrip.projection.ticketSummaries).not.toContainEqual(
      expect.objectContaining({ id: privateTicket.id }),
    )
    expect(bundle.sharedTrip.projection.items[0].ticketSummaryIds).toEqual([])
    await expect(openSharedTripTicketFile(sharedTrip.id, privateTicket.id)).rejects.toThrow('没有权限查看这张票据原件')
  })

  it('records ticket original grant revocation when the owner removes a member', async () => {
    const { trip } = await seedTrip()
    const publicTicket = await createTicketMeta({
      fileName: 'shared-ticket.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 3,
      storageMode: 'copy',
      ticketCategory: 'flight_ticket',
      title: '共享机票',
      tripId: trip.id,
    })
    await saveTicketBlob(publicTicket.id, new Blob(['SHARED-PDF'], { type: 'application/pdf' }))

    setFixtureUser('owner_1', 'owner@example.com')
    const { sharedTrip } = await publishSharedTripFromLocal(trip.id)
    const invite = await createSharedTripInvite({ permission: 'read', sharedTripId: sharedTrip.id })

    setFixtureUser('member_juan', 'juan@example.com')
    await claimSharedTripInvite(invite.token, 'JUAN')

    setFixtureUser('owner_1', 'owner@example.com')
    await publishSharedTripFromLocal(trip.id)
    await removeSharedTripMember(sharedTrip.id, 'member_juan')

    const ownerState = await loadOwnerSharedTripState(trip.id)
    const events = ownerState.configured && ownerState.signedIn ? ownerState.ticketFileEvents : []
    expect(events).toContainEqual(
      expect.objectContaining({
        eventType: 'grant_synced',
        fileName: 'shared-ticket.pdf',
        ticketId: publicTicket.id,
        userId: 'member_juan',
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        eventType: 'grant_revoked',
        fileName: 'shared-ticket.pdf',
        ticketId: publicTicket.id,
        userId: 'member_juan',
      }),
    )
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
    await expect(syncSharedTripForOwner(trip.id)).resolves.toMatchObject({ applied: 1, conflicts: 0, pendingReview: 0, published: true })
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
    await expect(syncSharedTripForOwner(trip.id)).resolves.toMatchObject({ applied: 1, conflicts: 0, pendingReview: 0, published: true })
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
    await expect(syncSharedTripForOwner(trip.id)).resolves.toMatchObject({ applied: 0, conflicts: 0, pendingReview: 1, published: true })
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
