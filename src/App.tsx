import { useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { routeFromHash } from './lib/routes'
import type { RouteId } from './types'
import {
  DayTimelinePage,
  HomePage,
  ItemDetailPage,
  MapPage,
  SettingsPage,
  TicketLibraryPage,
  TripOverviewPage,
} from './pages'

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
      {activeRoute === 'overview' ? <TripOverviewPage /> : null}
      {activeRoute === 'timeline' ? <DayTimelinePage /> : null}
      {activeRoute === 'map' ? <MapPage /> : null}
      {activeRoute === 'item' ? <ItemDetailPage /> : null}
      {activeRoute === 'tickets' ? <TicketLibraryPage /> : null}
      {activeRoute === 'settings' ? <SettingsPage /> : null}
    </AppShell>
  )
}

export default App
