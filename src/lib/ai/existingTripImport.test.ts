import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDay, createItineraryItem, createTicketMeta, createTrip, listDaysByTrip, listItemsByTrip, listTicketsByTrip, getTicketBlob, updateTrip } from '../../db/repositories'
import { db } from '../../db/database'
import {
  applyExistingTripImportPreview,
  buildExistingTripImportBaselineFingerprint,
  buildExistingTripImportPreview,
  type ExistingTripImportProviderResult,
  type ExistingTripImportSourceSummary,
} from './existingTripImport'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const sources: ExistingTripImportSourceSummary[] = [{
  id: 'source:pasted-text',
  kind: 'pasted_text',
  label: '粘贴文本',
  text: '2026-04-01 10:00 西湖 门票',
}]

describe('existing trip import preview', () => {
  it('builds smart merge diffs for matching same-day items', async () => {
    const trip = await createTrip({ destination: '杭州', endDate: '2026-04-02', startDate: '2026-04-01', title: '杭州旅行' })
    const day = await createDay({ date: '2026-04-01', sortOrder: 1, title: 'Day 1', tripId: trip.id })
    const item = await createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: '西湖', tripId: trip.id })
    const currentTrip = (await db.trips.get(trip.id))!
    const result: ExistingTripImportProviderResult = {
      items: [{
        address: '杭州市西湖区',
        candidateId: 'i1',
        confidence: 'high',
        date: '2026-04-01',
        locationName: '西湖',
        note: '带好身份证。',
        sourceIds: ['source:pasted-text'],
        startTime: '10:00',
        title: '西湖',
      }],
    }

    const preview = buildExistingTripImportPreview({
      context: { days: [day], items: [item], trip: currentTrip },
      providerResult: result,
      sourceSummaries: sources,
    })

    expect(preview.diffs.map((diff) => diff.type)).toEqual(['merge_item_fields', 'append_item_note'])
    expect(preview.diffs[0]).toMatchObject({
      checked: true,
      data: { targetItemId: item.id },
      type: 'merge_item_fields',
    })
  })

  it('keeps out-of-range trip date extension unchecked', async () => {
    const trip = await createTrip({ destination: '杭州', endDate: '2026-04-02', startDate: '2026-04-01', title: '杭州旅行' })
    const day = await createDay({ date: '2026-04-01', sortOrder: 1, title: 'Day 1', tripId: trip.id })
    const currentTrip = (await db.trips.get(trip.id))!
    const result: ExistingTripImportProviderResult = {
      items: [{
        candidateId: 'i1',
        confidence: 'medium',
        date: '2026-04-03',
        title: '灵隐寺',
      }],
    }

    const preview = buildExistingTripImportPreview({
      context: { days: [day], items: [], trip: currentTrip },
      providerResult: result,
      sourceSummaries: sources,
    })

    const dateDiff = preview.diffs.find((diff) => diff.type === 'update_trip_dates')
    expect(dateDiff).toMatchObject({ checked: false })
    expect(preview.diffs.some((diff) => diff.type === 'create_day')).toBe(true)
    expect(preview.diffs.some((diff) => diff.type === 'create_item')).toBe(true)
  })

  it('builds existing-ticket merge and bind suggestions from ticket summaries', async () => {
    const trip = await createTrip({ destination: '杭州', endDate: '2026-04-02', startDate: '2026-04-01', title: '杭州旅行' })
    const day = await createDay({ date: '2026-04-01', sortOrder: 1, title: 'Day 1', tripId: trip.id })
    const item = await createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: '西湖', tripId: trip.id })
    const currentTrip = (await db.trips.get(trip.id))!
    const preview = buildExistingTripImportPreview({
      context: {
        days: [day],
        items: [item],
        ticketSummaries: [{
          summaryId: 'existing-ticket:1',
          ticketCategory: 'other',
          ticketId: 'ticket-existing',
          title: '未命名票据',
        }],
        trip: currentTrip,
      },
      providerResult: {
        tickets: [{
          candidateId: 't1',
          confidence: 'high',
          date: '2026-04-01',
          itemTitle: '西湖',
          sourceIds: ['source:pasted-text'],
          targetExistingTicketSummaryId: 'existing-ticket:1',
          ticketCategory: 'admission_ticket',
          title: '西湖门票',
        }],
      },
      sourceSummaries: sources,
    })

    expect(preview.diffs.map((diff) => diff.type)).toEqual(['merge_ticket_meta', 'bind_existing_ticket'])
    expect(preview.diffs[0]).toMatchObject({
      checked: true,
      data: {
        patch: { ticketCategory: 'admission_ticket', title: '西湖门票' },
        targetTicketId: 'ticket-existing',
      },
      type: 'merge_ticket_meta',
    })
    expect(preview.diffs[1]).toMatchObject({
      data: { targetItemId: item.id, targetTicketId: 'ticket-existing' },
      type: 'bind_existing_ticket',
    })
  })
})

