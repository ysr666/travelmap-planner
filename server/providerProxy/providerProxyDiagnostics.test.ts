import { describe, expect, it } from 'vitest'
import { buildProviderProxyDiagnosticsResponse } from './providerProxyDiagnostics'

describe('provider proxy diagnostics', () => {
  it('returns safe booleans and enums without leaking secret material', () => {
    const response = buildProviderProxyDiagnosticsResponse({
      GOOGLE_MAPS_PLATFORM_API_KEY: 'shared-google-secret-value',
      OPENROUTESERVICE_API_KEY: 'ors-secret-value',
      TRIPMAP_AI_API_KEY: 'ai-secret-value',
      TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1',
      TRIPMAP_AI_MODEL: 'model-name',
      TRIPMAP_AI_PROVIDER: 'openai_compatible',
      TRIPMAP_PLACE_PROVIDER: 'google_places',
      TRIPMAP_SEARCH_API_KEY: 'search-secret-value',
      TRIPMAP_SEARCH_PROVIDER: 'tavily',
      VITE_GOOGLE_MAPS_API_KEY: 'vite-google-secret-value',
    }, '2026-06-02T01:02:03.000Z')

    expect(response).toMatchObject({
      ok: true,
      operation: 'provider_env_diagnostics',
      providers: {
        ai: { configured: true, hasApiKey: true, provider: 'openai_compatible' },
        placeLookup: { configured: true, hasGooglePlacesKey: true, provider: 'google_places' },
        routeOrder: { configured: true, hasGoogleRoutesKey: true, provider: 'google' },
        routePreview: { configured: true, hasOpenRouteServiceApiKey: true, provider: 'openrouteservice' },
        travelSearch: { configured: true, hasApiKey: true, provider: 'tavily' },
      },
      retrievedAt: '2026-06-02T01:02:03.000Z',
    })

    const text = JSON.stringify(response)
    expect(text).not.toContain('shared-google-secret-value')
    expect(text).not.toContain('ors-secret-value')
    expect(text).not.toContain('ai-secret-value')
    expect(text).not.toContain('search-secret-value')
    expect(text).not.toContain('vite-google-secret-value')
    expect(text).not.toContain('Authorization')
    expect(text).not.toContain('Bearer')
    expect(text).not.toContain('TRIPMAP_SEARCH_API_KEY')
  })

  it('reports missing provider env as unconfigured', () => {
    const response = buildProviderProxyDiagnosticsResponse({}, '2026-06-02T01:02:03.000Z')

    expect(response.googleMaps).toEqual({
      hasGoogleMapsPlatformApiKey: false,
      hasGoogleRoutesApiKey: false,
      hasTripmapGooglePlacesApiKey: false,
      hasViteGoogleMapsApiKey: false,
    })
    expect(response.providers.travelSearch).toMatchObject({ configured: false, hasApiKey: false, provider: 'unconfigured' })
    expect(response.providers.placeLookup).toMatchObject({ configured: false, hasGooglePlacesKey: false, provider: 'unconfigured' })
    expect(response.providers.routeOrder).toMatchObject({ configured: false, hasGoogleRoutesKey: false, provider: 'unconfigured' })
    expect(response.providers.ai).toMatchObject({ configured: false, hasApiKey: false, provider: 'unconfigured' })
  })

  it('detects the shared Vite Google Maps key for Places and Routes', () => {
    const response = buildProviderProxyDiagnosticsResponse({
      VITE_GOOGLE_MAPS_API_KEY: 'vite-google-secret-value',
    }, '2026-06-02T01:02:03.000Z')

    expect(response.googleMaps.hasViteGoogleMapsApiKey).toBe(true)
    expect(response.providers.placeLookup).toMatchObject({
      configured: true,
      defaultedToGooglePlaces: true,
      provider: 'google_places',
    })
    expect(response.providers.routeOrder).toMatchObject({
      configured: true,
      provider: 'google',
    })
  })

  it('reports search and AI keys without implying full configuration', () => {
    const response = buildProviderProxyDiagnosticsResponse({
      TRIPMAP_AI_API_KEY: 'ai-secret-value',
      TRIPMAP_AI_PROVIDER: 'openai_compatible',
      TRIPMAP_SEARCH_API_KEY: 'search-secret-value',
      TRIPMAP_SEARCH_PROVIDER: 'tavily',
    }, '2026-06-02T01:02:03.000Z')

    expect(response.providers.travelSearch).toMatchObject({ configured: true, hasApiKey: true, provider: 'tavily' })
    expect(response.providers.ai).toMatchObject({
      configured: false,
      hasApiKey: true,
      hasBaseUrl: false,
      hasModel: false,
      provider: 'openai_compatible',
    })
  })
})
