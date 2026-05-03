import { lazy, Suspense, useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { Card } from './components/ui/Card'
import { routeFromHash } from './lib/routes'
import type { RouteId } from './types'
import { HomePage } from './pages/HomePage'

const TripOverviewPage = lazy(() =>
  import('./pages/TripOverviewPage').then((module) => ({ default: module.TripOverviewPage })),
)
const DayTimelinePage = lazy(() =>
  import('./pages/DayTimelinePage').then((module) => ({ default: module.DayTimelinePage })),
)
const MapPage = lazy(() => import('./pages/MapPage').then((module) => ({ default: module.MapPage })))
const ItemDetailPage = lazy(() =>
  import('./pages/ItemDetailPage').then((module) => ({ default: module.ItemDetailPage })),
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
        <Suspense fallback={<RouteLoading activeRoute={activeRoute} />}>
          {activeRoute === 'overview' ? <TripOverviewPage /> : null}
          {activeRoute === 'timeline' ? <DayTimelinePage /> : null}
          {activeRoute === 'map' ? <MapPage /> : null}
          {activeRoute === 'item' ? <ItemDetailPage /> : null}
          {activeRoute === 'tickets' ? <TicketLibraryPage /> : null}
          {activeRoute === 'settings' ? <SettingsPage /> : null}
        </Suspense>
      ) : null}
    </AppShell>
  )
}

function RouteLoading({ activeRoute }: { activeRoute: RouteId }) {
  const isMap = activeRoute === 'map'

  return (
    <div className={isMap ? 'app-viewport bg-[#eaf2f9] p-4 pt-[max(5rem,env(safe-area-inset-top))]' : 'space-y-5'}>
      <Card className="space-y-3">
        <div className="h-4 w-28 animate-pulse rounded-full bg-slate-100" />
        <div className="h-5 w-2/3 animate-pulse rounded-full bg-slate-100" />
        <div className="h-4 w-full animate-pulse rounded-full bg-slate-100" />
      </Card>
      {isMap ? <div className="mt-3 h-[54dvh] rounded-2xl bg-white/70" /> : null}
    </div>
  )
}

export default App
