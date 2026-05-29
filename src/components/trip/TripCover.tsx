import type { Trip } from '../../types'
import { formatDateRange } from '../../lib/dates'
import { getTripStatus } from '../../lib/tripVisuals'

type TripCoverProps = {
  trip: Trip
  variant?: 'thumbnail' | 'hero' | 'compact'
  className?: string
  heroStats?: { days: number; spots: number; tickets: number }
  photo?: string
}

export function TripCover({ trip, variant = 'thumbnail', className = '', heroStats, photo }: TripCoverProps) {
  const status = getTripStatus(trip)

  if (variant === 'hero') {
    return (
      <div className={`relative overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container ${className}`}>
        {/* Photo background */}
        <div className="absolute inset-0 z-0">
          {photo ? (
            <img alt="" className="size-full object-cover opacity-40" src={photo} />
          ) : (
            <div className="size-full bg-surface-variant" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface-container via-surface-container/80 to-transparent" />
        </div>
        {/* Content */}
        <div className="relative z-10 p-6 flex flex-col gap-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-headline-md text-headline-md text-on-surface mb-1">{trip.title}</h3>
              <p className="font-body-md text-body-md text-on-surface-variant">
                {trip.destination && trip.destination !== trip.title ? trip.destination : ''}
                {trip.destination && trip.destination !== trip.title ? ' · ' : ''}
                {formatDateRange(trip.startDate, trip.endDate)}
              </p>
            </div>
            <div className="bg-primary/20 text-primary px-3 py-1 rounded-full border border-primary/30 flex items-center gap-1">
              <span className="font-label-sm text-label-sm">{status.label}</span>
            </div>
          </div>
          {heroStats ? (
            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-outline-variant/30">
              <div className="flex flex-col">
                <span className="font-headline-md text-headline-md text-on-surface">{heroStats.days}</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">天</span>
              </div>
              <div className="flex flex-col">
                <span className="font-headline-md text-headline-md text-on-surface">{heroStats.spots}</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">个行程点</span>
              </div>
              <div className="flex flex-col">
                <span className="font-headline-md text-headline-md text-on-surface">{heroStats.tickets}</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">张票据</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (variant === 'compact') {
    return (
      <div className={`size-12 shrink-0 overflow-hidden rounded-lg bg-surface-variant border border-outline-variant/30 ${className}`}>
        {photo ? (
          <img alt="" className="size-full object-cover" src={photo} />
        ) : (
          <div className="flex size-full items-center justify-center text-on-surface-variant">
            <span className="text-lg">{getTripEmoji(trip)}</span>
          </div>
        )}
      </div>
    )
  }

  // thumbnail (default)
  return (
    <div className={`size-12 shrink-0 overflow-hidden rounded-lg bg-surface-variant border border-outline-variant/30 ${className}`}>
      {photo ? (
        <img alt="" className="size-full object-cover" src={photo} />
      ) : (
        <div className="flex size-full items-center justify-center text-on-surface-variant">
          <span className="text-lg">{getTripEmoji(trip)}</span>
        </div>
      )}
    </div>
  )
}

function getTripEmoji(trip: Trip): string {
  const dest = (trip.destination || trip.title || '').toLowerCase()
  if (dest.includes('东京') || dest.includes('日本') || dest.includes('japan')) return '🗼'
  if (dest.includes('伦敦') || dest.includes('london') || dest.includes('英国')) return '🎡'
  if (dest.includes('巴黎') || dest.includes('paris') || dest.includes('法国')) return '🗼'
  if (dest.includes('纽约') || dest.includes('new york') || dest.includes('美国')) return '🗽'
  if (dest.includes('首尔') || dest.includes('seoul') || dest.includes('韩国')) return '🇰🇷'
  if (dest.includes('曼谷') || dest.includes('bangkok') || dest.includes('泰国')) return '🇹🇭'
  if (dest.includes('悉尼') || dest.includes('sydney') || dest.includes('澳洲')) return '🦘'
  if (dest.includes('迪拜') || dest.includes('dubai')) return '🏙️'
  if (dest.includes('罗马') || dest.includes('rome') || dest.includes('意大利')) return '🏛️'
  if (dest.includes('巴塞罗那') || dest.includes('barcelona') || dest.includes('西班牙')) return '🇪🇸'
  return '✈️'
}
