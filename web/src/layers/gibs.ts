/**
 * NASA GIBS map layers the globe offers, as GIBS's capabilities name them (checked Nov 2026). Each entry
 * is one switch in the layer list; colours and values for the key are sampled from GIBS's own colour maps
 * (gibs.earthdata.nasa.gov/colormaps/v1.3/), so the key matches the tiles without fetching anything.
 */
export const GIBS_IDS = ['rain', 'sst', 'sstAnomaly', 'seaIce'] as const
export type GibsId = (typeof GIBS_IDS)[number]

export interface GibsLayerInfo {
  label: string
  /** the tab whose controls show it */
  tab: 'weather' | 'space'
  /** sea overlays cover the same water, so only one shows at a time */
  sea: boolean
  layer: string
  tileMatrixSet: string
  /** deepest zoom GIBS serves it at; tiles beyond are magnified (IMERG is ~10 km, MUR ~1 km) */
  maximumLevel: number
  legend: { title: string; colours: readonly string[]; ends: string[] }
  /** one line on what it is, for the controls */
  about: string
}

export const GIBS: Record<GibsId, GibsLayerInfo> = {
  rain: {
    label: 'Rainfall (NASA IMERG)',
    tab: 'weather',
    sea: false,
    layer: 'IMERG_Precipitation_Rate',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    maximumLevel: 6,
    legend: {
      title: 'Rainfall, mm an hour (day average)',
      colours: ['#00764e', '#00a209', '#68cb00', '#f7d900', '#ff6522', '#f30000', '#960000', '#330000'],
      ends: ['0.1', '1.5', '9', '50+'],
    },
    about: 'Rain and snow from satellites, averaged over a day, about 10 km across.',
  },
  sst: {
    label: 'Sea temperature',
    tab: 'space',
    sea: true,
    layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    maximumLevel: 7,
    legend: {
      title: 'Sea surface temperature, °C',
      colours: ['#2b001a', '#720774', '#1e2163', '#2671c2', '#19a735', '#ffd900', '#e84c00', '#6b0200'],
      ends: ['0', '9', '18', '27', '32+'],
    },
    about: 'Daily, from several satellites (GHRSST MUR). Cyclones feed on water above about 26 °C.',
  },
  sstAnomaly: {
    label: 'Sea temperature anomaly',
    tab: 'space',
    sea: true,
    layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    maximumLevel: 7,
    legend: {
      title: 'Sea temperature against normal, °C',
      colours: ['#6b00db', '#2264f1', '#2fffce', '#bff4a3', '#f9f88d', '#ff9100', '#f3002d', '#800000'],
      ends: ['−3', '0', '+3'],
    },
    about: 'How much warmer or cooler than usual for the date. Unusually warm water can strengthen storms.',
  },
  seaIce: {
    label: 'Sea ice',
    tab: 'space',
    sea: true,
    layer: 'GHRSST_L4_MUR_Sea_Ice_Concentration',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    maximumLevel: 7,
    legend: {
      title: 'Sea ice cover, %',
      colours: ['#111111', '#ea00ea', '#1500ff', '#00f7ff', '#00b115', '#e1f500', '#ff1c00', '#ffffff'],
      ends: ['0', '50', '100'],
    },
    about: 'How much of the sea is covered by ice, daily (GHRSST MUR).',
  },
}

export const GIBS_URL = 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api'
