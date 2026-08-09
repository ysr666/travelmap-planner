import {
  PROVIDER_PROXY_WEATHER_FORECAST_OPERATION,
  validateProviderProxyWeatherForecastSuccessResponse,
  type ProviderProxyErrorCode,
  type ProviderProxyValidatedWeatherForecastRequest,
  type ProviderProxyWeatherFact,
  type ProviderProxyWeatherForecastSuccessResponse,
} from '../../src/lib/ai/providerProxyContract'
import type { WeatherCondition } from '../../src/lib/realtime/realtimeFact'

export const OPEN_METEO_FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
export const OPEN_METEO_SOURCE_URL = 'https://open-meteo.com/en/docs'

export type WeatherProviderErrorCode = Extract<
  ProviderProxyErrorCode,
  'provider_unavailable' | 'provider_error' | 'network_error' | 'unsupported' | 'quota_exceeded' | 'invalid_response'
>

export type WeatherProviderResult =
  | { ok: true; response: ProviderProxyWeatherForecastSuccessResponse }
  | { errorCode: WeatherProviderErrorCode; message: string; ok: false }

export type WeatherProvider = {
  readonly name: string
  getForecast(request: ProviderProxyValidatedWeatherForecastRequest): Promise<WeatherProviderResult>
}

type WeatherProviderOptions = {
  now?: Date | string
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 512 * 1024
const MOCK_WARNING = '当前为模拟天气，不代表真实预报。'

export function createMockWeatherProvider(options: WeatherProviderOptions = {}): WeatherProvider {
  return {
    name: 'mock',
    async getForecast(request) {
      const retrievedAt = normalizeNow(options.now)
      const response = buildWeatherResponse({
        facts: buildMockFacts(request, retrievedAt),
        request,
        retrievedAt,
        source: 'mock',
        warnings: [MOCK_WARNING],
      })
      return response
        ? { ok: true, response }
        : { errorCode: 'invalid_response', message: 'Mock weather response was invalid.', ok: false }
    },
  }
}

export function createDisabledWeatherProvider(): WeatherProvider {
  return {
    name: 'disabled',
    async getForecast() {
      return { errorCode: 'unsupported', message: 'Weather provider is disabled.', ok: false }
    },
  }
}

export function createUnavailableWeatherProvider(): WeatherProvider {
  return {
    name: 'unavailable',
    async getForecast() {
      return { errorCode: 'provider_unavailable', message: 'Weather provider is not configured.', ok: false }
    },
  }
}

export function createOpenMeteoWeatherProvider(
  fetchImpl: typeof fetch = fetch,
  options: WeatherProviderOptions = {},
): WeatherProvider {
  return {
    name: 'open_meteo',
    async getForecast(request) {
      const now = new Date(normalizeNow(options.now))
      if (!isSupportedForecastDate(request.date, now)) {
        return { errorCode: 'unsupported', message: 'Weather date is outside the forecast window.', ok: false }
      }
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetchImpl(buildOpenMeteoUrl(request), {
          headers: { Accept: 'application/json' },
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
        })
      } catch {
        clearTimeout(timeoutId)
        return { errorCode: 'network_error', message: 'Weather provider request failed.', ok: false }
      }
      clearTimeout(timeoutId)
      if (!response.ok) {
        return {
          errorCode: response.status === 429 ? 'quota_exceeded' : response.status >= 500 ? 'provider_unavailable' : 'provider_error',
          message: 'Weather provider returned an error.',
          ok: false,
        }
      }
      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        return { errorCode: 'invalid_response', message: 'Weather response was too large.', ok: false }
      }
      let text: string
      try {
        text = await response.text()
      } catch {
        return { errorCode: 'network_error', message: 'Weather response could not be read.', ok: false }
      }
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        return { errorCode: 'invalid_response', message: 'Weather response was too large.', ok: false }
      }
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        return { errorCode: 'invalid_response', message: 'Weather provider returned invalid JSON.', ok: false }
      }
      const retrievedAt = now.toISOString()
      const facts = normalizeOpenMeteoFacts(data, request, retrievedAt)
      if (!facts) {
        return { errorCode: 'invalid_response', message: 'Weather provider returned invalid data.', ok: false }
      }
      const normalized = buildWeatherResponse({ facts, request, retrievedAt, source: 'open_meteo' })
      return normalized
        ? { ok: true, response: normalized }
        : { errorCode: 'invalid_response', message: 'Weather facts failed validation.', ok: false }
    },
  }
}

