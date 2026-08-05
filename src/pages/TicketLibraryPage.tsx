import type { ReactNode } from 'react'
import { TicketLibraryView } from '../components/tickets/TicketLibraryView'
import { useTicketLibraryController } from '../hooks/useTicketLibraryController'

export function TicketLibraryPage({
  contextControls,
  embedded = false,
  headerAction,
  tripIdOverride,
}: {
  contextControls?: ReactNode
  embedded?: boolean
  headerAction?: ReactNode
  tripIdOverride?: string | null
} = {}) {
  const controller = useTicketLibraryController({ embedded, tripIdOverride })
  return (
    <TicketLibraryView
      contextControls={contextControls}
      controller={controller}
      embedded={embedded}
      headerAction={headerAction}
    />
  )
}
