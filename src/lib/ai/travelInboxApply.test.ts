import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTravelInboxPreviewRecord } from './travelInboxApply'
import type { TravelInboxPreviewRecord } from '../../types'

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  buildFiles: vi.fn(),
  completeSource: vi.fn(),
  deleteEntries: vi.fn(),
}))

vi.mock('./existingTripImport', () => ({
  applyExistingTripImportPreview: mocks.apply,
}))

vi.mock('./travelInbox', () => ({
  buildTravelInboxApplyFiles: mocks.buildFiles,
  deleteTravelInboxEntries: mocks.deleteEntries,
}))

vi.mock('./travelInboxOrganization', () => ({
  completeTravelInboxAccountSource: mocks.completeSource,
}))

describe('applyTravelInboxPreviewRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.buildFiles.mockResolvedValue(new Map())
  })

  it('reuses the preview baseline, checked diffs, source completion, and entry cleanup flow', async () => {
    const appliedChanges = [{ action: 'merged', id: 'change_1', itemId: 'item_1', kind: 'item', title: '西湖' }]
    mocks.apply.mockResolvedValue({ appliedChanges, appliedCount: 1, ok: true })
    const result = await applyTravelInboxPreviewRecord({ record })

    expect(result.ok).toBe(true)
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      checkedDiffIds: new Set(['diff_1']),
      expectedBaselineFingerprint: 'baseline',
      tripId: 'trip_1',
    }))
    expect(mocks.completeSource).toHaveBeenCalledWith('cloud_1', appliedChanges)
    expect(mocks.deleteEntries).toHaveBeenCalledWith(['entry_1'])
  })

  it('does not clean sources or entries when baseline validation blocks the write', async () => {
    mocks.apply.mockResolvedValue({ errors: ['本地行程已变化'], ok: false })
    const result = await applyTravelInboxPreviewRecord({ record })
    expect(result).toEqual({ errors: ['本地行程已变化'], ok: false })
    expect(mocks.completeSource).not.toHaveBeenCalled()
    expect(mocks.deleteEntries).not.toHaveBeenCalled()
  })
})

const record: TravelInboxPreviewRecord = {
  checkedDiffIds: ['diff_1'],
  cloudSourceId: 'cloud_1',
  createdAt: 1,
  entryIds: ['entry_1'],
  id: 'preview_1',
  preview: {
    baselineFingerprint: 'baseline',
    diffs: [],
    generatedAt: '2026-06-10T00:00:00.000Z',
    sourceSummaries: [],
    warnings: [],
  },
  status: 'ready',
  tripId: 'trip_1',
  updatedAt: 1,
}
