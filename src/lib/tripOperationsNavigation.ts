import type { TripOperationsRecommendation } from './tripOperationsAgent'
import { navigateTo } from './routes'

export function navigateToTripOperationsRecommendation(
  recommendation: TripOperationsRecommendation,
  tripId: string,
) {
  if (recommendation.actionKind === 'open_item' && recommendation.itemId && recommendation.dayId) {
    navigateTo('item', { dayId: recommendation.dayId, itemId: recommendation.itemId, tripId })
    return
  }
  if (recommendation.actionKind === 'open_tickets') {
    navigateTo('tickets', recommendation.itemId ? { itemId: recommendation.itemId, tripId } : { tripId })
    return
  }
  if ((recommendation.actionKind === 'open_day' || recommendation.actionKind === 'review_tomorrow' || recommendation.actionKind === 'generate_ai_patch') && recommendation.dayId) {
    navigateTo('day', { dayId: recommendation.dayId, tripId, view: 'schedule' })
    return
  }
  if (recommendation.actionKind === 'open_inbox' || recommendation.actionKind === 'apply_inbox_preview') {
    document.getElementById('trip-travel-inbox-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  if (recommendation.actionKind === 'open_sync') {
    document.getElementById('trip-sync-archive-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  if (recommendation.actionKind === 'open_route_panel') {
    document.getElementById('route-preparation-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  if (recommendation.actionKind === 'open_content_enrichment') {
    document.getElementById('trip-content-enrichment-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  document.getElementById('trip-readiness-center-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
