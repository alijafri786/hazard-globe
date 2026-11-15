import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildClimatology, cellsNear, readStorms, samples, type Storm, type TrackPoint } from '../src/climatology/build.js'
import { loadClimatology, type Climatology } from '../src/climatology/index.js'
import { gridSize } from '../src/climatology/model.js'

const HEADER = 'SID,SEASON,NUMBER,BASIN,SUBBASIN,NAME,ISO_TIME,NATURE,LAT,LON,WMO_WIND,WMO_PRES,WMO_AGENCY,TRACK_TYPE,USA_WIND'
const UNITS = ' ,Year, , , , , , ,degrees_north,degrees_east,kts,mb, , ,kts'
const row = (sid: string, name: string, time: string, nature: string, lat: number, lon: number, wmo: string, usa: string, track = 'main') =>
  `${sid},2020,1,NA,MM,${name},${time},${nature},${lat},${lon},${wmo}, , ,${track},${usa}`

const H = 3_600_000
const at = (h: number) => Date.UTC(2020, 8, 1) + h * H // 1 Sep 2020, plus hours
const point = (h: number, lat: number, lon: number, wind: number | null): TrackPoint => ({ time: at(h), lat, lon, wind })
const storm = (sid: string, points: TrackPoint[]): Storm => ({ sid, name: sid, points })

/** The count at a place in a built slice */
function countAt(built: ReturnType<typeof buildClimatology>, cls: string, slice: number, lat: number, lon: number) {
  const l = built.meta.layout.find((x) => x.class === cls && x.slice === slice)!
  const r = Math.floor((90 - lat) / l.res)
  const c = Math.floor((lon + 180) / l.res)
  return built.grids.readUInt16LE(l.offset + (r * l.cols + c) * 2)
}

describe('readStorms', () => {
  it('keeps tropical points on the best track, with the US wind or else the WMO one, in time order', async () => {
    const storms = await readStorms([
      HEADER,
      UNITS,
      row('A', 'ALPHA', '2020-09-01 06:00:00', 'TS', 20, -60, '40', '45'),
      row('A', 'ALPHA', '2020-09-01 00:00:00', 'TS', 19, -59, '35', ' '), // earlier, US wind missing
      row('A', 'ALPHA', '2020-09-01 09:00:00', 'ET', 21, -61, ' ', '50'), // extratropical: not the storm
      row('A', 'ALPHA', '2020-09-01 12:00:00', 'TS', 22, -62, ' ', '60', 'spur-merge'), // an agency's spur
      row('B', 'NOT_NAMED', '2020-09-02 00:00:00', 'SS', 30, 190, ' ', ' '), // subtropical, past 180°
    ])
    expect(storms.map((s) => s.sid)).toEqual(['A', 'B'])
    expect(storms[0].points).toEqual([point(0, 19, -59, 35), point(6, 20, -60, 45)])
    expect(storms[1].points[0]).toMatchObject({ lon: -170, wind: null })
  })
})

describe('samples', () => {
  it('fills in between 3-hourly points every ~25 km, interpolating wind', () => {
    const s = [...samples([point(0, 0, 0, 40), point(3, 0, 1, 60)])] // ~111 km apart
    expect(s).toHaveLength(6)
    expect(s[0].wind).toBe(40)
    expect(s.at(-1)!.wind).toBe(60)
    expect(s[2].wind).toBeCloseTo(48)
  })

  it('goes the short way across the date line', () => {
    const lons = [...samples([point(0, 0, 179.5, 50), point(3, 0, -179.5, 50)])].map((p) => p.lon)
    expect(lons.every((l) => Math.abs(l) >= 179.5)).toBe(true)
  })

  it('does not join points across a gap of more than 12 hours', () => {
    expect([...samples([point(0, 0, 0, 50), point(24, 0, 5, 50)])]).toHaveLength(2)
  })
})

describe('cellsNear', () => {
  it('finds cells within reach, on both sides of the date line', () => {
    const cells = new Set<number>()
    cellsNear(0, 179.9, 0.5, 100, cells)
    const { cols } = gridSize(0.5)
    const columns = new Set([...cells].map((c) => c % cols))
    expect(columns.has(0)).toBe(true) // 180°W
    expect(columns.has(cols - 1)).toBe(true) // 179.5°E
    // π·100² ≈ 31,400 km² over cells of ~55×55 km ≈ 3,100 km²: about 10
    expect(cells.size).toBeGreaterThanOrEqual(8)
    expect(cells.size).toBeLessThanOrEqual(16)
  })

  it('copes at the pole', () => {
    const cells = new Set<number>()
    cellsNear(89.9, 0, 0.5, 100, cells)
    expect(cells.size).toBeGreaterThan(0)
  })
})

