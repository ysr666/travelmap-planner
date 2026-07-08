import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MapPin, Search } from 'lucide-react'
import { PROVIDER_PROXY_PLACE_LOOKUP_OPERATION } from '../../lib/ai/providerProxyContract'
import { isGoogleMapsAvailable, waitForGoogleMaps } from '../../lib/googleMaps'
import {
  fetchProviderProxyPlaceLookup,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../../lib/providerProxyClient'

export type PlaceResult = {
  name: string
  address: string
  lat: number
  lng: number
}

type PlaceSearchInputProps = {
  label: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  onPlaceSelect: (place: PlaceResult) => void
}

const POPULAR_COUNTRIES = [
  { code: '', label: '不限地区' },
  { code: 'JP', label: '日本' },
  { code: 'CN', label: '中国' },
  { code: 'KR', label: '韩国' },
  { code: 'TH', label: '泰国' },
  { code: 'SG', label: '新加坡' },
  { code: 'VN', label: '越南' },
  { code: 'MY', label: '马来西亚' },
  { code: 'ID', label: '印度尼西亚' },
  { code: 'PH', label: '菲律宾' },
  { code: 'TW', label: '台湾' },
  { code: 'HK', label: '香港' },
  { code: 'MO', label: '澳门' },
  { code: 'US', label: '美国' },
  { code: 'GB', label: '英国' },
  { code: 'FR', label: '法国' },
  { code: 'DE', label: '德国' },
  { code: 'IT', label: '意大利' },
  { code: 'ES', label: '西班牙' },
  { code: 'AU', label: '澳大利亚' },
  { code: 'NZ', label: '新西兰' },
  { code: 'CA', label: '加拿大' },
]

export function PlaceSearchInput({
  label,
  placeholder = '搜索地点...',
  value,
  onChange,
  onPlaceSelect,
}: PlaceSearchInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const providerConfig = useMemo(() => getProviderProxyConfig(), [])
  const [ready, setReady] = useState(isGoogleMapsAvailable)
  const [country, setCountry] = useState('')
  const [providerResults, setProviderResults] = useState<PlaceResult[]>([])
  const [providerLookupError, setProviderLookupError] = useState<string | null>(null)
  const [providerLookupLoading, setProviderLookupLoading] = useState(false)
  const providerLookupAvailable = Boolean(providerConfig.proxyUrl)

  useEffect(() => {
    if (ready) {
      return
    }

    let disposed = false
    waitForGoogleMaps().then((loaded) => {
      if (!disposed && loaded) {
        setReady(true)
      }
    })

    return () => {
      disposed = true
    }
  }, [ready])

  useEffect(() => {
    if (!ready || !inputRef.current) {
      return
    }

    if (autocompleteRef.current) {
      google.maps.event.clearInstanceListeners(autocompleteRef.current)
      autocompleteRef.current = null
    }

    const options: google.maps.places.AutocompleteOptions = {
      fields: ['name', 'formatted_address', 'geometry.location'],
    }
    if (country) {
      options.componentRestrictions = { country }
    }

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, options)

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      const location = place.geometry?.location
      if (!location) {
        return
      }

      onPlaceSelect({
        name: place.name ?? '',
        address: place.formatted_address ?? '',
        lat: location.lat(),
        lng: location.lng(),
      })
    })

    autocompleteRef.current = autocomplete

    return () => {
      google.maps.event.clearInstanceListeners(autocomplete)
      autocompleteRef.current = null
    }
  }, [ready, country, onPlaceSelect])

  async function runProviderLookup() {
    const query = value.trim()
    if (!query || !providerConfig.proxyUrl || providerLookupLoading) {
      return
    }

    setProviderLookupLoading(true)
    setProviderLookupError(null)
    setProviderResults([])
    try {
      const response = await fetchProviderProxyPlaceLookup({
        locale: 'zh-CN',
        maxResults: 5,
        operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
        query,
        region: country || undefined,
      }, providerConfig.proxyUrl)
      const nextResults = response.results
        .filter((result) => result.location)
        .map((result) => ({
          address: result.formattedAddress,
          lat: result.location!.lat,
          lng: result.location!.lng,
          name: result.displayName,
        }))
      setProviderResults(nextResults)
      if (nextResults.length === 0) {
        setProviderLookupError('没找到候选地点。')
      }
    } catch (caught) {
      setProviderLookupError(caught instanceof ProviderProxyClientError ? caught.message : '地点查询失败。')
    } finally {
      setProviderLookupLoading(false)
    }
  }

  function selectProviderResult(result: PlaceResult) {
    onPlaceSelect(result)
    setProviderResults([])
    setProviderLookupError(null)
  }

  return (
    <label className="block">
      <span className="text-sm font-semibold text-on-surface">{label}</span>
      <div className="mt-2 flex gap-2">
        <select
          className="h-11 shrink-0 rounded-lg border border-outline-variant/70 bg-white px-2 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary-fixed dark:border-outline-variant/50 dark:bg-surface-dim/70 dark:text-on-surface dark:focus:border-primary dark:focus:ring-primary/15"
          onChange={(event) => setCountry(event.target.value)}
          value={country}
        >
          {POPULAR_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          ref={inputRef}
          className="h-11 min-w-0 flex-1 rounded-lg border border-outline-variant/70 bg-white px-3 text-sm text-on-surface outline-none transition placeholder:text-outline-variant focus:border-primary focus:ring-4 focus:ring-primary-fixed dark:border-outline-variant/50 dark:bg-surface-dim/70 dark:text-on-surface dark:placeholder:text-on-surface-variant dark:focus:border-primary dark:focus:ring-primary/15"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && providerLookupAvailable) {
              event.preventDefault()
              void runProviderLookup()
            }
          }}
          onChange={(event) => onChange(event.target.value)}
          placeholder={ready ? placeholder : '加载中...'}
          type="text"
          value={value}
        />
        {providerLookupAvailable ? (
          <button
            aria-label="查询地点"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-outline-variant/70 bg-surface text-on-surface-variant transition hover:text-primary active:scale-95 disabled:opacity-50 tm-focus"
            disabled={!value.trim() || providerLookupLoading}
            onClick={() => void runProviderLookup()}
            title="查询地点"
            type="button"
          >
            {providerLookupLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          </button>
        ) : null}
      </div>
      {providerResults.length > 0 ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-outline-variant/50 bg-surface-container">
          {providerResults.map((result) => (
            <button
              className="flex min-h-11 w-full items-start gap-2 border-b border-outline-variant/20 px-3 py-2 text-left text-sm last:border-b-0 tm-focus"
              key={`${result.name}:${result.address}:${result.lat}:${result.lng}`}
              onClick={() => selectProviderResult(result)}
              type="button"
            >
              <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-on-surface">{result.name}</span>
                <span className="block truncate text-xs tm-muted">{result.address}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {providerLookupError ? (
        <span className="mt-1 block text-xs text-error">{providerLookupError}</span>
      ) : !ready ? (
        <span className="mt-1 block text-xs tm-muted">地点服务加载中</span>
      ) : null}
    </label>
  )
}
