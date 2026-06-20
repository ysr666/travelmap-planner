import { lazy, Suspense, useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { AutoSnapshotBackupController } from './components/cloud/AutoSnapshotBackupController'
import { StartupCloudSnapshotCheckController } from './components/cloud/StartupCloudSnapshotCheckController'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Card } from './components/ui/Card'
import { getTrip } from './db'
import { subscribeTravelDataChanged } from './lib/dataEvents'
import {
  clearTripNavigationContext,
  getTripNavigationTarget,
  readTripNavigationContext,
  recordTripNavigationContext,
} from './lib/navigationContext'
import { getCanonicalHashRedirect, routeFromHash } from './lib/routes'
import type { RouteId } from './types'
import { HomePage } from './pages/HomePage'

const DEFAULT_SHELL_TITLE = '旅图'

const TripWorkspacePage = lazy(() =>
  import('./pages/TripWorkspacePage').then((module) => ({ default: module.TripWorkspacePage })),
)
const DayViewPage = lazy(() =>
  import('./pages/DayViewPage').then((module) => ({ default: module.DayViewPage })),
)
const ItemDetailPage = lazy(() =>
  import('./pages/ItemDetailPage').then((module) => ({ default: module.ItemDetailPage })),
)
const TicketLibraryPage = lazy(() =>
  import('./pages/TicketLibraryPage').then((module) => ({ default: module.TicketLibraryPage })),
)
const TravelDocumentCenterPage = lazy(() =>
  import('./pages/TravelDocumentCenterPage').then((module) => ({ default: module.TravelDocumentCenterPage })),
)
const SharedTripPage = lazy(() =>
  import('./pages/SharedTripPage').then((module) => ({ default: module.SharedTripPage })),
)
const LedgerPage = lazy(() =>
  import('./pages/LedgerPage').then((module) => ({ default: module.LedgerPage })),
)
const LedgerExpenseDetailPage = lazy(() =>
  import('./pages/LedgerExpenseDetailPage').then((module) => ({ default: module.LedgerExpenseDetailPage })),
)
const TravelInboxPage = lazy(() =>
  import('./pages/TravelInboxPage').then((module) => ({ default: module.TravelInboxPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)
const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((module) => ({ default: module.SearchPage })),
)
const TripFormPage = lazy(() =>
  import('./pages/TripFormPage').then((module) => ({ default: module.TripFormPage })),
)
const ItemFormPage = lazy(() =>
  import('./pages/ItemFormPage').then((module) => ({ default: module.ItemFormPage })),
)
const AiDraftPage = lazy(() =>
  import('./pages/AiDraftPage').then((module) => ({ default: module.AiDraftPage })),
)
const SettingsPrivacyPage = lazy(() =>
  import('./pages/SettingsPrivacyPage').then((module) => ({ default: module.SettingsPrivacyPage })),
)
const SettingsMapsPage = lazy(() =>
  import('./pages/SettingsMapsPage').then((module) => ({ default: module.SettingsMapsPage })),
)
const SettingsRoutePage = lazy(() =>
  import('./pages/SettingsRoutePage').then((module) => ({ default: module.SettingsRoutePage })),
)

function App() {
  const [currentHash, setCurrentHash] = useState(() => window.location.hash)
  const [shellTitle, setShellTitle] = useState(DEFAULT_SHELL_TITLE)
  const [lastTripId, setLastTripId] = useState(() => readTripNavigationContext()?.tripId ?? null)
  const activeRoute: RouteId = routeFromHash(currentHash)

  useEffect(() => {
    const syncRoute = () => {
      const redirect = getCanonicalHashRedirect(window.location.hash)
      if (redirect && redirect !== window.location.hash) {
        window.location.replace(redirect)
        return
      }
      setCurrentHash(window.location.hash)
    }
    window.addEventListener('hashchange', syncRoute)

    if (!window.location.hash) {
      window.location.hash = '/home'
    } else {
      syncRoute()
    }

    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function refreshTripContext() {
      const routeTarget = getTripNavigationTarget(currentHash)
      const storedContext = readTripNavigationContext()
      const candidateTripId = routeTarget?.tripId ?? storedContext?.tripId
      if (!candidateTripId) {
        if (!cancelled) {
          setLastTripId(null)
          setShellTitle(DEFAULT_SHELL_TITLE)
        }
        return
      }

      try {
        const trip = await getTrip(candidateTripId)
        if (cancelled) return
        if (!trip) {
          if (storedContext?.tripId === candidateTripId) clearTripNavigationContext()
          setLastTripId(null)
          setShellTitle(DEFAULT_SHELL_TITLE)
          return
        }

        setLastTripId(trip.id)
        setShellTitle(routeTarget ? trip.title || DEFAULT_SHELL_TITLE : DEFAULT_SHELL_TITLE)
        if (routeTarget) recordTripNavigationContext(routeTarget)
      } catch {
        if (!cancelled) {
          setShellTitle(DEFAULT_SHELL_TITLE)
        }
      }
    }

    void refreshTripContext()
    const unsubscribe = subscribeTravelDataChanged(() => void refreshTripContext())
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeRoute, currentHash])

  return (
    <AppShell activeRoute={activeRoute} lastTripId={lastTripId} title={shellTitle}>
      <AutoSnapshotBackupController />
      <StartupCloudSnapshotCheckController />
      {activeRoute === 'home' ? <HomePage /> : null}
      {activeRoute !== 'home' ? (
        <ErrorBoundary key={activeRoute}>
          <Suspense fallback={<RouteLoading />}>
            {activeRoute === 'trip' ? <TripWorkspacePage /> : null}
            {activeRoute === 'day' ? <DayViewPage /> : null}
            {activeRoute === 'item' ? <ItemDetailPage /> : null}
            {activeRoute === 'trip/new' || activeRoute === 'trip/edit' ? <TripFormPage /> : null}
            {activeRoute === 'item/new' || activeRoute === 'item/edit' ? <ItemFormPage /> : null}
            {activeRoute === 'tickets' ? <TicketLibraryPage /> : null}
            {activeRoute === 'documents' ? <TravelDocumentCenterPage /> : null}
            {activeRoute === 'ledger' ? <LedgerPage /> : null}
            {activeRoute === 'ledger/expense' ? <LedgerExpenseDetailPage /> : null}
            {activeRoute === 'shared-trip' ? <SharedTripPage /> : null}
            {activeRoute === 'inbox' ? <TravelInboxPage /> : null}
            {activeRoute === 'search' ? <SearchPage /> : null}
            {activeRoute === 'settings' ? <SettingsPage /> : null}
            {activeRoute === 'settings/privacy' ? <SettingsPrivacyPage /> : null}
            {activeRoute === 'settings/maps' ? <SettingsMapsPage /> : null}
            {activeRoute === 'settings/route' ? <SettingsRoutePage /> : null}
            {activeRoute === 'ai-draft' ? <AiDraftPage /> : null}
          </Suspense>
        </ErrorBoundary>
      ) : null}
    </AppShell>
  )
}

function RouteLoading() {
  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <div className="h-4 w-28 animate-pulse rounded-full bg-slate-100" />
        <div className="h-5 w-2/3 animate-pulse rounded-full bg-slate-100" />
        <div className="h-4 w-full animate-pulse rounded-full bg-slate-100" />
      </Card>
    </div>
  )
}

export default App