describe('buildClimatology', () => {
  // A storm that crosses the date line at hurricane strength; a slow one that loops over the same place
  // for days; one that peaks at exactly the class thresholds
  const crosser = storm('X', [point(0, 15, 179, 70), point(3, 15, 179.8, 70), point(6, 15, -179.4, 70)])
  const looper = storm('L', Array.from({ length: 40 }, (_, i) => point(i * 3, 10 + 0.2 * Math.sin(i), 140 + 0.2 * Math.cos(i), 50)))
  const thresholds = (sid: string, kt: number, lat: number) => storm(sid, [point(0, lat, 60, kt), point(3, lat, 60.2, kt)])
  const built = buildClimatology([
    crosser,
    looper,
    thresholds('T63', 63, -20),
    thresholds('T64', 64, -25),
    thresholds('T95', 95, -30),
    thresholds('T96', 96, -35),
  ])

  it('counts a storm once per place, however long it loops there', () => {
    expect(countAt(built, 'all', 0, 10, 140)).toBe(1)
  })

  it('counts on both sides of the date line', () => {
    expect(countAt(built, 'hurricane', 0, 15, 179.9)).toBe(1)
    expect(countAt(built, 'hurricane', 0, 15, -179.9)).toBe(1)
  })

  it.each([
    ['T63', -20, [1, 0, 0]],
    ['T64', -25, [1, 1, 0]],
    ['T95', -30, [1, 1, 0]],
    ['T96', -35, [1, 1, 1]],
  ])('puts %s in the classes it reached', (_, lat, expected) => {
    expect(['all', 'hurricane', 'major'].map((cls) => countAt(built, cls, 0, lat as number, 60.1))).toEqual(expected)
  })

  it('counts by month too, on the coarser grid', () => {
    expect(countAt(built, 'all', 9, 10, 140)).toBe(1) // September
    expect(countAt(built, 'all', 8, 10, 140)).toBe(0)
  })

  it('records the period and the storms it counted', () => {
    expect(built.meta).toMatchObject({ storms: 6, from: '2020-09-01', reachKm: 100 })
    expect(built.meta.stormIndex.map((s) => s[0])).toEqual(['X', 'L', 'T63', 'T64', 'T95', 'T96'])
  })
})

describe('loadClimatology', () => {
  let dir: string
  let clim: Climatology

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'climatology-'))
    const { meta, grids, tracks } = buildClimatology([
      storm('BIG', [point(0, 25, -82, 80), point(3, 25.5, -81, 110), point(6, 26, -80, 120)]),
      storm('SMALL', [point(0, 25.5, -79.6, 40), point(3, 25.6, -79.2, 45)]), // ~70 km from Miami
      storm('FAR', [point(0, -15, 60, 100), point(3, -15.5, 61, 100)]),
    ])
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ ...meta, built: '2026-11-15T00:00:00.000Z' }))
    await writeFile(join(dir, 'grids.bin.gz'), gzipSync(grids))
    await writeFile(join(dir, 'tracks.bin.gz'), gzipSync(tracks))
    clim = (await loadClimatology(pathToFileURL(`${dir}/`)))!
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('answers null when there is nothing built', async () => {
    expect(await loadClimatology(pathToFileURL(join(dir, 'missing/')))).toBeNull()
  })

  it('serves each slice and the grid sizes, without the per-storm index', () => {
    expect(clim.grid('all', 0)!.length).toBe(720 * 360 * 2)
    expect(clim.grid('major', 12)!.length).toBe(360 * 180 * 2)
    expect(clim.meta.grids).toEqual([
      { res: 0.5, cols: 720, rows: 360 },
      { res: 1, cols: 360, rows: 180 },
    ])
    expect(clim.meta).not.toHaveProperty('stormIndex')
  })

  it('counts the storms that passed near a place, by the strongest they were there', () => {
    const miami = clim.near(-80.2, 25.8, 150)
    expect(miami).toMatchObject({ storms: 2, hurricane: 1, major: 1, peakMonths: [9] })
    expect(miami.strongest).toEqual({ name: 'BIG', year: 2020, kt: 120 })
  })

  it('catches a pass between two track points', () => {
    // BIG's points are ~100 km apart; this place is next to the segment between them, far from both ends
    expect(clim.near(-81.5, 25.25, 20).storms).toBe(1)
  })

  it('finds nothing where no storm went', () => {
    expect(clim.near(-0.1, 51.5, 300)).toMatchObject({ storms: 0, peakMonths: [], strongest: null })
  })
})
