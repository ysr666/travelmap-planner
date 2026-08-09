import { Hotel, Plane, ShieldCheck, TrainFront } from 'lucide-react'
import {
  resolveBrandIdentity,
  type BrandIdentityInput,
  type BrandIdentityV1,
  type BrandNamespace,
} from '../../lib/media/brandRegistry'

type BrandMarkProps = {
  brand?: BrandIdentityV1 | null
  code?: string
  name?: string
  namespace: BrandNamespace
  className?: string
}

export function BrandMark({ brand, className = '', code, name, namespace }: BrandMarkProps) {
  const identity = brand ?? resolveBrandIdentity({
    canonicalCode: code,
    displayName: name,
    namespace,
  } satisfies BrandIdentityInput)
  const label = identity?.displayName ?? name ?? genericBrandLabel(namespace)

  return (
    <span
      aria-label={label}
      className={`brand-mark ${identity?.colorMode === 'monochrome-adaptive' ? 'brand-mark-monochrome' : ''} ${className}`}
      data-brand-code={identity?.canonicalCode ?? 'generic'}
      role="img"
      title={label}
    >
      {identity ? (
        <img alt="" aria-hidden="true" className="max-h-full max-w-full object-contain" src={identity.logoAssetRef} />
      ) : (
        <GenericBrandIcon namespace={namespace} />
      )}
    </span>
  )
}

function GenericBrandIcon({ namespace }: { namespace: BrandNamespace }) {
  if (namespace === 'airline') return <Plane aria-hidden="true" className="size-5" />
  if (namespace === 'rail') return <TrainFront aria-hidden="true" className="size-5" />
  if (namespace === 'insurance') return <ShieldCheck aria-hidden="true" className="size-5" />
  return <Hotel aria-hidden="true" className="size-5" />
}

function genericBrandLabel(namespace: BrandNamespace) {
  if (namespace === 'airline') return '航空公司'
  if (namespace === 'rail') return '铁路运营方'
  if (namespace === 'insurance') return '保险公司'
  return '酒店集团'
}
