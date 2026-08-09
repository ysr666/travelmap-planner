// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TravelMediaAssetV1 } from '../../lib/media/travelMedia'
import { TravelObjectMedia } from './TravelObjectMedia'

const mocks = vi.hoisted(() => ({
  loadTravelMedia: vi.fn(),
}))

vi.mock('../../lib/media/mediaLoader', () => ({
  loadTravelMedia: mocks.loadTravelMedia,
}))

function fixtureAsset(overrides: Partial<TravelMediaAssetV1> = {}): TravelMediaAssetV1 {
  return {
    aspectRatio: 4 / 3,
    attribution: [{
      label: 'Test Author · CC BY 4.0',
      uri: 'https://commons.wikimedia.org/wiki/File:Test.jpg',
    }],
    expiresAt: '2030-01-01T00:00:00.000Z',
    height: 600,
    id: 'media_test_thumb_v1',
    kind: 'place_photo',
    observedAt: '2026-01-01T00:00:00.000Z',
    providerRef: 'media_test_thumb_v1',
    renderRef: { assetId: 'media_test_thumb_v1', type: 'fixture_asset' },
    rightsRef: 'https://creativecommons.org/licenses/by/4.0/',
    schemaVersion: 1,
    source: 'fixture_registry',
    sourceUri: 'https://commons.wikimedia.org/wiki/File:Test.jpg',
    subjectId: 'item_test',
    subjectType: 'item',
    tripId: 'trip_test',
    width: 800,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window.navigator, 'connection', {
    configurable: true,
    value: undefined,
  })
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: true,
  })
})

describe('TravelObjectMedia', () => {
  it('keeps a stable ratio and exposes source attribution after loading', async () => {
    const release = vi.fn()
    mocks.loadTravelMedia.mockResolvedValue({ release, src: '/fixtures/place.webp' })
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(<TravelObjectMedia alt="爱丁堡城堡" asset={fixtureAsset()} now="2027-01-01T00:00:00.000Z" variant="hero" />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    const figure = container.querySelector('figure')
    const image = container.querySelector('img')
    expect(figure?.getAttribute('data-media-state')).toBe('loading')
    await act(async () => image?.dispatchEvent(new Event('load')))
    expect(figure?.getAttribute('data-media-state')).toBe('ready')
    expect(figure?.getAttribute('style')).toContain('aspect-ratio: 1.3333333333333333')
    expect(image?.getAttribute('src')).toBe('/fixtures/place.webp')
    expect(image?.getAttribute('alt')).toBe('爱丁堡城堡')
    expect(container.querySelector('a')?.getAttribute('href')).toContain('commons.wikimedia.org')
    expect(container.textContent).toContain('Test Author')

    await act(async () => root.unmount())
    expect(release).toHaveBeenCalledOnce()
  })

  it('uses the fixed fallback without loading expired media', async () => {
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(<TravelObjectMedia alt="已过期图片" asset={fixtureAsset()} now="2031-01-01T00:00:00.000Z" />)
    })

    expect(container.querySelector('figure')?.getAttribute('data-media-state')).toBe('empty')
    expect(container.querySelector('[data-testid="media-fallback"]')).not.toBeNull()
    expect(mocks.loadTravelMedia).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('keeps thumbnail attribution non-interactive inside clickable rows', async () => {
    mocks.loadTravelMedia.mockResolvedValue({ release: vi.fn(), src: '/fixtures/place.webp' })
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(<TravelObjectMedia alt="缩略图" asset={fixtureAsset()} now="2027-01-01T00:00:00.000Z" />)
      await Promise.resolve()
    })
    await act(async () => container.querySelector('img')?.dispatchEvent(new Event('load')))

    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('figcaption')?.textContent).toContain('Test Author')
    await act(async () => root.unmount())
  })

  it('settles on the same-size fallback when loading fails', async () => {
    mocks.loadTravelMedia.mockRejectedValue(new Error('unavailable'))
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(<TravelObjectMedia alt="加载失败" asset={fixtureAsset()} now="2027-01-01T00:00:00.000Z" variant="hero" />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.querySelector('figure')?.getAttribute('data-media-state')).toBe('error')
    expect(container.querySelector('[data-testid="media-fallback"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it.each([
    ['offline', false, false],
    ['reduced-data', true, true],
  ] as const)('does not request provider media while %s', async (expectedState, onLine, saveData) => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: onLine,
    })
    Object.defineProperty(window.navigator, 'connection', {
      configurable: true,
      value: { saveData },
    })
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(
        <TravelObjectMedia
          alt="Provider 图片"
          asset={providerAsset()}
          now="2027-01-01T00:00:00.000Z"
        />,
      )
    })

    expect(container.querySelector('figure')?.getAttribute('data-media-state')).toBe(expectedState)
    expect(container.querySelector('[data-testid="media-fallback"]')).not.toBeNull()
    expect(mocks.loadTravelMedia).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('loads provider media after connectivity returns', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    mocks.loadTravelMedia.mockResolvedValue({ release: vi.fn(), src: '/provider/place.webp' })
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(
        <TravelObjectMedia
          alt="Provider 图片"
          asset={providerAsset()}
          now="2027-01-01T00:00:00.000Z"
        />,
      )
    })
    expect(container.querySelector('figure')?.getAttribute('data-media-state')).toBe('offline')

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await Promise.resolve()
    })

    expect(mocks.loadTravelMedia).toHaveBeenCalledOnce()
    expect(container.querySelector('figure')?.getAttribute('data-media-state')).toBe('loading')
    await act(async () => container.querySelector('img')?.dispatchEvent(new Event('load')))
    expect(container.querySelector('figure')?.getAttribute('data-media-state')).toBe('ready')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/provider/place.webp')
    await act(async () => root.unmount())
  })
})

function providerAsset(): TravelMediaAssetV1 {
  const photoRef = 'places/ChIJ-test/photos/A1234567890abcdef'
  return fixtureAsset({
    attribution: [{ label: 'Google', uri: 'https://www.google.com/maps' }],
    providerRef: photoRef,
    renderRef: { photoRef, provider: 'google_places', type: 'provider_photo' },
    source: 'google_places',
    sourceUri: 'https://www.google.com/maps',
  })
}
