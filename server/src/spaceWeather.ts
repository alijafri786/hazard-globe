import { USER_AGENT } from './gdacs.js'
import { createCachedSource } from './source.js'

/**
 * Space weather from NOAA's Space Weather Prediction Center (US government data, public domain, no key):
 * the OVATION aurora forecast and the Kp index with NOAA's storm scales. https://services.swpc.noaa.gov/
 */
const SWPC = 'https://services.swpc.noaa.gov'
const TIMEOUT_MS = 30_000

// OVATION runs every few minutes for the next half hour or so; Kp and the scales change every 3 hours
const AURORA_TTL_MS = 5 * 60_000
const SUMMARY_TTL_MS = 15 * 60_000
const FAILURE_RETRY_MS = 2 * 60_000

/**
 * Chance (%) of aurora overhead, on a 1° grid laid out like the storm climatology's: row-major from the
 * north-west, row 0 the band just south of 90°N, column 0 just east of 180°W. 360 × 180 bytes.
 */
export interface AuroraGrid {
  observedAt: string
  /** the time the forecast is for, usually 30–90 minutes after it was made */
  forecastAt: string
  cols: 360
  rows: 180
  /** base64 of the 64,800 bytes */
  data: string
}

export interface KpPoint {
  time: string
  kp: number
  /** false for NOAA's forecast */
  observed: boolean
}

export interface SpaceWeatherSummary {
  fetchedAt: string
  /** the latest observed (or estimated) Kp */
  now: KpPoint | null
  /** the last day observed and the next three forecast, 3-hourly */
  kp: KpPoint[]
  /** NOAA scales today: G geomagnetic storms, S solar radiation storms, R radio blackouts (0–5) */
  scales: { G: number; S: number; R: number }
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The OVATION file's [lon 0–359, lat −90–90, %] triples, into the 1° grid above. Anything missing stays 0. */
export function parseOvation(body: unknown): Omit<AuroraGrid, 'data'> & { bytes: Uint8Array } {
  const b = body as { 'Observation Time'?: unknown; 'Forecast Time'?: unknown; coordinates?: unknown } | null
  if (!b || !Array.isArray(b.coordinates)) throw new Error('SWPC sent no aurora grid')
  const observedAt = typeof b['Observation Time'] === 'string' ? b['Observation Time'] : ''
  const forecastAt = typeof b['Forecast Time'] === 'string' ? b['Forecast Time'] : ''
  if (Number.isNaN(Date.parse(observedAt)) || Number.isNaN(Date.parse(forecastAt))) throw new Error('SWPC aurora grid has no times')

  const bytes = new Uint8Array(360 * 180)
  for (const c of b.coordinates as unknown[]) {
    if (!Array.isArray(c)) continue
    const [lon, lat, pct] = c
    if (!num(lon) || !num(lat) || !num(pct) || lon < 0 || lon >= 360 || lat < -90 || lat > 90) continue
    // The point at whole degree (lon, lat) colours the cell south-east of it: east of 180°W by lon ± 180
    const col = (Math.floor(lon) + 180) % 360
    const row = Math.min(179, Math.floor(90 - lat))
    bytes[row * 360 + col] = Math.max(bytes[row * 360 + col], Math.min(100, Math.max(0, Math.round(pct))))
  }
  return { observedAt, forecastAt, cols: 360, rows: 180, bytes }
}

/**
 * NOAA's G level for a Kp value. Kp comes in thirds (4.67 is "5−", 5.33 is "5+"), and NOAA counts a whole
 * step from its minus: 5− is G1. So round first, then compare.
 */
export const gScale = (kp: number) => {
  const k = Math.round(kp)
  return k >= 9 ? 5 : k >= 8 ? 4 : k >= 7 ? 3 : k >= 6 ? 2 : k >= 5 ? 1 : 0
}

/**
 * NOAA's Kp file (observed, estimated and predicted, 3-hourly) and its scales file, into a summary: the
 * latest observation, the last day and the next three, and today's G, S and R levels.
 */
export function parseSummary(kpBody: unknown, scalesBody: unknown, now: number): Omit<SpaceWeatherSummary, 'fetchedAt'> {
  if (!Array.isArray(kpBody)) throw new Error('SWPC sent no Kp forecast')
  const points: KpPoint[] = []
  const labelled = new Map<string, number>() // NOAA's own G level for a period, where it gives one
  for (const r of kpBody as Record<string, unknown>[]) {
    const time = typeof r?.time_tag === 'string' ? `${r.time_tag}Z`.replace(/ZZ$/, 'Z') : ''
    if (!num(r?.kp) || Number.isNaN(Date.parse(time))) continue
    // NOAA's "estimated" can run ahead of now: a value for a period not yet begun is a forecast
    const at = Date.parse(time)
    const point = { time: new Date(at).toISOString(), kp: r.kp, observed: r.observed !== 'predicted' && at <= now }
    points.push(point)
    const g = typeof r.noaa_scale === 'string' ? /^G([0-5])$/.exec(r.noaa_scale)?.[1] : undefined
    if (g) labelled.set(point.time, Number(g))
  }
  points.sort((a, b) => a.time.localeCompare(b.time))
  const since = now - 86_400_000
  const kp = points.filter((p) => Date.parse(p.time) >= since)
  const latest = [...points].reverse().find((p) => p.observed) ?? null

  const today = (scalesBody as Record<string, Record<string, { Scale?: unknown }>> | null)?.['0']
  const scale = (k: 'G' | 'S' | 'R') => {
    const v = Number(today?.[k]?.Scale)
    return Number.isInteger(v) && v >= 0 && v <= 5 ? v : 0
  }
  // The scales file's G level, or the latest period's when the file is behind: as NOAA labels it, else from Kp
  const G = Math.max(scale('G'), latest ? (labelled.get(latest.time) ?? gScale(latest.kp)) : 0)
  return { now: latest, kp, scales: { G, S: scale('S'), R: scale('R') } }
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${SWPC}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`SWPC ${res.status} for ${path}`)
  return res.json()
}

/** Fetched from SWPC only while someone is looking, shared by everyone, the last good copy kept on failure. */
export function createSpaceWeather(fetchJson: (path: string) => Promise<unknown> = getJson, now = Date.now) {
  const aurora = createCachedSource<'aurora', AuroraGrid>({
    ttlMs: AURORA_TTL_MS,
    failureRetryMs: FAILURE_RETRY_MS,
    name: 'aurora',
    now,
    fetch: async () => {
      const { bytes, ...grid } = parseOvation(await fetchJson('/json/ovation_aurora_latest.json'))
      return { ...grid, data: Buffer.from(bytes).toString('base64') }
    },
  })
  const summary = createCachedSource<'summary', SpaceWeatherSummary>({
    ttlMs: SUMMARY_TTL_MS,
    failureRetryMs: FAILURE_RETRY_MS,
    name: 'space weather',
    now,
    fetch: async () => {
      const [kp, scales] = await Promise.all([
        fetchJson('/products/noaa-planetary-k-index-forecast.json'),
        fetchJson('/products/noaa-scales.json'),
      ])
      return { fetchedAt: new Date(now()).toISOString(), ...parseSummary(kp, scales, now()) }
    },
  })
  return { aurora: () => aurora.get('aurora'), summary: () => summary.get('summary') }
}

export type SpaceWeather = ReturnType<typeof createSpaceWeather>
