import { useEffect } from 'react'
import { isAccountCloudV2AccountEnabled } from '../../lib/accountCloud/feature'
import { getActiveAccountHash } from '../../lib/accountStorageScope'
import { getSupabaseClient } from '../../lib/supabaseClient'
import { getActiveTravelDatabase } from '../../db/database'

const ACTIVE_POLL_MS = 30_000

export function AccountMutationJournalController() {
  useEffect(() => {
    if (!isAccountCloudV2AccountEnabled(getActiveAccountHash())) return

    let disposed = false
    let running = false
    let authTimer: number | undefined
    const flush = async () => {
      if (
        disposed
        || running
        || navigator.onLine === false
        || !isAccountCloudV2AccountEnabled(getActiveAccountHash())
      ) return
      running = true
      try {
        const accountHash = getActiveAccountHash()
        if (!accountHash) return
        const database = getActiveTravelDatabase()
        const [{ drainAccountMutationJournal }, { recoverTerminalOptimisticAccountMutations }] = await Promise.all([
          import('../../lib/accountCloud/coordinator'),
          import('../../lib/accountCloud/localStore'),
        ])
        await recoverTerminalOptimisticAccountMutations({ accountHash, database })
        await drainAccountMutationJournal({ database, reconcileOptimistic: true })
      } catch {
        // The journal remains durable; a later wake retries without exposing raw failures.
      } finally {
        running = false
      }
    }
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void flush()
    }
    const handleAuth = (_event: string, session: unknown) => {
      if (!session || disposed) return
      if (authTimer !== undefined) window.clearTimeout(authTimer)
      authTimer = window.setTimeout(() => {
        authTimer = undefined
        const accountHash = getActiveAccountHash()
        if (disposed || !isAccountCloudV2AccountEnabled(accountHash) || !accountHash) return
        const database = getActiveTravelDatabase()
        void import('../../lib/accountCloud/localStore')
          .then(({ resumeBlockedAuthAccountMutations }) => (
            resumeBlockedAuthAccountMutations(Date.now(), database, accountHash)
          ))
          .then(() => flush())
          .catch(() => undefined)
      }, 0)
    }

    void flush()
    const interval = window.setInterval(() => void flush(), ACTIVE_POLL_MS)
    window.addEventListener('focus', flush)
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', handleVisible)
    const authSubscription = getSupabaseClient()?.auth.onAuthStateChange(handleAuth).data.subscription

    return () => {
      disposed = true
      if (authTimer !== undefined) window.clearTimeout(authTimer)
      window.clearInterval(interval)
      window.removeEventListener('focus', flush)
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', handleVisible)
      authSubscription?.unsubscribe()
    }
  }, [])

  return null
}
