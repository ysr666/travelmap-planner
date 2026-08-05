import { useEffect, useMemo, useState } from 'react'
import { createDemoTrip } from '../db'
import {
  CompletedTodayView,
  EmptyTodayView,
  TodayStageLoading,
  UpcomingTodayView,
} from '../components/home/TodayStageViews'
import {
  TodayStageContainer,
  TodayWorkspace,
} from '../components/home/TodayWorkspace'
import { subscribeTravelDataChanged } from '../lib/dataEvents'
import {
  buildHomePortfolioModel,
  type HomePortfolioModel,
  type HomeTripSnapshot,
} from '../lib/homeOverview'
import { loadHomeTripSnapshots } from '../lib/homeTripSnapshots'
import { readTripNavigationContext } from '../lib/navigationContext'
import type { Trip } from '../types'

const EMPTY_PORTFOLIO: HomePortfolioModel = { activeAndUpcoming: [], completed: [], primary: null }

export function HomePage({
  onPrimaryTripChange,
}: {
  onPrimaryTripChange?: (trip: Pick<Trip, 'id' | 'title'> | null) => void
} = {}) {
  const [snapshots, setSnapshots] = useState<HomeTripSnapshot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreatingDemo, setIsCreatingDemo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preferredTripId = useMemo(() => readTripNavigationContext()?.tripId ?? null, [])
  const portfolio = useMemo(
    () => snapshots.length > 0
      ? buildHomePortfolioModel(snapshots, { preferredTripId })
      : EMPTY_PORTFOLIO,
    [preferredTripId, snapshots],
  )
  const primarySnapshot = useMemo(() => {
    const primaryTripId = portfolio.primary?.trip.id
    return primaryTripId
      ? snapshots.find((snapshot) => snapshot.trip.id === primaryTripId) ?? null
      : null
  }, [portfolio.primary?.trip.id, snapshots])

  useEffect(() => {
    onPrimaryTripChange?.(portfolio.primary?.trip ?? null)
  }, [onPrimaryTripChange, portfolio.primary?.trip])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const nextSnapshots = await loadHomeTripSnapshots()
        if (!cancelled) {
          setSnapshots(nextSnapshots)
          setError(null)
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '读取旅行失败')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    const unsubscribe = subscribeTravelDataChanged(() => void load())
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  async function handleCreateDemoTrip() {
    setIsCreatingDemo(true)
    setError(null)
    try {
      await createDemoTrip()
      setSnapshots(await loadHomeTripSnapshots())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建示例旅行失败')
    } finally {
      setIsCreatingDemo(false)
    }
  }

  if (isLoading) {
    return <TodayStageLoading />
  }

  if (!portfolio.primary || !primarySnapshot) {
    return (
      <EmptyTodayView
        error={error}
        isCreatingDemo={isCreatingDemo}
        onCreateDemo={() => void handleCreateDemoTrip()}
      />
    )
  }

  const otherTrips = [...portfolio.activeAndUpcoming, ...portfolio.completed]
  if (portfolio.primary.status === 'upcoming') {
    return (
      <TodayStageContainer title={portfolio.primary.trip.title}>
        <UpcomingTodayView
          error={error}
          otherTrips={otherTrips}
          overview={portfolio.primary}
          snapshot={primarySnapshot}
        />
      </TodayStageContainer>
    )
  }
  if (portfolio.primary.status === 'completed') {
    return (
      <TodayStageContainer title={portfolio.primary.trip.title}>
        <CompletedTodayView
          error={error}
          otherTrips={otherTrips}
          overview={portfolio.primary}
          snapshot={primarySnapshot}
        />
      </TodayStageContainer>
    )
  }

  return (
    <div className="h-full min-h-0" data-testid="trip-card">
      <span aria-hidden="true" className="sr-only">{portfolio.primary.trip.title}</span>
      <div className="h-full min-h-0" data-testid="home-primary-trip">
        <TodayWorkspace
          error={error}
          otherTrips={otherTrips}
          overview={portfolio.primary}
          snapshot={primarySnapshot}
        />
      </div>
    </div>
  )
}
