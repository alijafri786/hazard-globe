import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { choices, createWind, filterUrl, toWindGrid, type Choice } from '../src/weather/wind.js'

const grib = new Uint8Array(readFileSync(new URL('./fixtures/gfs-wind-10m.grb2', import.meta.url)))
const at = (iso: string) => Date.parse(iso)
const show = (c: Choice) => `${c.run.toISOString().slice(11, 13)}z+${c.forecastHours}`

describe('choices', () => {
  it('picks the newest run likely published, at the 3-hourly step nearest now, and the run before', () => {
    expect(choices(at('2026-11-02T22:10:00Z')).map(show)).toEqual(['18z+3', '12z+9'])
    // 18z isn't 4 hours old yet
    expect(choices(at('2026-11-02T21:50:00Z')).map(show)).toEqual(['12z+9', '06z+15'])
    expect(choices(at('2026-11-03T04:00:00Z')).map(show)).toEqual(['00z+3', '18z+9'])
  })
})

describe('filterUrl', () => {
  it('asks NOMADS for just the 10 m wind from the 1° file', () => {
    const url = new URL(filterUrl({ run: new Date('2026-11-02T18:00:00Z'), forecastHours: 3 }))
    expect(url.origin + url.pathname).toBe('https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      dir: '/gfs.20261102/18/atmos',
      file: 'gfs.t18z.pgrb2.1p00.f003',
      var_UGRD: 'on',
      var_VGRD: 'on',
      lev_10_m_above_ground: 'on',
    })
  })
})

describe('toWindGrid', () => {
  it('lays U and V out north to south and from 180°W to 180°E, the same at both edges so there is no seam', () => {
    const grid = toWindGrid(grib, { run: new Date('2026-11-02T18:00:00Z'), forecastHours: 0 })
    expect(grid).toMatchObject({
      run: '2026-11-02T18:00:00.000Z',
      validTime: '2026-11-02T18:00:00.000Z',
      width: 361,
      height: 181,
      bounds: { west: -180, east: 180, south: -90, north: 90 },
    })
    expect(grid.u).toHaveLength(361 * 181)
    // 60°S 30°E: the Southern Ocean's westerlies (ecCodes says 8.92 m/s)
    expect(grid.u[180 + 30 + (90 + 60) * 361]).toBe(8.9)
    // 15°N 40°W, west of 0° so from the far side of GFS's grid: the north-east trades (ecCodes: -4.92, -1.15)
    const trades = 180 - 40 + (90 - 15) * 361
    expect(grid.u[trades]).toBeCloseTo(-4.92, 1)
    expect(grid.v[trades]).toBeCloseTo(-1.15, 1)
    for (let row = 0; row < 181; row += 30) expect(grid.v[row * 361 + 360]).toBe(grid.v[row * 361])
  })

  it('refuses something other than GFS wind', () => {
    expect(() => toWindGrid(new TextEncoder().encode('<html>Not found</html>'), choices(0)[0])).toThrow('not a GRIB')
  })
})

describe('createWind', () => {
  it('falls back to the previous run until the newest is out, without asking NOMADS on every request', async () => {
    let t = at('2026-11-02T22:10:00Z')
    const asked: string[] = []
    let published18z = false
    const fetchGrib = vi.fn(async (c: Choice) => {
      asked.push(show(c))
      if (c.run.getUTCHours() === 18 && !published18z) throw new Error('NOMADS 404')
      return grib
    })
    const wind = createWind(fetchGrib, () => t)

    expect((await wind())?.validTime).toBe('2026-11-02T21:00:00.000Z') // 12z+9
    expect(asked).toEqual(['18z+3', '12z+9'])
    await wind()
    t += 14 * 60_000
    await wind()
    expect(asked).toHaveLength(2)

    published18z = true
    t += 60_000
    const stale = await wind() // answered at once from the 12z grid while 18z is fetched
    expect(stale?.run).toBe('2026-11-02T12:00:00.000Z')
    await vi.waitFor(async () => expect((await wind())?.run).toBe('2026-11-02T18:00:00.000Z'))
    expect(asked).toEqual(['18z+3', '12z+9', '18z+3'])

    await wind() // up to date: nothing to fetch
    expect(asked).toHaveLength(3)
  })

  it('answers null when NOAA has never answered', async () => {
    const wind = createWind(vi.fn().mockRejectedValue(new Error('NOMADS 503')), () => at('2026-11-02T22:10:00Z'))
    expect(await wind()).toBeNull()
  })
})
