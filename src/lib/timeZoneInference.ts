import { PROVIDER_PROXY_PLACE_LOOKUP_OPERATION } from './ai/providerProxyContract'
import {
  fetchProviderProxyPlaceLookup,
  getProviderProxyConfig,
  type ProviderProxyClientOptions,
} from './providerProxyClient'
import {
  getDeviceTimeZone,
  lookupTimeZoneFromCoordinates,
  normalizeTimeZone,
} from './timeZone'
import type { TimeZoneSource } from '../types'

export type TimeZoneInferenceResult = {
  source: TimeZoneSource
  timeZone: string
  warning?: string
}

export async function inferTimeZoneFromPlaceQuery(
  query: string,
  options: ProviderProxyClientOptions = {},
): Promise<TimeZoneInferenceResult> {
  const fallback = getDeviceTimeZone()
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return { source: 'device', timeZone: fallback }
  }

  const config = getProviderProxyConfig({ storage: options.storage })
  if (!config.configured || !config.proxyUrl) {
    return {
      source: 'device',
      timeZone: fallback,
      warning: '未配置地点服务，已使用设备时区。',
    }
  }

  try {
    const response = await fetchProviderProxyPlaceLookup({
      locale: 'zh-CN',
      maxResults: 1,
      operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
      query: normalizedQuery,
    }, config.proxyUrl, options)
    const location = response.results[0]?.location
    if (!location) {
      return {
        source: 'device',
        timeZone: fallback,
        warning: '未能从目的地推断时区，已使用设备时区。',
      }
    }
    const timeZone = await lookupTimeZoneFromCoordinates(location.lat, location.lng)
    const normalized = normalizeTimeZone(timeZone)
    if (!normalized) {
      return {
        source: 'device',
        timeZone: fallback,
        warning: '地点坐标未能转换为有效时区，已使用设备时区。',
      }
    }
    return { source: 'provider', timeZone: normalized }
  } catch {
    return {
      source: 'device',
      timeZone: fallback,
      warning: '时区自动推断失败，已使用设备时区。',
    }
  }
}
