export const MAP_STYLES = {
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  positron: 'https://tiles.openfreemap.org/styles/positron',
  bright: 'https://tiles.openfreemap.org/styles/bright',
}

export const DEFAULT_MAP_STYLE = MAP_STYLES.positron
export const FALLBACK_MAP_STYLE = MAP_STYLES.liberty
export const TRIP_PREVIEW_MAP_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [
    {
      id: 'trip-preview-background',
      type: 'background',
      paint: {
        'background-color': '#eef3f8',
      },
    },
    {
      id: 'carto-light',
      type: 'raster',
      source: 'carto',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
} as const
export const EMPTY_MAP_STYLE = {
  version: 8,
  sources: {},
  layers: [],
} as const
