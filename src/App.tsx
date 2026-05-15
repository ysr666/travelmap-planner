import { lazy, Suspense, useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Card } from './components/ui/Card'
import { getCanonicalHashRedirect, routeFromHash } from './lib/routes'
import type { RouteId } from './types'
import { HomePage } from './pages/HomePage'

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
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)
const TripFormPage = lazy(() =>
  import('./pages/TripFormPage').then((module) => ({ default: module.TripFormPage })),
)
const ItemFormPage = lazy(() =>
  import('./pages/ItemFormPage').then((module) => ({ default: module.ItemFormPage })),
)

function App() {
  const [currentHash, setCurrentHash] = useState(() => window.location.hash)
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

  return (
    <AppShell activeRoute={activeRoute}>
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
            {activeRoute === 'settings' ? <SettingsPage /> : null}
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
