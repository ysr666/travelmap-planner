import { afterEach, describe, expect, it, vi } from 'vitest'
import { inferTimeZoneFromPlaceQuery } from './timeZoneInference'
import { getDeviceTimeZone } from './timeZone'

const mocks = vi.hoisted(() => ({
  fetchProviderProxyPlaceLookup: vi.fn(),
  getProviderProxyConfig: vi.fn(),
}))

vi.mock('./providerProxyClient', () => ({
  fetchProviderProxyPlaceLookup: mocks.fetchProviderProxyPlaceLookup,
  getProviderProxyConfig: mocks.getProviderProxyConfig,
}))

const configuredProxy = {
  configured: true,
  provider: 'mock',
  proxyUrl: '/api/provider-proxy',
  source: 'proxy',
} as const

const disabledProxy = {
  configured: false,
  provider: null,
  proxyUrl: null,
  source: 'none',
} as const

afterEach(() => {
  vi.clearAllMocks()
})

describe('inferTimeZoneFromPlaceQuery', () => {
  it('uses the device time zone for empty queries without reading provider config', async () => {
    const result = await inferTimeZoneFromPlaceQuery('   ')

    expect(result).toEqual({ source: 'device', timeZone: getDeviceTimeZone() })
    expect(mocks.getProviderProxyConfig).not.toHaveBeenCalled()
    expect(mocks.fetchProviderProxyPlaceLookup).not.toHaveBeenCalled()
  })

  it('uses the device time zone when provider proxy is not configured', async () => {
    mocks.getProviderProxyConfig.mockReturnValue(disabledProxy)

    const result = await inferTimeZoneFromPlaceQuery('伦敦')

    expect(result.source).toBe('device')
    expect(result.timeZone).toBe(getDeviceTimeZone())
    expect(result.warning).toBe('未配置地点服务，已使用设备时区。')
    expect(mocks.fetchProviderProxyPlaceLookup).not.toHaveBeenCalled()
  })

  it('infers an IANA time zone from the first mocked place coordinate', async () => {
    mocks.getProviderProxyConfig.mockReturnValue(configuredProxy)
    mocks.fetchProviderProxyPlaceLookup.mockResolvedValue({
      ok: true,
      operation: 'place_lookup',
      results: [
        {
          displayName: 'London',
          formattedAddress: 'London, UK',
          location: { lat: 51.5074, lng: -0.1278 },
          placeId: 'places/london',
          provider: 'mock',
          retrievedAt: '2026-06-14T00:00:00.000Z',
        },
      ],
      retrievedAt: '2026-06-14T00:00:00.000Z',
      source: 'mock',
    })

    const result = await inferTimeZoneFromPlaceQuery('London')

    expect(result).toEqual({ source: 'provider', timeZone: 'Europe/London' })
    expect(mocks.fetchProviderProxyPlaceLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'zh-CN',
        maxResults: 1,
        operation: 'place_lookup',
        query: 'London',
      }),
      '/api/provider-proxy',
      {},
    )
  })

  it('falls back to the device time zone when mocked provider lookup fails', async () => {
    mocks.getProviderProxyConfig.mockReturnValue(configuredProxy)
    mocks.fetchProviderProxyPlaceLookup.mockRejectedValue(new Error('network unavailable'))

    const result = await inferTimeZoneFromPlaceQuery('London')

    expect(result.source).toBe('device')
    expect(result.timeZone).toBe(getDeviceTimeZone())
    expect(result.warning).toBe('时区自动推断失败，已使用设备时区。')
  })
})
