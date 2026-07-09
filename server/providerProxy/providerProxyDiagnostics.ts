import type { ProviderProxyHandlerEnv } from './providerProxyHandler'

export const PROVIDER_PROXY_DIAGNOSTICS_OPERATION = 'provider_env_diagnostics' as const

export type ProviderProxyDiagnosticsResponse = {
  googleMaps: {
    hasGoogleMapsPlatformApiKey: boolean
    hasGoogleRoutesApiKey: boolean
    hasTripmapGooglePlacesApiKey: boolean
    hasViteGoogleMapsApiKey: boolean
  }
  ok: true
  operation: typeof PROVIDER_PROXY_DIAGNOSTICS_OPERATION
  providers: {
    ai: {
      configured: boolean
      hasApiKey: boolean
      hasBaseUrl: boolean
      hasLegacyProviderKey: boolean
      hasModel: boolean
      provider: 'disabled' | 'mock' | 'openai_compatible' | 'unknown' | 'unconfigured'
    }
    placeLookup: {
      configured: boolean
      defaultedToGooglePlaces: boolean
      hasGooglePlacesKey: boolean
      provider: 'disabled' | 'google_places' | 'mock' | 'unknown' | 'unconfigured'
    }
    routeOrder: {
      configured: boolean
      hasGoogleRoutesKey: boolean
      provider: 'google' | 'mock' | 'unconfigured'
    }
    routePreview: {
      configured: boolean
      hasOpenRouteServiceApiKey: boolean
      provider: 'google' | 'mock' | 'openrouteservice' | 'unconfigured'
    }
    travelSearch: {
      configured: boolean
      hasApiKey: boolean
      provider: 'disabled' | 'mock' | 'tavily' | 'unknown' | 'unconfigured'
    }
  }
  retrievedAt: string
  security: {
    authConfig: {
      configured: boolean
      hasSupabaseAnonKey: boolean
      hasSupabaseUrl: boolean
    }
    authRequired: boolean
    budgetAlertsConfigured: boolean
    durableQuotaConfigured: boolean
    environment: 'development' | 'preview' | 'production'
    originEnforced: boolean
  }
}

