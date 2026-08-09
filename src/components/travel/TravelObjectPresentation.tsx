import { BedDouble, MapPin, ShieldCheck, Ticket, TrainFront } from 'lucide-react'
import type { TravelObjectViewModelV1 } from '../../lib/travelObjects'
import { BrandMark } from '../media/BrandMark'
import { TravelObjectMedia } from '../media/TravelObjectMedia'

export function TravelObjectLeading({
  className = '',
  object,
  preferBrand = false,
}: {
  className?: string
  object: TravelObjectViewModelV1
  preferBrand?: boolean
}) {
  if (object.brand && (preferBrand || !object.media)) {
    return (
      <span className={`travel-object-leading travel-object-leading-brand ${className}`}>
        <BrandMark
          code={object.brand.canonicalCode}
          name={object.brand.displayName}
          namespace={object.brand.namespace}
        />
      </span>
    )
  }
  if (object.media) {
    return (
      <TravelObjectMedia
        alt={object.title}
        asset={object.media}
        className={`travel-object-leading ${className}`}
        sizes="96px"
        variant="thumbnail"
      />
    )
  }
  return (
    <span className={`travel-object-leading travel-object-leading-fallback ${className}`}>
      <TravelObjectKindIcon kind={object.kind} />
    </span>
  )
}

export function TravelObjectStatusBadge({
  className = '',
  status,
}: {
  className?: string
  status?: TravelObjectViewModelV1['status']
}) {
  if (!status) return null
  return (
    <span className={`travel-object-status travel-object-status-${status.tone} ${className}`}>
      {status.label}
    </span>
  )
}

function TravelObjectKindIcon({ kind }: { kind: TravelObjectViewModelV1['kind'] }) {
  if (kind === 'transport') return <TrainFront aria-hidden="true" className="size-5" />
  if (kind === 'lodging') return <BedDouble aria-hidden="true" className="size-5" />
  if (kind === 'insurance') return <ShieldCheck aria-hidden="true" className="size-5" />
  if (kind === 'ticket') return <Ticket aria-hidden="true" className="size-5" />
  return <MapPin aria-hidden="true" className="size-5" />
}
