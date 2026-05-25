import type { MapEngineAdapter } from './mapEngine'

let mapLibreAdapterPromise: Promise<MapEngineAdapter> | null = null

export function loadMapLibreAdapter(): Promise<MapEngineAdapter> {
  mapLibreAdapterPromise ??= import('./maplibreAdapter')
    .then(({ MapLibreAdapter }) => new MapLibreAdapter())
    .catch((caught: unknown) => {
      mapLibreAdapterPromise = null
      throw caught
    })

  return mapLibreAdapterPromise
}
