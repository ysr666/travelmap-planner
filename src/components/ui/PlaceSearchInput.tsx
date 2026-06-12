import { useEffect, useRef, useState } from 'react'
import { isGoogleMapsAvailable, waitForGoogleMaps } from '../../lib/googleMaps'

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
  const [ready, setReady] = useState(isGoogleMapsAvailable)
  const [country, setCountry] = useState('')

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

  return (
    <label className="block">
      <span className="text-sm font-semibold text-on-surface">{label}</span>
      <div className="mt-2 flex gap-2">
        <select
          className="h-11 shrink-0 rounded-xl border border-outline-variant/30 bg-white px-2 text-sm text-on-surface outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-outline-variant/30 dark:bg-surface-dim/70 dark:text-on-surface dark:focus:border-sky-500 dark:focus:ring-sky-500/15"
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
          className="h-11 min-w-0 flex-1 rounded-xl border border-outline-variant/30 bg-white px-3 text-sm text-on-surface outline-none transition placeholder:text-outline-variant focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:border-outline-variant/30 dark:bg-surface-dim/70 dark:text-on-surface dark:placeholder:text-on-surface-variant dark:focus:border-sky-500 dark:focus:ring-sky-500/15"
          onChange={(event) => onChange(event.target.value)}
          placeholder={ready ? placeholder : '加载中...'}
          type="text"
          value={value}
        />
      </div>
      {!ready ? (
        <span className="mt-1 block text-xs tm-muted">正在加载 Google Maps...</span>
      ) : null}
    </label>
  )
}
