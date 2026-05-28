import { MapPinned, Route } from 'lucide-react'
import { getTripVisual } from '../../lib/tripVisuals'
import type { Trip } from '../../types'

type TripCoverProps = {
  trip: Trip
  variant?: 'thumbnail' | 'hero' | 'compact'
  className?: string
  heroStats?: { days: number; spots: number; tickets: number }
}

export function TripCover({ trip, variant = 'thumbnail', className = '', heroStats }: TripCoverProps) {
  const visual = getTripVisual(trip)
  const sizeClass =
    variant === 'hero'
      ? 'h-52'
      : variant === 'compact'
        ? 'h-16'
        : 'h-24'

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${visual.gradientClass} ${sizeClass} ${className}`}
    >
      {/* Decorative elements */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute left-4 top-5 h-px w-24 rotate-12 bg-white" />
        <div className="absolute bottom-7 right-5 h-px w-28 -rotate-12 bg-white" />
        <div className="absolute left-9 top-11 size-2 rounded-full bg-white" />
        <div className="absolute bottom-10 right-14 size-2 rounded-full bg-white" />
      </div>

      {/* Map pin icon */}
      <div className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-xl bg-white/22 text-white backdrop-blur">
        <MapPinned className="size-5" />
      </div>

      {variant === 'hero' ? (
        <>
          {/* Dark gradient overlay for text legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />

          {/* Bottom content: title + stats */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                {visual.emoji} {visual.label}
              </span>
            </div>
            <h3 className="text-lg font-bold text-white drop-shadow-sm leading-tight">
              {trip.title}
            </h3>
            <p className="mt-0.5 text-xs text-white/80">
              {trip.destination && trip.destination !== trip.title ? trip.destination : ''}
            </p>
            {heroStats ? (
              <div className="mt-2 flex items-center gap-4 text-xs text-white/90">
                <span>{heroStats.days} 天</span>
                <span>{heroStats.spots} 个行程点</span>
                <span>{heroStats.tickets} 张票据</span>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-xs font-semibold ${visual.accentClass}`}>{visual.label}</p>
            <p className="truncate text-base font-semibold text-white drop-shadow-sm">
              {trip.destination || trip.title}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/22 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
            <Route className="size-3.5" />
            <span>{visual.emoji}</span>
          </div>
        </div>
      )}
    </div>
  )
}
