// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaceSearchInput, type PlaceResult } from './PlaceSearchInput'

const mocks = vi.hoisted(() => ({
  fetchProviderProxyPlaceLookup: vi.fn(),
  getProviderProxyConfig: vi.fn(() => ({
    configured: true,
    provider: 'openrouteservice',
    proxyUrl: '/api/provider-proxy',
    source: 'proxy',
  })),
  isGoogleMapsAvailable: vi.fn(() => false),
  waitForGoogleMaps: vi.fn(async () => false),
}))

vi.mock('../../lib/googleMaps', () => ({
  isGoogleMapsAvailable: mocks.isGoogleMapsAvailable,
  waitForGoogleMaps: mocks.waitForGoogleMaps,
}))

vi.mock('../../lib/providerProxyClient', () => ({
  fetchProviderProxyPlaceLookup: mocks.fetchProviderProxyPlaceLookup,
  getProviderProxyConfig: mocks.getProviderProxyConfig,
  ProviderProxyClientError: class ProviderProxyClientError extends Error {},
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.fetchProviderProxyPlaceLookup.mockReset()
  mocks.getProviderProxyConfig.mockClear()
  mocks.isGoogleMapsAvailable.mockReturnValue(false)
  mocks.waitForGoogleMaps.mockResolvedValue(false)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

function renderControlledInput(onPlaceSelect = vi.fn(), initialValue = '') {
  function Harness() {
    const [value, setValue] = useState(initialValue)
    return (
      <PlaceSearchInput
        label="搜索地点"
        onChange={setValue}
        onPlaceSelect={onPlaceSelect}
        value={value}
      />
    )
  }

  act(() => {
    root?.render(<Harness />)
  })
  return onPlaceSelect
}

describe('PlaceSearchInput', () => {
  it('uses provider proxy lookup when the explicit search button is clicked', async () => {
    const selectedPlaces: PlaceResult[] = []
    const onPlaceSelect = vi.fn((place: PlaceResult) => {
      selectedPlaces.push(place)
    })
    mocks.fetchProviderProxyPlaceLookup.mockResolvedValue({
      ok: true,
      operation: 'place_lookup',
      results: [{
        displayName: '爱丁堡城堡',
        formattedAddress: 'Castlehill, Edinburgh EH1 2NG, UK',
        location: { lat: 55.9486, lng: -3.1999 },
        placeId: 'place-1',
        provider: 'google_places',
        retrievedAt: '2026-07-09T00:00:00.000Z',
      }],
      retrievedAt: '2026-07-09T00:00:00.000Z',
      source: 'google_places',
    })

    renderControlledInput(onPlaceSelect, '爱丁堡城堡')
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('button[aria-label="查询地点"]')?.click()
    })

    expect(mocks.fetchProviderProxyPlaceLookup).toHaveBeenCalledWith(expect.objectContaining({
      maxResults: 5,
      operation: 'place_lookup',
      query: '爱丁堡城堡',
    }), '/api/provider-proxy')
    expect(container?.textContent).toContain('爱丁堡城堡')

    await act(async () => {
      Array.from(container?.querySelectorAll('button') ?? [])
        .find((button) => button.textContent?.includes('爱丁堡城堡'))
        ?.click()
    })

    expect(onPlaceSelect).toHaveBeenCalledWith({
      address: 'Castlehill, Edinburgh EH1 2NG, UK',
      lat: 55.9486,
      lng: -3.1999,
      name: '爱丁堡城堡',
    })
    expect(selectedPlaces).toHaveLength(1)
  })
})
