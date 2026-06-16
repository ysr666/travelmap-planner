import { describe, expect, it } from 'vitest'
import { onRequest } from './provider-proxy-diagnostics'

describe('provider proxy diagnostics function', () => {
  it('serves safe diagnostics over GET without provider calls', async () => {
    const response = await onRequest({
      env: {
        TRIPMAP_PROVIDER_PROXY_ALLOWED_ORIGINS: 'https://tripmap.example',
        VITE_GOOGLE_MAPS_API_KEY: 'vite-google-secret-value',
      },
      request: new Request('https://tripmap.example/api/provider-proxy-diagnostics', {
        headers: { Origin: 'https://tripmap.example' },
        method: 'GET',
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://tripmap.example')
    const text = await response.text()
    expect(text).not.toContain('vite-google-secret-value')
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      operation: 'provider_env_diagnostics',
      providers: {
        placeLookup: { configured: false, provider: 'unconfigured' },
        routeOrder: { configured: false, provider: 'unconfigured' },
      },
    })
  })

  it('rejects non-GET methods', async () => {
    const response = await onRequest({
      env: {},
      request: new Request('https://tripmap.example/api/provider-proxy-diagnostics', { method: 'POST' }),
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toContain('GET')
  })
})
