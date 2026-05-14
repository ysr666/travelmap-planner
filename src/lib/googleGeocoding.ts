import { isGoogleMapsAvailable } from './googleMaps'

export type GeocodeResult = {
  lat: number
  lng: number
  formattedAddress?: string
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!isGoogleMapsAvailable() || !address.trim()) {
    return null
  }

  const geocoder = new google.maps.Geocoder()
  try {
    const response = await geocoder.geocode({ address: address.trim() })
    const result = response.results[0]
    if (!result?.geometry?.location) {
      return null
    }

    return {
      lat: result.geometry.location.lat(),
      lng: result.geometry.location.lng(),
      formattedAddress: result.formatted_address,
    }
  } catch {
    return null
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!isGoogleMapsAvailable()) {
    return null
  }

  const geocoder = new google.maps.Geocoder()
  try {
    const response = await geocoder.geocode({ location: { lat, lng } })
    return response.results[0]?.formatted_address ?? null
  } catch {
    return null
  }
}
