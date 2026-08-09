import { getTicketBlob } from '../../db'
import { getProviderProxyConfig } from '../providerProxyClientShared'
import { fetchProviderProxyPlacePhoto } from '../providerProxyClient'
import { resolveFixtureMediaAsset } from './fixtureMediaRegistry'
import { isTravelMediaAssetCurrent, type TravelMediaAssetV1 } from './travelMedia'

export type LoadedTravelMedia = {
  src: string
  release: () => void
}

export async function loadTravelMedia(
  asset: TravelMediaAssetV1,
  options: {
    maxWidthPx?: number
    maxHeightPx?: number
    now?: Date | number | string
    signal?: AbortSignal
  } = {},
): Promise<LoadedTravelMedia | null> {
  if (!isTravelMediaAssetCurrent(asset, options.now)) return null

  if (asset.renderRef.type === 'fixture_asset') {
    const src = resolveFixtureMediaAsset(asset.renderRef.assetId)
    return src ? { release: noOp, src } : null
  }

  if (asset.renderRef.type === 'ticket_blob') {
    const record = await getTicketBlob(asset.renderRef.ticketId)
    if (!record?.blob || !['image/jpeg', 'image/png', 'image/webp'].includes(record.blob.type)) return null
    const src = URL.createObjectURL(record.blob)
    return { release: () => URL.revokeObjectURL(src), src }
  }

  const config = getProviderProxyConfig()
  if (!config.configured || !config.proxyUrl) return null
  const blob = await fetchProviderProxyPlacePhoto({
    maxHeightPx: clampPhotoDimension(options.maxHeightPx ?? asset.height),
    maxWidthPx: clampPhotoDimension(options.maxWidthPx ?? asset.width),
    operation: 'place_photo',
    photoRef: asset.renderRef.photoRef,
  }, config.proxyUrl, { signal: options.signal })
  const src = URL.createObjectURL(blob)
  return { release: () => URL.revokeObjectURL(src), src }
}

function clampPhotoDimension(value: number) {
  return Math.max(64, Math.min(1_600, Math.round(value)))
}

function noOp() {}
