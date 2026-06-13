import {
  applyExistingTripImportPreview,
  type ExistingTripImportApplyResult,
  type ExistingTripImportPreview,
} from './existingTripImport'
import { buildTravelInboxApplyFiles, deleteTravelInboxEntries } from './travelInbox'
import { completeTravelInboxAccountSource } from './travelInboxOrganization'
import type { TravelInboxPreviewRecord } from '../../types'

export async function applyTravelInboxPreviewRecord({
  checkedDiffIds,
  record,
}: {
  checkedDiffIds?: string[]
  record: TravelInboxPreviewRecord
}): Promise<ExistingTripImportApplyResult> {
  const preview = record.preview as ExistingTripImportPreview
  const filesBySourceId = await buildTravelInboxApplyFiles(record.entryIds)
  const result = await applyExistingTripImportPreview({
    checkedDiffIds: new Set(checkedDiffIds ?? record.checkedDiffIds),
    expectedBaselineFingerprint: preview.baselineFingerprint,
    filesBySourceId,
    preview,
    tripId: record.tripId,
  })
  if (!result.ok || result.appliedCount === 0) return result

  if (record.cloudSourceId) {
    await completeTravelInboxAccountSource(record.cloudSourceId, result.appliedChanges)
  }
  await deleteTravelInboxEntries(record.entryIds)
  return result
}