describe('applyExistingTripImportPreview', () => {
  it('applies checked create day/item/ticket/note diffs in one transaction', async () => {
    const trip = await createTrip({ destination: '杭州', endDate: '2026-04-02', startDate: '2026-04-01', title: '杭州旅行' })
    const day = await createDay({ date: '2026-04-01', sortOrder: 1, title: 'Day 1', tripId: trip.id })
    const currentTrip = (await db.trips.get(trip.id))!
    const result: ExistingTripImportProviderResult = {
      items: [{
        candidateId: 'i1',
        confidence: 'high',
        date: '2026-04-01',
        locationName: '西湖',
        sourceIds: ['source:pasted-text'],
        startTime: '10:00',
        title: '西湖',
      }],
      notes: [{
        candidateId: 'n1',
        confidence: 'medium',
        sourceIds: ['source:pasted-text'],
        text: '订单提醒：提前到达。',
      }],
      tickets: [{
        candidateId: 't1',
        confidence: 'high',
        date: '2026-04-01',
        fileName: 'ticket.pdf',
        itemTitle: '西湖',
        sourceFileId: 'source:pasted-text',
        sourceIds: ['source:pasted-text'],
        ticketCategory: 'admission_ticket',
        title: '西湖门票',
      }],
    }
    const preview = buildExistingTripImportPreview({
      context: { days: [day], items: [], trip: currentTrip },
      providerResult: result,
      sourceSummaries: sources,
    })
    const file = new Blob(['pdf'], { type: 'application/pdf' })

    const applyResult = await applyExistingTripImportPreview({
      checkedDiffIds: new Set(preview.diffs.map((diff) => diff.id)),
      expectedBaselineFingerprint: preview.baselineFingerprint,
      filesBySourceId: new Map([['source:pasted-text', { blob: file, fileName: 'ticket.pdf', mimeType: 'application/pdf', size: file.size }]]),
      preview,
      tripId: trip.id,
    })

    expect(applyResult).toMatchObject({ ok: true })
    const items = await listItemsByTrip(trip.id)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ locationName: '西湖', startTime: '10:00', ticketIds: expect.any(Array) })
    expect(items[0].ticketIds).toHaveLength(1)
    const tickets = await listTicketsByTrip(trip.id)
    expect(tickets).toHaveLength(1)
    expect(tickets[0]).toMatchObject({ fileName: expect.stringContaining('ticket'), fileType: 'pdf', itemId: items[0].id, scope: 'item', storageMode: 'copy', ticketCategory: 'admission_ticket' })
    expect(applyResult.ok && applyResult.appliedChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'created', kind: 'item', title: '西湖' }),
      expect.objectContaining({ action: 'created', kind: 'ticket', title: '西湖门票' }),
    ]))
    await expect(getTicketBlob(tickets[0].id)).resolves.toMatchObject({ ticketId: tickets[0].id })
    await expect(db.syncOutbox.toArray()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'trip', tripId: trip.id }),
      expect.objectContaining({ objectType: 'item', tripId: trip.id }),
      expect.objectContaining({ objectType: 'ticket_meta', objectId: tickets[0].id, tripId: trip.id }),
    ]))
    await expect(db.ticketBlobSyncStates.get(tickets[0].id)).resolves.toMatchObject({
      cacheStatus: 'cached',
      ticketId: tickets[0].id,
      uploadStatus: 'pending',
    })
    const updatedTrip = await db.trips.get(trip.id)
    expect(updatedTrip?.notes).toContain('订单提醒')
  })

  it('updates and binds an existing ticket while returning applied changes', async () => {
    const trip = await createTrip({ destination: '杭州', endDate: '2026-04-01', startDate: '2026-04-01', title: '杭州旅行' })
    const day = await createDay({ date: '2026-04-01', sortOrder: 1, title: 'Day 1', tripId: trip.id })
    const item = await createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: '西湖', tripId: trip.id })
    const ticket = await createTicketMeta({
      fileName: 'scan.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 10,
      storageMode: 'reference',
      title: '未命名票据',
      tripId: trip.id,
    })
    const currentTrip = (await db.trips.get(trip.id))!
    const preview = buildExistingTripImportPreview({
      context: {
        days: [day],
        items: [item],
        ticketSummaries: [{
          summaryId: 'existing-ticket:1',
          ticketCategory: 'other',
          ticketId: ticket.id,
          title: ticket.title!,
        }],
        trip: currentTrip,
      },
      providerResult: {
        tickets: [{
          candidateId: 't1',
          confidence: 'high',
          date: '2026-04-01',
          itemTitle: '西湖',
          targetExistingTicketSummaryId: 'existing-ticket:1',
          ticketCategory: 'admission_ticket',
          title: '西湖门票',
        }],
      },
      sourceSummaries: sources,
    })

    const result = await applyExistingTripImportPreview({
      checkedDiffIds: new Set(preview.diffs.map((diff) => diff.id)),
      expectedBaselineFingerprint: preview.baselineFingerprint,
      preview,
      tripId: trip.id,
    })

    expect(result).toMatchObject({ ok: true })
    const updatedTicket = await db.ticketMetas.get(ticket.id)
    expect(updatedTicket).toMatchObject({
      itemId: item.id,
      scope: 'item',
      ticketCategory: 'admission_ticket',
      title: '西湖门票',
    })
    await expect(db.itineraryItems.get(item.id)).resolves.toMatchObject({ ticketIds: [ticket.id] })
    expect(result.ok && result.appliedChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'merged', kind: 'ticket', ticketId: ticket.id, title: '西湖门票' }),
      expect.objectContaining({ action: 'bound', itemId: item.id, kind: 'ticket', ticketId: ticket.id }),
    ]))
    await expect(db.syncOutbox.toArray()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'ticket_meta', objectId: ticket.id, tripId: trip.id }),
    ]))
  })

  it('keeps legacy previews without ticket summaries applyable when tickets already exist', async () => {
    const trip = await createTrip({ destination: '杭州', endDate: '2026-04-01', startDate: '2026-04-01', title: '杭州旅行' })
    const day = await createDay({ date: '2026-04-01', sortOrder: 1, title: 'Day 1', tripId: trip.id })
    await createTicketMeta({
      fileName: 'hotel.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 10,
      storageMode: 'reference',
      title: '酒店订单',
      tripId: trip.id,
    })
    const currentTrip = (await db.trips.get(trip.id))!
    const preview = buildExistingTripImportPreview({
      context: { days: [day], items: [], trip: currentTrip },
      providerResult: {
        items: [{
          candidateId: 'i1',
          confidence: 'high',
          date: '2026-04-01',
          sourceIds: ['source:pasted-text'],
          startTime: '10:00',
          title: '西湖',
        }],
      },
      sourceSummaries: sources,
    })

    const result = await applyExistingTripImportPreview({
      checkedDiffIds: new Set(preview.diffs.map((diff) => diff.id)),
      expectedBaselineFingerprint: preview.baselineFingerprint,
      preview,
      tripId: trip.id,
    })

    expect(result).toMatchObject({ ok: true })
    await expect(listItemsByTrip(trip.id)).resolves.toEqual([expect.objectContaining({ title: '西湖' })])
  })

  it('applies only checked diffs', async () => {
    const trip = await createTrip({ destination: '杭州', endDate: '2026-04-01', startDate: '2026-04-01', title: '杭州旅行' })
    const day = await createDay({ date: '2026-04-01', sortOrder: 1, title: 'Day 1', tripId: trip.id })
    const currentTrip = (await db.trips.get(trip.id))!
    const result: ExistingTripImportProviderResult = {
      items: [
        { candidateId: 'i1', confidence: 'high', date: '2026-04-01', title: '西湖' },
        { candidateId: 'i2', confidence: 'high', date: '2026-04-01', title: '灵隐寺' },
      ],
    }
    const preview = buildExistingTripImportPreview({
      context: { days: [day], items: [], trip: currentTrip },
      providerResult: result,
      sourceSummaries: sources,
    })
    const firstCreate = preview.diffs.find((diff) => diff.id === 'create-item:i1')
    expect(firstCreate).toBeTruthy()

    await applyExistingTripImportPreview({
      checkedDiffIds: new Set([firstCreate!.id]),
      expectedBaselineFingerprint: preview.baselineFingerprint,
      preview,
      tripId: trip.id,
    })

    const items = await listItemsByTrip(trip.id)
    expect(items.map((item) => item.title)).toEqual(['西湖'])
  })

  it('rejects stale baseline before writing', async () => {
    const trip = await createTrip({ destination: '杭州', endDate: '2026-04-01', startDate: '2026-04-01', title: '杭州旅行' })
    const day = await createDay({ date: '2026-04-01', sortOrder: 1, title: 'Day 1', tripId: trip.id })
    const currentTrip = (await db.trips.get(trip.id))!
    const preview = buildExistingTripImportPreview({
      context: { days: [day], items: [], trip: currentTrip },
      providerResult: {
        items: [{ candidateId: 'i1', confidence: 'high', date: '2026-04-01', title: '西湖' }],
      },
      sourceSummaries: sources,
    })
    await updateTrip(trip.id, { title: '杭州旅行 updated' })

    const result = await applyExistingTripImportPreview({
      checkedDiffIds: new Set(preview.diffs.map((diff) => diff.id)),
      expectedBaselineFingerprint: preview.baselineFingerprint,
      preview,
      tripId: trip.id,
    })

    expect(result).toMatchObject({ ok: false })
    await expect(listItemsByTrip(trip.id)).resolves.toHaveLength(0)
  })

  it('rolls back atomically when checked create item lacks a created day', async () => {
    const trip = await createTrip({ destination: '杭州', endDate: '2026-04-01', startDate: '2026-04-01', title: '杭州旅行' })
    const day = await createDay({ date: '2026-04-01', sortOrder: 1, title: 'Day 1', tripId: trip.id })
    const currentTrip = (await db.trips.get(trip.id))!
    const preview = buildExistingTripImportPreview({
      context: { days: [day], items: [], trip: currentTrip },
      providerResult: {
        items: [{ candidateId: 'i1', confidence: 'high', date: '2026-04-02', title: '西溪湿地' }],
      },
      sourceSummaries: sources,
    })
    const createItem = preview.diffs.find((diff) => diff.type === 'create_item')
    expect(createItem).toBeTruthy()

    const result = await applyExistingTripImportPreview({
      checkedDiffIds: new Set([createItem!.id]),
      expectedBaselineFingerprint: preview.baselineFingerprint,
      preview,
      tripId: trip.id,
    })

    expect(result).toMatchObject({ ok: false })
    await expect(listDaysByTrip(trip.id)).resolves.toHaveLength(1)
    await expect(listItemsByTrip(trip.id)).resolves.toHaveLength(0)
  })

  it('builds a stable baseline fingerprint from current state', async () => {
    const trip = await createTrip({ destination: '杭州', endDate: '2026-04-01', startDate: '2026-04-01', title: '杭州旅行' })
    const day = await createDay({ date: '2026-04-01', sortOrder: 1, title: 'Day 1', tripId: trip.id })
    const currentTrip = (await db.trips.get(trip.id))!

    expect(buildExistingTripImportBaselineFingerprint({ days: [day], items: [], trip: currentTrip })).toContain(trip.id)
  })
})
