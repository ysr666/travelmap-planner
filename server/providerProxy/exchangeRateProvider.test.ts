import { describe, expect, it, vi } from 'vitest'
import { fetchFrankfurterExchangeRates } from './exchangeRateProvider'

describe('Frankfurter exchange rate provider', () => {
  it('uses the latest available date not after the requested date', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { base: 'JPY', date: '2026-04-03', quote: 'CNY', rate: 0.05 },
      { base: 'JPY', date: '2026-04-03', quote: 'USD', rate: 0.0067 },
    ]), { status: 200 })) as unknown as typeof fetch
    const result = await fetchFrankfurterExchangeRates({ baseCurrency: 'JPY', operation: 'exchange_rate', quoteCurrencies: ['CNY', 'USD'], requestedDate: '2026-04-05' }, fetcher)
    expect(result).toMatchObject({ ok: true, response: { effectiveDate: '2026-04-03', rates: [{ quoteCurrency: 'CNY', rate: '0.05' }, { quoteCurrency: 'USD', rate: '0.0067' }] } })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fails closed when a requested quote is missing', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ date: '2026-04-03', quote: 'CNY', rate: 0.05 }]), { status: 200 })) as unknown as typeof fetch
    await expect(fetchFrankfurterExchangeRates({ baseCurrency: 'JPY', operation: 'exchange_rate', quoteCurrencies: ['CNY', 'USD'], requestedDate: '2026-04-05' }, fetcher)).resolves.toEqual({ errorCode: 'provider_unavailable', ok: false })
  })
})
