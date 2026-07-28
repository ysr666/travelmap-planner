import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/database'
import { createTrip } from '../../db/repositories'
import {
  isDeterministicTripMatch,
  processTravelInboxAccountSourceBatch,
} from './travelInboxOrganization'
import type { TravelInboxAccountSource, Trip } from '../../types'

const mocks = vi.hoisted(() => ({
  classify: vi.fn(),
  extract: vi.fn(),
  import: vi.fn(),
}))

vi.mock('../providerProxyClient', () => ({
  fetchProviderProxyExistingTripImport: mocks.import,
  fetchProviderProxyTravelInboxClassify: mocks.classify,
  getProviderProxyConfig: () => ({ proxyUrl: '/api/provider-proxy' }),
}))

vi.mock('../travelInboxMime', () => ({
  extractTravelInboxBlob: mocks.extract,
}))

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.extract.mockImplementation(async ({
    blob,
    fileName,
    mimeType,
  }: {
    blob: Blob
    fileName: string
    mimeType: string
  }) => ({
    filesBySourceId: new Map(),
    sources: [{
      fileName,
      id: 'source:file:1',
      kind: 'text_file',
      label: fileName,
      mimeType,
      size: blob.size,
      text: await blob.text(),
    }],
    warnings: [],
  }))
  mocks.import.mockImplementation(async (request: { sources: Array<{ id: string }> }) => ({
    result: {
      tickets: [{
        candidateId: 'ticket-1',
        sourceIds: request.sources[0] ? [request.sources[0].id] : [],
        title: `批次票据 ${request.sources.length}`,
      }],
    },
    warnings: [],
  }))
  await db.delete()
  await db.open()
})

const trip: Trip = {
  createdAt: 1,
  destination: '东京',
  endDate: '2026-07-12',
  id: 'trip-tokyo',
  startDate: '2026-07-10',
  title: '东京旅行',
  updatedAt: 1,
}

describe('travel inbox automatic organization gate', () => {
  it('requires a deterministic title, destination, or overlapping date match', () => {
    expect(isDeterministicTripMatch('东京旅行酒店确认', trip)).toBe(true)
    expect(isDeterministicTripMatch('Hotel in 东京', trip)).toBe(true)
    expect(isDeterministicTripMatch('Check-in 2026-07-11', trip)).toBe(true)
    expect(isDeterministicTripMatch('大阪 2026-08-01 rail pass', trip)).toBe(false)
  })

  it('turns 61 assigned files into one preview with two bounded provider requests', async () => {
    const targetTrip = await createTargetTrip()
    const sources = await seedAccountSources(61)

    const result = await processTravelInboxAccountSourceBatch(
      sources.map((source) => source.id),
      targetTrip.id,
      'test-claimant',
    )

    expect(result).toEqual({
      failedCount: 0,
      needsAssignmentCount: 0,
      previewCount: 1,
      processedCount: 61,
    })
    expect(mocks.classify).not.toHaveBeenCalled()
    expect(mocks.import).toHaveBeenCalledTimes(2)
    expect(mocks.import.mock.calls.map((call) =>
      (call[0] as { sources: unknown[] }).sources.length,
    )).toEqual([60, 1])
    const preview = await db.travelInboxPreviews.where('tripId').equals(targetTrip.id).first()
    expect(preview?.accountSourceRefs).toHaveLength(61)
    expect(preview?.entryIds).toHaveLength(61)
    expect((preview?.preview as { diffs: Array<{ id: string }> }).diffs.map((diff) => diff.id)).toEqual([
      'create-ticket:batch-1:ticket-1',
      'create-ticket:batch-2:ticket-1',
    ])
    expect(await db.travelInboxAccountSources.where('status').equals('preview_ready').count()).toBe(61)
  })

  it('removes temporary inbox entries when the second provider request fails', async () => {
    const targetTrip = await createTargetTrip()
    const sources = await seedAccountSources(61)
    mocks.import
      .mockResolvedValueOnce({ result: {}, warnings: [] })
      .mockRejectedValueOnce(new Error('provider unavailable'))

    const result = await processTravelInboxAccountSourceBatch(
      sources.map((source) => source.id),
      targetTrip.id,
      'test-claimant',
    )

    expect(result).toEqual({
      failedCount: 61,
      needsAssignmentCount: 0,
      previewCount: 0,
      processedCount: 61,
    })
    expect(mocks.import).toHaveBeenCalledTimes(2)
    expect(await db.travelInboxEntries.count()).toBe(0)
    expect(await db.travelInboxPreviews.count()).toBe(0)
    expect(await db.travelInboxAccountSources.where('status').equals('error').count()).toBe(61)
  })
})

function createTargetTrip() {
  return createTrip({
    destination: '英国',
    endDate: '2026-07-21',
    startDate: '2026-07-10',
    title: '英国12天家庭旅行',
  })
}

async function seedAccountSources(count: number) {
  const sources = Array.from({ length: count }, (_, index): TravelInboxAccountSource => ({
    connectorId: 'local-folder-1',
    connectorKind: 'local_folder',
    createdAt: index + 1,
    fileName: `ticket-${index + 1}.txt`,
    id: `source-${index + 1}`,
    label: `ticket-${index + 1}.txt`,
    mimeType: 'text/plain',
    receivedAt: index + 1,
    size: 20,
    sourceKind: 'text_file',
    status: 'needs_assignment',
    updatedAt: index + 1,
    warnings: [],
  }))
  await db.travelInboxAccountSources.bulkAdd(sources)
  await db.travelInboxAccountSourceBlobs.bulkAdd(sources.map((source) => ({
    blob: new Blob([`${source.fileName} 2026-07-11`], { type: 'text/plain' }),
    sourceId: source.id,
  })))
  return sources
}