function buildOpenMeteoUrl(request: ProviderProxyValidatedWeatherForecastRequest) {
  const url = new URL(OPEN_METEO_FORECAST_ENDPOINT)
  url.searchParams.set('latitude', request.latitude.toFixed(6))
  url.searchParams.set('longitude', request.longitude.toFixed(6))
  url.searchParams.set('timezone', request.timeZone)
  url.searchParams.set('start_date', request.date)
  url.searchParams.set('end_date', request.date)
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max')
  if (request.includeCurrent) {
    url.searchParams.set('current', 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m')
  }
  return url.toString()
}

function normalizeOpenMeteoFacts(
  input: unknown,
  request: ProviderProxyValidatedWeatherForecastRequest,
  retrievedAt: string,
): ProviderProxyWeatherFact[] | null {
  const record = readRecord(input)
  const daily = readRecord(record.daily)
  const dates = readArray(daily.time)
  const index = dates.findIndex((date) => date === request.date)
  if (index < 0) return null
  const minCelsius = readRequiredArrayNumber(daily.temperature_2m_min, index, -100, 70)
  const maxCelsius = readRequiredArrayNumber(daily.temperature_2m_max, index, -100, 70)
  const weatherCode = readRequiredArrayNumber(daily.weather_code, index, 0, 99)
  const precipitationInput = readArray(daily.precipitation_probability_max)[index]
  const precipitationProbability = readOptionalNumber(precipitationInput, 0, 100)
  if (
    minCelsius === null
    || maxCelsius === null
    || weatherCode === null
    || maxCelsius < minCelsius
    || (precipitationInput !== undefined && precipitationInput !== null && precipitationProbability === undefined)
  ) return null

  const condition = weatherConditionFromWmo(weatherCode)
  const facts: ProviderProxyWeatherFact[] = [{
    confidence: 'high',
    expiresAt: addMilliseconds(retrievedAt, 3 * 60 * 60_000),
    id: buildFactId('forecast', request.subject.id),
    kind: 'weather_forecast',
    observedAt: retrievedAt,
    rawRef: buildRawRef('open_meteo', 'forecast', request.subject.id, request.date),
    schemaVersion: 1,
    source: { label: 'Open-Meteo', provider: 'open_meteo', url: OPEN_METEO_SOURCE_URL },
    subject: request.subject,
    tripId: request.tripId,
    value: {
      condition,
      date: request.date,
      locationName: request.locationName,
      maxCelsius,
      minCelsius,
      precipitationProbability: precipitationProbability ?? undefined,
      shortAdvice: buildWeatherAdvice(condition, precipitationProbability ?? undefined),
    },
  }]

  if (request.includeCurrent) {
    const current = readRecord(record.current)
    const temperatureCelsius = readNumber(current.temperature_2m, -100, 70)
    const currentCode = readNumber(current.weather_code, 0, 99)
    if (temperatureCelsius === null || currentCode === null) return null
    const apparentTemperatureCelsius = readOptionalNumber(current.apparent_temperature, -120, 80)
    const currentPrecipitationProbability = readOptionalNumber(current.precipitation_probability, 0, 100)
    const windKph = readOptionalNumber(current.wind_speed_10m, 0, 500)
    if (
      hasInvalidOptionalNumber(current.apparent_temperature, apparentTemperatureCelsius)
      || hasInvalidOptionalNumber(current.precipitation_probability, currentPrecipitationProbability)
      || hasInvalidOptionalNumber(current.wind_speed_10m, windKph)
    ) return null
    facts.unshift({
      confidence: 'high',
      expiresAt: addMilliseconds(retrievedAt, 30 * 60_000),
      id: buildFactId('current', request.subject.id),
      kind: 'weather_current',
      observedAt: retrievedAt,
      rawRef: buildRawRef('open_meteo', 'current', request.subject.id, retrievedAt.slice(0, 13)),
      schemaVersion: 1,
      source: { label: 'Open-Meteo', provider: 'open_meteo', url: OPEN_METEO_SOURCE_URL },
      subject: request.subject,
      tripId: request.tripId,
      value: {
        apparentTemperatureCelsius,
        condition: weatherConditionFromWmo(currentCode),
        locationName: request.locationName,
        precipitationProbability: currentPrecipitationProbability,
        temperatureCelsius,
        windKph,
      },
    })
  }
  return facts
}

function buildMockFacts(
  request: ProviderProxyValidatedWeatherForecastRequest,
  retrievedAt: string,
): ProviderProxyWeatherFact[] {
  const forecast: ProviderProxyWeatherFact = {
    confidence: 'low',
    expiresAt: addMilliseconds(retrievedAt, 3 * 60 * 60_000),
    id: buildFactId('forecast', request.subject.id),
    kind: 'weather_forecast',
    observedAt: retrievedAt,
    rawRef: buildRawRef('mock_weather', 'forecast', request.subject.id, request.date),
    schemaVersion: 1,
    source: { label: '模拟天气', provider: 'mock_weather' },
    subject: request.subject,
    tripId: request.tripId,
    value: {
      condition: 'partly_cloudy',
      date: request.date,
      locationName: request.locationName,
      maxCelsius: 22,
      minCelsius: 16,
      precipitationProbability: 20,
    },
  }
  if (!request.includeCurrent) return [forecast]
  return [{
    confidence: 'low',
    expiresAt: addMilliseconds(retrievedAt, 30 * 60_000),
    id: buildFactId('current', request.subject.id),
    kind: 'weather_current',
    observedAt: retrievedAt,
    rawRef: buildRawRef('mock_weather', 'current', request.subject.id, retrievedAt.slice(0, 13)),
    schemaVersion: 1,
    source: { label: '模拟天气', provider: 'mock_weather' },
    subject: request.subject,
    tripId: request.tripId,
    value: {
      apparentTemperatureCelsius: 17,
      condition: 'partly_cloudy',
      locationName: request.locationName,
      precipitationProbability: 20,
      temperatureCelsius: 17,
      windKph: 12,
    },
  }, forecast]
}

function buildWeatherResponse(input: {
  facts: ProviderProxyWeatherFact[]
  request: ProviderProxyValidatedWeatherForecastRequest
  retrievedAt: string
  source: ProviderProxyWeatherForecastSuccessResponse['source']
  warnings?: string[]
}) {
  return validateProviderProxyWeatherForecastSuccessResponse({
    facts: input.facts,
    ok: true,
    operation: PROVIDER_PROXY_WEATHER_FORECAST_OPERATION,
    requestId: input.request.requestId,
    retrievedAt: input.retrievedAt,
    source: input.source,
    warnings: input.warnings,
  }, input.request)
}

function weatherConditionFromWmo(code: number): WeatherCondition {
  if (code === 0) return 'clear'
  if (code === 1) return 'mainly_clear'
  if (code === 2) return 'partly_cloudy'
  if (code === 3) return 'overcast'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 61 && code <= 67) || code === 80 || code === 81 || code === 82) return code >= 80 ? 'showers' : 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95 && code <= 99) return 'thunderstorm'
  return 'unknown'
}

