import { buildAiTripEditContext } from './aiTripEditContext'
import { buildAiTripEditLocalStateFingerprint } from './aiTripEditApply'
import { getStoredAiPrivacySettings } from './aiPrivacy'
import type { Day, ItineraryItem, Trip } from '../../types'

export function prepareAiTripEditExecution({
  days,
  items,
  trip,
}: {
  days: Day[]
  items: ItineraryItem[]
  trip: Trip
}) {
  const contextResult = buildAiTripEditContext({
    days,
    items,
    privacy: getStoredAiPrivacySettings(),
    trip,
  })
  if (!contextResult.ok) return contextResult
  return {
    baselineFingerprint: buildAiTripEditLocalStateFingerprint({ days, items, trip }),
    context: contextResult.context,
    ok: true as const,
    warnings: contextResult.warnings,
  }
}
