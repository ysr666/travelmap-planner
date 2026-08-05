import { useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { loadTravelMedia, type LoadedTravelMedia } from '../../lib/media/mediaLoader'
import { isTravelMediaAssetCurrent, type TravelMediaAssetV1 } from '../../lib/media/travelMedia'
import { MediaFallback } from './MediaFallback'

type TravelObjectMediaProps = {
  asset?: TravelMediaAssetV1 | null
  alt: string
  className?: string
  eager?: boolean
  now?: Date | number | string
  sizes?: string
  variant?: 'hero' | 'thumbnail' | 'document'
}

export function TravelObjectMedia({
  asset,
  alt,
  className = '',
  eager = false,
  now,
  sizes,
  variant = 'thumbnail',
}: TravelObjectMediaProps) {
  const [loadResult, setLoadResult] = useState<{
    key: string
    media: LoadedTravelMedia | null
    status: 'empty' | 'ready' | 'error'
  } | null>(null)
  const current = asset ? isTravelMediaAssetCurrent(asset, now) : false
  const mediaKey = asset ? `${asset.id}:${asset.expiresAt}:${asset.renderRef.type}` : ''
  const matchingResult = loadResult?.key === mediaKey ? loadResult : null
  const loaded = matchingResult?.media ?? null
  const state = !asset || !current
    ? 'empty'
    : matchingResult?.status ?? 'loading'
  const style = useMemo(() => ({
    aspectRatio: asset?.aspectRatio ?? defaultAspectRatio(variant),
    objectPosition: asset?.focalPoint
      ? `${asset.focalPoint.x * 100}% ${asset.focalPoint.y * 100}%`
      : '50% 50%',
  }), [asset?.aspectRatio, asset?.focalPoint, variant])

  useEffect(() => {
    let active = true
    let currentLoaded: LoadedTravelMedia | null = null
    const controller = new AbortController()
    if (!asset || !current) {
      return () => controller.abort()
    }
    void loadTravelMedia(asset, {
      maxHeightPx: variant === 'hero' ? 1_000 : 640,
      maxWidthPx: variant === 'hero' ? 1_600 : 800,
      now,
      signal: controller.signal,
    }).then((result) => {
      if (!active) {
        result?.release()
        return
      }
      currentLoaded = result
      setLoadResult({ key: mediaKey, media: result, status: result ? 'ready' : 'empty' })
    }).catch(() => {
      if (active) setLoadResult({ key: mediaKey, media: null, status: 'error' })
    })
    return () => {
      active = false
      controller.abort()
      currentLoaded?.release()
    }
  }, [asset, current, mediaKey, now, variant])

  const sourceUri = asset?.sourceUri ?? asset?.attribution.find((entry) => entry.uri)?.uri
  const attribution = asset?.attribution.map((entry) => entry.label).join(' · ')

  return (
    <figure
      className={`travel-object-media travel-object-media-${variant} ${className}`}
      data-media-state={state}
      style={{ aspectRatio: style.aspectRatio }}
    >
      {loaded && state !== 'error' ? (
        <img
          alt={alt}
          className="size-full object-cover"
          decoding="async"
          loading={eager ? 'eager' : 'lazy'}
          onError={() => setLoadResult({ key: mediaKey, media: loaded, status: 'error' })}
          sizes={sizes}
          src={loaded.src}
          style={{ objectPosition: style.objectPosition }}
        />
      ) : state === 'loading' ? (
        <span aria-label="正在加载图片" className="block size-full animate-pulse bg-surface-container-low" role="status" />
      ) : (
        <MediaFallback />
      )}
      {state === 'ready' && attribution ? (
        sourceUri ? (
          <a
            aria-label={`查看图片来源：${attribution}`}
            className="travel-object-media-attribution tm-focus"
            href={sourceUri}
            onClick={(event) => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
            title={attribution}
          >
            <ExternalLink className="size-3" />
            <span>{attribution}</span>
          </a>
        ) : (
          <figcaption className="travel-object-media-attribution" title={attribution}>{attribution}</figcaption>
        )
      ) : null}
    </figure>
  )
}

function defaultAspectRatio(variant: NonNullable<TravelObjectMediaProps['variant']>) {
  if (variant === 'hero') return 1.5
  if (variant === 'document') return 0.75
  return 4 / 3
}
