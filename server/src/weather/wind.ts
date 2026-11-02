import { USER_AGENT } from '../gdacs.js'
import type { WindGrid } from '../types.js'
import { decodeGrib2 } from './grib2.js'

/**
 * Wind 10 m above the ground, worldwide, from NOAA's GFS model (public domain), for the wind animation.
 * NOMADS's filter sends just the two fields on the 1° grid (~160 KB). The run used is the newest one likely
 * published (GFS starts every 6 hours and takes about 4 to appear), at the 3-hourly step nearest now.
 */
const FILTER = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl'
const HOUR = 3_600_000
const PUBLISHED_AFTER_MS = 4 * HOUR
const TIMEOUT_MS = 60_000
/** Between tries when a run isn't there yet or NOMADS fails */
const RETRY_MS = 15 * 60_000

export interface Choice {
  run: Date
  forecastHours: number
}

const runOf = (t: number) => new Date(Math.floor(t / (6 * HOUR)) * 6 * HOUR)
/** The forecast step (0, 3, 6 …) nearest to `t` for a run */
const stepFor = (run: Date, t: number) => Math.max(0, Math.round((t - run.getTime()) / (3 * HOUR)) * 3)

/** The newest run likely out by now, and the one before in case it isn't yet */
export function choices(now: number): Choice[] {
  const latest = runOf(now - PUBLISHED_AFTER_MS)
  const previous = new Date(latest.getTime() - 6 * HOUR)
  return [latest, previous].map((run) => ({ run, forecastHours: stepFor(run, now) }))
}

export function filterUrl({ run, forecastHours }: Choice): string {
  const day = run.toISOString().slice(0, 10).replaceAll('-', '')
  const hh = String(run.getUTCHours()).padStart(2, '0')
  const params = new URLSearchParams({
    dir: `/gfs.${day}/${hh}/atmos`,
    file: `gfs.t${hh}z.pgrb2.1p00.f${String(forecastHours).padStart(3, '0')}`,
    var_UGRD: 'on',
    var_VGRD: 'on',
    lev_10_m_above_ground: 'on',
  })
  return `${FILTER}?${params}`
}

/**
 * Decoded into a grid north to south and west to east from 180°W to 180°E, as Cesium measures longitude
 * (GFS starts at 0°), with 180° at both edges so it wraps without a seam.
 */
export function toWindGrid(grib: Uint8Array, choice: Choice): WindGrid {
  const fields = decodeGrib2(grib)
  const find = (parameter: number) => {
    const f = fields.find((x) => x.discipline === 0 && x.category === 2 && x.parameter === parameter)
    if (!f) throw new Error(`GFS file has no ${parameter === 2 ? 'U' : 'V'} wind`)
    const { ni, nj, la1, lo1, di, dj, scanMode } = f.grid
    if (ni !== 360 || nj !== 181 || la1 !== 90 || lo1 !== 0 || di !== 1 || dj !== 1 || scanMode !== 0) {
      throw new Error('GFS wind is not on the expected 1° grid')
    }
    return f.values
  }
  const wrap = (values: Float32Array) => {
    const out: number[] = []
    for (let row = 0; row < 181; row++) {
      for (let lon = -180; lon <= 180; lon++) out.push(Math.round(values[row * 360 + ((lon + 360) % 360)] * 10) / 10)
    }
    return out
  }
  return {
    run: choice.run.toISOString(),
    validTime: new Date(choice.run.getTime() + choice.forecastHours * HOUR).toISOString(),
    width: 361,
    height: 181,
    bounds: { west: -180, east: 180, south: -90, north: 90 },
    u: wrap(find(2)),
    v: wrap(find(3)),
  }
}

async function download(choice: Choice): Promise<Uint8Array> {
  const res = await fetch(filterUrl(choice), {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`NOMADS ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * The latest wind, fetched when first asked for and again once a nearer forecast step or a newer run is due.
 * While that refresh runs, or if it fails, the last good grid is served.
 */
export function createWind(fetchGrib: typeof download = download, now = Date.now) {
  let grid: WindGrid | null = null
  let gridKey = ''
  let nextAttemptAt = 0
  let inflight: Promise<void> | null = null

  const keyOf = (c: Choice) => `${c.run.toISOString()}+${c.forecastHours}`

  async function refresh() {
    const [latest, ...older] = choices(now())
    for (const choice of [latest, ...older]) {
      try {
        const next = toWindGrid(await fetchGrib(choice), choice)
        grid = next
        gridKey = keyOf(choice)
        console.log(`[wind] GFS ${next.run} +${choice.forecastHours}h`)
        // Settled for an older run: the newest isn't out yet, so give it a while before asking again
        if (choice !== latest) nextAttemptAt = now() + RETRY_MS
        return
      } catch (err) {
        console.error(`[wind] GFS ${choice.run.toISOString()} +${choice.forecastHours}h:`, (err as Error).message)
      }
    }
    nextAttemptAt = now() + RETRY_MS
  }

  return async function wind(): Promise<WindGrid | null> {
    const due = keyOf(choices(now())[0]) !== gridKey && now() >= nextAttemptAt
    if (due && !inflight) {
      inflight = refresh().finally(() => {
        inflight = null
      })
    }
    if (!grid && inflight) await inflight
    return grid
  }
}