function buildWeatherAdvice(condition: WeatherCondition, precipitationProbability?: number) {
  if (condition === 'thunderstorm') return '留意雷暴预警'
  if (condition === 'snow') return '留意积雪与低温'
  if (condition === 'rain' || condition === 'showers' || condition === 'drizzle' || (precipitationProbability ?? 0) >= 50) return '随身带雨具'
  return undefined
}

function isSupportedForecastDate(date: string, now: Date) {
  const target = Date.parse(`${date}T00:00:00Z`)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const differenceDays = Math.floor((target - today) / 86_400_000)
  return differenceDays >= 0 && differenceDays <= 15
}

function normalizeNow(input?: Date | string) {
  const timestamp = input instanceof Date ? input.getTime() : input ? Date.parse(input) : Date.now()
  return new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString()
}

function addMilliseconds(iso: string, milliseconds: number) {
  return new Date(Date.parse(iso) + milliseconds).toISOString()
}

function buildFactId(kind: string, subjectId: string) {
  return `fact_weather_${kind}_${controlledPart(subjectId)}`.slice(0, 160)
}

function buildRawRef(provider: 'mock_weather' | 'open_meteo', kind: string, subjectId: string, suffix: string) {
  return `${provider}:${kind}:${controlledPart(subjectId)}:${controlledPart(suffix)}`.slice(0, 240)
}

function controlledPart(input: string) {
  return input.replace(/[^A-Za-z0-9:_-]/g, '_').replace(/^_+/, '').slice(0, 100) || 'unknown'
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
}

function readArray(input: unknown) {
  return Array.isArray(input) ? input : []
}

function readNumber(input: unknown, minimum: number, maximum: number) {
  return typeof input === 'number' && Number.isFinite(input) && input >= minimum && input <= maximum ? input : null
}

function readOptionalNumber(input: unknown, minimum: number, maximum: number) {
  return input === undefined || input === null ? undefined : readNumber(input, minimum, maximum) ?? undefined
}

function readRequiredArrayNumber(input: unknown, index: number, minimum: number, maximum: number) {
  const values = readArray(input)
  return readNumber(values[index], minimum, maximum)
}

function hasInvalidOptionalNumber(input: unknown, normalized: number | undefined) {
  return input !== undefined && input !== null && normalized === undefined
}
