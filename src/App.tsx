import { lazy, Suspense, useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Card } from './components/ui/Card'
import { routeFromHash } from './lib/routes'
import type { RouteId } from './types'
import { HomePage } from './pages/HomePage'

const TripWorkspacePage = lazy(() =>
  import('./pages/TripWorkspacePage').then((module) => ({ default: module.TripWorkspacePage })),
)
const TicketLibraryPage = lazy(() =>
  import('./pages/TicketLibraryPage').then((module) => ({ default: module.TicketLibraryPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)

function App() {
  const [currentHash, setCurrentHash] = useState(() => window.location.hash)
  const activeRoute: RouteId = routeFromHash()

  useEffect(() => {
    const syncRoute = () => setCurrentHash(window.location.hash)
    window.addEventListener('hashchange', syncRoute)

    if (!window.location.hash) {
      window.location.hash = '/home'
    } else {
      syncRoute()
    }

    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  return (
    <AppShell activeRoute={activeRoute} key={currentHash}>
      {activeRoute === 'home' ? <HomePage /> : null}
      {activeRoute !== 'home' ? (
        <ErrorBoundary key={currentHash}>
          <Suspense fallback={<RouteLoading />}>
            {activeRoute === 'trip' || activeRoute === 'item' ? <TripWorkspacePage /> : null}
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
