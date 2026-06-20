import { useCallback, useEffect, useRef, useState } from 'react'
import type { TripOperationsLocalState } from '../lib/tripOperationsState'
import { subscribeTravelDataChanged } from '../lib/dataEvents'
import {
  appendTripIntelligenceExecutionResult,
  clearTripIntelligenceHistory,
  createEmptyTripIntelligencePersistedLocalState,
  loadTripIntelligenceLocalState,
  persistTripIntelligenceLocalState,
  restoreTripIntelligenceSuggestionState,
  setTripIntelligenceSuggestionState,
  type AppendTripIntelligenceExecutionResultInput,
  type SetTripIntelligenceSuggestionStateInput,
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

  const appendExecutionResult = useCallback(async (input: AppendTripIntelligenceExecutionResultInput) => {
    if (!tripId) return
    const persisted = await appendTripIntelligenceExecutionResult(tripId, input)
    latestLocalStateRef.current = persisted.localState
    setSnapshot(persisted)
  }, [tripId])

  const setSuggestionState = useCallback(async (input: SetTripIntelligenceSuggestionStateInput) => {
    if (!tripId) return
    const persisted = await setTripIntelligenceSuggestionState(tripId, input)
    latestLocalStateRef.current = persisted.localState
    setSnapshot(persisted)
  }, [tripId])

  const restoreSuggestionState = useCallback(async (suggestionKey: string) => {
    if (!tripId) return
    await restoreTripIntelligenceSuggestionState(tripId, suggestionKey)
    await reload()
  }, [reload, tripId])

  return {
    appendExecutionResult,
    isLoaded: loadedTripId === (tripId ?? null),
    localState: snapshot.localState,
    reload,
    restoreSuggestionState,
    setSuggestionState,
    suggestionStates: snapshot.suggestionStates,
    updateLocalState,
  }
}
