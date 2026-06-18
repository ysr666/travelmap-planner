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
    if (scrollToTripElement('trip-travel-inbox-panel')) return
    navigateTo('inbox')
    return
  }
  if (recommendation.actionKind === 'open_sync') {
    if (scrollToTripElement('trip-sync-archive-section')) return
    navigateTo('settings', { section: 'cloud' })
    return
  }
  if (recommendation.actionKind === 'open_route_panel') {
    scrollToTripElement('route-preparation-panel')
    return
  }
  if (recommendation.actionKind === 'open_content_enrichment') {
    scrollToTripElement('trip-content-enrichment-panel')
    return
  }
  if (recommendation.actionKind === 'open_adaptive_replan') {
    scrollToTripElement('trip-live-mode-card')
    return
  }
  scrollToTripElement('trip-readiness-center-panel')
}

function scrollToTripElement(id: string) {
  const element = document.getElementById(id)
  if (!element) return false
  const details = element.closest('details') as HTMLDetailsElement | null
  if (details) details.open = true
  window.requestAnimationFrame(() => {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  return true
}
