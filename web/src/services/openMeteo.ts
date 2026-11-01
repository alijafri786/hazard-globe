/**
 * Current conditions anywhere, from Open-Meteo's free forecast API (no key; CC BY 4.0; free for non-commercial
 * use). Called straight from the browser, so its per-IP limits are each visitor's own, and nothing is proxied.
 */
const FORECAST = 'https://api.open-meteo.com/v1/forecast'
export const OPEN_METEO_URL = 'https://open-meteo.com'
const CACHE_MS = 10 * 60_000
const CACHE_SIZE = 50

export interface Conditions {
  /** Grid point the model value is for, which can be a few km from where was asked */
  lon: number
  lat: number
  elevationM: number
  temperatureC: number
  feelsLikeC: number
  humidityPct: number
  windKmh: number
  /** Where the wind blows from, degrees */
  windFromDeg: number
  conditions: string
  isDay: boolean
  /** Offset of the place's local time from UTC */
  utcOffsetSeconds: number
  timezoneAbbreviation: string
}

interface Response {
  latitude: number
  longitude: number
  elevation: number
  utc_offset_seconds: number
  timezone_abbreviation: string
  current: {
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    wind_speed_10m: number
    wind_direction_10m: number
    weather_code: number
    is_day: 0 | 1
  }
}

/** WMO weather interpretation codes, as Open-Meteo documents them */
const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
}

const cache = new Map<string, { at: number; conditions: Conditions }>()

export async function currentConditions(lon: number, lat: number): Promise<Conditions> {
  // ~1 km: finer than the model grid, so nearby clicks share an answer
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.conditions

  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current:
      'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day',
    timezone: 'auto',
  })
  const res = await fetch(`${FORECAST}?${params}`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) {
    const reason = await res.json().then((b: { reason?: string }) => b.reason).catch(() => null)
    throw new Error(reason ?? `Open-Meteo answered ${res.status}`)
  }
  const body = (await res.json()) as Response
  const c = body.current
  const conditions: Conditions = {
    lon: body.longitude,
    lat: body.latitude,
    elevationM: body.elevation,
    temperatureC: c.temperature_2m,
    feelsLikeC: c.apparent_temperature,
    humidityPct: c.relative_humidity_2m,
    windKmh: c.wind_speed_10m,
    windFromDeg: c.wind_direction_10m,
    conditions: WEATHER_CODES[c.weather_code] ?? 'Unknown',
    isDay: c.is_day === 1,
    utcOffsetSeconds: body.utc_offset_seconds,
    timezoneAbbreviation: body.timezone_abbreviation,
  }

  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!)
  cache.set(key, { at: Date.now(), conditions })
  return conditions
}
