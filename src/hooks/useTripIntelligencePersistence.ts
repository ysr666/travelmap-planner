import { useCallback, useEffect, useRef, useState } from 'react'
import type { TripOperationsLocalState } from '../lib/tripOperationsState'
import { subscribeTravelDataChanged } from '../lib/dataEvents'
import {
  clearTripIntelligenceHistory,
  createEmptyTripIntelligencePersistedLocalState,
  loadTripIntelligenceLocalState,
  persistTripIntelligenceLocalState,
  type TripIntelligencePersistedLocalState,
} from '../lib/tripIntelligence/persistence'

export function useTripIntelligencePersistence(tripId?: string | null) {
  const [snapshot, setSnapshot] = useState<TripIntelligencePersistedLocalState>(
    createEmptyTripIntelligencePersistedLocalState,
  )
  const [loadedTripId, setLoadedTripId] = useState<string | null>()
  const requestVersionRef = useRef(0)
  const latestLocalStateRef = useRef(snapshot.localState)
  const writeSequenceRef = useRef<Promise<void>>(Promise.resolve())

  const reload = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
    try {
      const loaded = tripId
        ? await loadTripIntelligenceLocalState(tripId)
        : createEmptyTripIntelligencePersistedLocalState()
      if (requestVersion === requestVersionRef.current) {
        latestLocalStateRef.current = loaded.localState
        setSnapshot(loaded)
        setLoadedTripId(tripId ?? null)
      }
    } catch {
      if (requestVersion === requestVersionRef.current) {
        const empty = createEmptyTripIntelligencePersistedLocalState()
        latestLocalStateRef.current = empty.localState
        setSnapshot(empty)
        setLoadedTripId(tripId ?? null)
      }
    }
  }, [tripId])

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current
    const loadPromise = tripId
      ? loadTripIntelligenceLocalState(tripId)
      : Promise.resolve(createEmptyTripIntelligencePersistedLocalState())
    void loadPromise.then((loaded) => {
      if (requestVersion === requestVersionRef.current) {
        latestLocalStateRef.current = loaded.localState
        setSnapshot(loaded)
        setLoadedTripId(tripId ?? null)
      }
    }).catch(() => {
      if (requestVersion === requestVersionRef.current) {
        const empty = createEmptyTripIntelligencePersistedLocalState()
        latestLocalStateRef.current = empty.localState
        setSnapshot(empty)
        setLoadedTripId(tripId ?? null)
      }
    })
  }, [tripId])

  useEffect(() => subscribeTravelDataChanged(() => {
    void reload()
  }), [reload])

  const updateLocalState = useCallback((nextState: TripOperationsLocalState) => {
    if (!tripId) return
    const isExplicitHistoryClear = latestLocalStateRef.current.history.length > 0 && nextState.history.length === 0
    latestLocalStateRef.current = nextState
    const requestVersion = requestVersionRef.current
    setSnapshot((current) => ({ ...current, localState: nextState }))
    writeSequenceRef.current = writeSequenceRef.current
      .catch(() => undefined)
      .then(async () => {
        if (isExplicitHistoryClear) await clearTripIntelligenceHistory(tripId)
        const persisted = await persistTripIntelligenceLocalState(tripId, nextState)
        if (requestVersion === requestVersionRef.current) {
          latestLocalStateRef.current = persisted.localState
          setSnapshot(persisted)
        }
      })
  }, [tripId])

  return {
    isLoaded: loadedTripId === (tripId ?? null),
    localState: snapshot.localState,
    reload,
    suggestionStates: snapshot.suggestionStates,
    updateLocalState,
  }
}