export function buildProviderProxyDiagnosticsResponse(
  env: ProviderProxyHandlerEnv = {},
  now: Date | string = new Date(),
): ProviderProxyDiagnosticsResponse {
  const mockMode = isMockMode(env)
  const googleMaps = {
    hasGoogleMapsPlatformApiKey: hasSecret(env.GOOGLE_MAPS_PLATFORM_API_KEY),
    hasGoogleRoutesApiKey: hasSecret(env.GOOGLE_ROUTES_API_KEY),
    hasTripmapGooglePlacesApiKey: hasSecret(env.TRIPMAP_GOOGLE_PLACES_API_KEY),
    hasViteGoogleMapsApiKey: hasSecret(env.VITE_GOOGLE_MAPS_API_KEY),
  }
  const hasGoogleRoutesKey = googleMaps.hasGoogleMapsPlatformApiKey || googleMaps.hasGoogleRoutesApiKey || googleMaps.hasTripmapGooglePlacesApiKey
  const hasGooglePlacesKey = googleMaps.hasGoogleMapsPlatformApiKey || googleMaps.hasTripmapGooglePlacesApiKey
  const placeProvider = normalizePlaceProvider(env.TRIPMAP_PLACE_PROVIDER)
  const searchProvider = normalizeSearchProvider(env.TRIPMAP_SEARCH_PROVIDER)
  const aiProvider = normalizeAiProvider(env.TRIPMAP_AI_PROVIDER)
  const hasOpenRouteServiceApiKey = hasSecret(env.OPENROUTESERVICE_API_KEY)
  const environment = normalizeEnvironment(env.TRIPMAP_PROVIDER_PROXY_ENV)
  const hasSupabaseUrl = hasSecret(env.TRIPMAP_SUPABASE_URL) || hasSecret(env.VITE_SUPABASE_URL)
  const hasSupabaseAnonKey = hasSecret(env.TRIPMAP_SUPABASE_ANON_KEY) || hasSecret(env.VITE_SUPABASE_ANON_KEY)

  return {
    googleMaps,
    ok: true,
    operation: PROVIDER_PROXY_DIAGNOSTICS_OPERATION,
    providers: {
      ai: {
        configured: mockMode || aiProvider === 'mock' || (
          aiProvider === 'openai_compatible' &&
          hasSecret(env.TRIPMAP_AI_API_KEY) &&
          hasSecret(env.TRIPMAP_AI_BASE_URL) &&
          hasSecret(env.TRIPMAP_AI_MODEL)
        ),
        hasApiKey: hasSecret(env.TRIPMAP_AI_API_KEY),
        hasBaseUrl: hasSecret(env.TRIPMAP_AI_BASE_URL),
        hasLegacyProviderKey: hasSecret(env.TRIPMAP_AI_PROVIDER_KEY),
        hasModel: hasSecret(env.TRIPMAP_AI_MODEL),
        provider: mockMode ? 'mock' : aiProvider,
      },
      placeLookup: {
        configured: mockMode || placeProvider === 'mock' || (placeProvider !== 'disabled' && placeProvider !== 'unknown' && hasGooglePlacesKey),
        defaultedToGooglePlaces: !mockMode && placeProvider === 'unconfigured' && hasGooglePlacesKey,
        hasGooglePlacesKey,
        provider: mockMode ? 'mock' : placeProvider === 'unconfigured' && hasGooglePlacesKey ? 'google_places' : placeProvider,
      },
      routeOrder: {
        configured: mockMode || hasGoogleRoutesKey,
        hasGoogleRoutesKey,
        provider: mockMode ? 'mock' : hasGoogleRoutesKey ? 'google' : 'unconfigured',
      },
      routePreview: {
        configured: mockMode || hasOpenRouteServiceApiKey || hasGoogleRoutesKey,
        hasOpenRouteServiceApiKey,
        provider: mockMode ? 'mock' : hasOpenRouteServiceApiKey ? 'openrouteservice' : hasGoogleRoutesKey ? 'google' : 'unconfigured',
      },
      travelSearch: {
        configured: mockMode || searchProvider === 'mock' || (searchProvider === 'tavily' && hasSecret(env.TRIPMAP_SEARCH_API_KEY)),
        hasApiKey: hasSecret(env.TRIPMAP_SEARCH_API_KEY),
        provider: mockMode ? 'mock' : searchProvider,
      },
    },
    retrievedAt: normalizeRetrievedAt(now),
    security: {
      authConfig: {
        configured: hasSupabaseUrl && hasSupabaseAnonKey,
        hasSupabaseAnonKey,
        hasSupabaseUrl,
      },
      authRequired: environment !== 'development' || env.TRIPMAP_PROVIDER_PROXY_REQUIRE_AUTH === '1' || env.TRIPMAP_PROVIDER_PROXY_REQUIRE_AUTH === 'true',
      budgetAlertsConfigured: Boolean(env.TRIPMAP_PROVIDER_ALERT_EMAIL && hasSecret(env.TRIPMAP_PROVIDER_ALERT_FROM)),
      durableQuotaConfigured: Boolean(env.TRIPMAP_PROVIDER_QUOTA_D1),
      environment,
      originEnforced: environment !== 'development',
    },
  }
}

function normalizeEnvironment(value: unknown): ProviderProxyDiagnosticsResponse['security']['environment'] {
  return value === 'production' || value === 'preview' ? value : 'development'
}

function normalizeAiProvider(value: unknown): ProviderProxyDiagnosticsResponse['providers']['ai']['provider'] {
  const provider = normalizeProviderText(value)
  if (!provider) return 'unconfigured'
  if (provider === 'disabled' || provider === 'mock' || provider === 'openai_compatible') return provider
  return 'unknown'
}

function normalizePlaceProvider(value: unknown): ProviderProxyDiagnosticsResponse['providers']['placeLookup']['provider'] {
  const provider = normalizeProviderText(value)
  if (!provider) return 'unconfigured'
  if (provider === 'disabled' || provider === 'mock' || provider === 'google_places') return provider
  return 'unknown'
}

function normalizeSearchProvider(value: unknown): ProviderProxyDiagnosticsResponse['providers']['travelSearch']['provider'] {
  const provider = normalizeProviderText(value)
  if (!provider) return 'unconfigured'
  if (provider === 'disabled' || provider === 'mock' || provider === 'tavily') return provider
  return 'unknown'
}

function normalizeProviderText(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function hasSecret(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

function isMockMode(env: ProviderProxyHandlerEnv) {
  return env.TRIPMAP_PROVIDER_PROXY_MOCK === '1' || env.TRIPMAP_PROVIDER_PROXY_MOCK === 'true'
}

function normalizeRetrievedAt(value: Date | string) {
  return typeof value === 'string' ? value : value.toISOString()
}
