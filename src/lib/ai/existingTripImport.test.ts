import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDay, createItineraryItem, createTrip, listDaysByTrip, listItemsByTrip, listTicketsByTrip, getTicketBlob, updateTrip } from '../../db/repositories'
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
    expect(tickets[0]).toMatchObject({ fileName: expect.stringContaining('ticket'), fileType: 'pdf', itemId: items[0].id, scope: 'item', storageMode: 'copy' })
    await expect(getTicketBlob(tickets[0].id)).resolves.toMatchObject({ ticketId: tickets[0].id })
    const updatedTrip = await db.trips.get(trip.id)
    expect(updatedTrip?.notes).toContain('订单提醒')
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
