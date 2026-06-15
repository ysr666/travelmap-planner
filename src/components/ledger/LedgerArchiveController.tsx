import { useEffect } from 'react'
import { subscribeTravelDataChanged } from '../../lib/dataEvents'
import { runLedgerArchiveForAllTrips } from '../../lib/ledgerBackgroundArchive'

const DEBOUNCE_MS = 1_500

export function LedgerArchiveController() {
  useEffect(() => {
    let timer: number | undefined
    let running = false
    let rerun = false
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void run(), DEBOUNCE_MS)
    }
    const run = async () => {
      if (running) {
        rerun = true
        return
      }
      running = true
      try {
        await runLedgerArchiveForAllTrips()
      } finally {
        running = false
        if (rerun) {
          rerun = false
          schedule()
        }
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') schedule() }
    schedule()
    const unsubscribe = subscribeTravelDataChanged(schedule)
    window.addEventListener('online', schedule)
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
      window.removeEventListener('online', schedule)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}
