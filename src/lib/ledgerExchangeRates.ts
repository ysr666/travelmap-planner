import { getExchangeRateCache, putExchangeRateCache } from '../db'
import type { LedgerExchangeRateSnapshot } from '../types'
import { fetchProviderProxyExchangeRate, getProviderProxyConfig } from './providerProxyClient'
import { normalizeCurrencyCode } from './ledger'

export async function getLedgerExchangeRateSnapshot({
  baseCurrency,
  date,
  homeCurrency,
  tripCurrency,
}: {
  baseCurrency: string
  date: string
  homeCurrency: string
  tripCurrency: string
}): Promise<LedgerExchangeRateSnapshot> {
  const base = normalizeCurrencyCode(baseCurrency)
  const home = normalizeCurrencyCode(homeCurrency)
  const trip = normalizeCurrencyCode(tripCurrency)
  const quoteCurrencies = [...new Set([trip, home].filter((currency) => currency !== base))]
  if (quoteCurrencies.length === 0) {
    return {
      baseCurrency: base,
      effectiveDate: date,
      fetchedAt: new Date().toISOString(),
      homeCurrency: home,
      provider: 'frankfurter',
      rateToHome: '1',
      rateToTrip: '1',
      requestedDate: date,
      sourceUrl: 'https://api.frankfurter.dev/v2/rates',
      tripCurrency: trip,
    }
  }

  const cached = await Promise.all(quoteCurrencies.map((quote) => getExchangeRateCache(date, base, quote)))
  const cachedMap = new Map(cached.filter(Boolean).map((record) => [record!.quoteCurrency, record!]))
  const missing = quoteCurrencies.filter((quote) => !cachedMap.has(quote))
  if (missing.length > 0) {
    const config = getProviderProxyConfig()
    const response = await fetchProviderProxyExchangeRate({
      baseCurrency: base,
      operation: 'exchange_rate',
      quoteCurrencies: missing,
      requestedDate: date,
    }, config.proxyUrl ?? '/api/provider-proxy')
    await Promise.all(response.rates.map((rate) => putExchangeRateCache({
      baseCurrency: base,
      effectiveDate: response.effectiveDate,
      fetchedAt: response.fetchedAt,
      provider: 'frankfurter',
      quoteCurrency: rate.quoteCurrency,
      rate: rate.rate,
      requestedDate: date,
      sourceUrl: response.sourceUrl,
    })))
    for (const rate of response.rates) {
      cachedMap.set(rate.quoteCurrency, {
        baseCurrency: base,
        effectiveDate: response.effectiveDate,
        fetchedAt: response.fetchedAt,
        id: `${date}:${base}:${rate.quoteCurrency}`,
        provider: 'frankfurter',
        quoteCurrency: rate.quoteCurrency,
        rate: rate.rate,
        requestedDate: date,
        sourceUrl: response.sourceUrl,
        updatedAt: Date.now(),
      })
    }
  }
  const tripRecord = trip === base ? undefined : cachedMap.get(trip)
  const homeRecord = home === base ? undefined : cachedMap.get(home)
  const reference = tripRecord ?? homeRecord
  if (!reference || (trip !== base && !tripRecord) || (home !== base && !homeRecord)) {
    throw new Error('没有取得完整的历史汇率。')
  }
  return {
    baseCurrency: base,
    effectiveDate: reference.effectiveDate,
    fetchedAt: reference.fetchedAt,
    homeCurrency: home,
    provider: 'frankfurter',
    rateToHome: home === base ? '1' : homeRecord!.rate,
    rateToTrip: trip === base ? '1' : tripRecord!.rate,
    requestedDate: date,
    sourceUrl: reference.sourceUrl,
    tripCurrency: trip,
  }
}

export function buildManualLedgerExchangeRateSnapshot({
  baseCurrency,
  date,
  homeCurrency,
  rateToHome,
  rateToTrip,
  tripCurrency,
}: {
  baseCurrency: string
  date: string
  homeCurrency: string
  rateToHome: string
  rateToTrip: string
  tripCurrency: string
}): LedgerExchangeRateSnapshot {
  return {
    baseCurrency: normalizeCurrencyCode(baseCurrency),
    effectiveDate: date,
    fetchedAt: new Date().toISOString(),
    homeCurrency: normalizeCurrencyCode(homeCurrency),
    provider: 'manual',
    rateToHome,
    rateToTrip,
    requestedDate: date,
    tripCurrency: normalizeCurrencyCode(tripCurrency),
  }
}
