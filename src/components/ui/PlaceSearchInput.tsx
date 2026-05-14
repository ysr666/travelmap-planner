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
    if (!ready || !inputRef.current || autocompleteRef.current) {
      return
    }

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      fields: ['name', 'formatted_address', 'geometry.location'],
    })

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
  }, [ready, onPlaceSelect])

  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <input
        ref={inputRef}
        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
        onChange={(event) => onChange(event.target.value)}
        placeholder={ready ? placeholder : placeholder}
        type="text"
        value={value}
      />
      {!ready ? (
        <span className="mt-1 block text-xs text-slate-400">配置 Google Maps API 后可使用地点搜索</span>
      ) : null}
    </label>
  )
}
