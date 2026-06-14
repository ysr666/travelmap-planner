import type {
  ProviderProxyExchangeRateRequest,
  ProviderProxyExchangeRateSuccessResponse,
} from '../../src/lib/ai/providerProxyContract'

const FRANKFURTER_ENDPOINT = 'https://api.frankfurter.dev/v2/rates'

export type ExchangeRateProviderResult =
  | { ok: true; response: ProviderProxyExchangeRateSuccessResponse }
  | { ok: false; errorCode: 'network_error' | 'provider_error' | 'provider_unavailable' }

export async function fetchFrankfurterExchangeRates(
  request: ProviderProxyExchangeRateRequest,
  fetcher: typeof fetch,
): Promise<ExchangeRateProviderResult> {
  const from = subtractDays(request.requestedDate, 7)
  const url = new URL(FRANKFURTER_ENDPOINT)
  url.searchParams.set('from', from)
  url.searchParams.set('to', request.requestedDate)
  url.searchParams.set('base', request.baseCurrency)
  url.searchParams.set('quotes', request.quoteCurrencies.join(','))
  let response: Response
  try {
    response = await fetcher(url.toString(), { headers: { Accept: 'application/json' } })
  } catch {
    return { errorCode: 'network_error', ok: false }
  }
  if (!response.ok) {
    return { errorCode: response.status === 404 || response.status === 422 ? 'provider_unavailable' : 'provider_error', ok: false }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { errorCode: 'provider_error', ok: false }
  }
  if (!Array.isArray(body)) return { errorCode: 'provider_error', ok: false }
  const rows = body
    .map(parseRateRow)
    .filter((row): row is NonNullable<ReturnType<typeof parseRateRow>> => Boolean(row && row.date <= request.requestedDate))
  const effectiveDate = rows.map((row) => row.date).sort().at(-1)
  if (!effectiveDate) return { errorCode: 'provider_unavailable', ok: false }
  const byQuote = new Map(rows.filter((row) => row.date === effectiveDate).map((row) => [row.quote, row.rate]))
  if (request.quoteCurrencies.some((currency) => !byQuote.has(currency))) {
    return { errorCode: 'provider_unavailable', ok: false }
  }
  return {
    ok: true,
    response: {
      baseCurrency: request.baseCurrency,
      effectiveDate,
      fetchedAt: new Date().toISOString(),
      ok: true,
      operation: 'exchange_rate',
      provider: 'frankfurter',
      rates: request.quoteCurrencies.map((quoteCurrency) => ({ quoteCurrency, rate: byQuote.get(quoteCurrency)! })),
      requestId: request.requestId,
      requestedDate: request.requestedDate,
      sourceUrl: url.toString(),
    },
  }
}

function parseRateRow(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  if (
    typeof row.date !== 'string' ||
    typeof row.quote !== 'string' ||
    typeof row.rate !== 'number' ||
    !Number.isFinite(row.rate) ||
    row.rate <= 0
  ) return undefined
  return { date: row.date, quote: row.quote.toUpperCase(), rate: String(row.rate) }
}

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() - days)
  return value.toISOString().slice(0, 10)
}
