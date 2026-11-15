import { describe, expect, it, vi } from 'vitest'
import { createFires, fireItems, inBox, parseCsv, snapshot, type Detection } from '../src/fires.js'
import { makeArea } from './fixtures.js'

// FIRMS's VIIRS NRT columns, as its API documents them (not recorded: the API needs a map key)
const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight'
const row = (lat: number, lon: number, time: string, conf: string, frp: number, dn = 'D') =>
  `${lat},${lon},330.1,0.39,0.36,${time.slice(0, 10)},${time.slice(11, 13)}${time.slice(14, 16)},N20,VIIRS,${conf},2.0NRT,295.2,${frp},${dn}`
const NOW = Date.parse('2026-11-15T12:00:00Z')
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

const det = (lat: number, lon: number, hoursAgo: number, frp = 5, confidence: Detection['confidence'] = 'nominal'): Detection => ({
  lat,
  lon,
  time: NOW - hoursAgo * 3_600_000,
  frp,
  confidence,
  satellite: 'N20',
  day: true,
})

describe('parseCsv', () => {
  it('keeps confident detections with their time, power and satellite', () => {
    const csv = [HEADER, row(-12.5, 130.5, '2026-11-15T04:12', 'n', 5.3), row(-12.6, 130.6, '2026-11-15T04:12', 'h', 41, 'N')].join('\n')
    expect(parseCsv(csv)).toEqual([
      { lat: -12.5, lon: 130.5, time: Date.parse('2026-11-15T04:12:00Z'), frp: 5.3, confidence: 'nominal', satellite: 'N20', day: true },
      { lat: -12.6, lon: 130.6, time: Date.parse('2026-11-15T04:12:00Z'), frp: 41, confidence: 'high', satellite: 'N20', day: false },
    ])
  })

  it('leaves out low-confidence and malformed rows, and reads a short time as HHMM', () => {
    const csv = [HEADER, row(1, 1, '2026-11-15T04:12', 'l', 9), '1,2,3', row(91, 1, '2026-11-15T04:12', 'n', 9), HEADER.replace(/.*/, '') || ''].join('\n')
    expect(parseCsv(csv)).toEqual([])
    expect(parseCsv([HEADER, '5,5,330,0.4,0.4,2026-11-15,12,N20,VIIRS,n,2.0NRT,295,3,D'].join('\n'))[0].time).toBe(
      Date.parse('2026-11-15T00:12:00Z'),
    )
  })

  it('refuses FIRMS’s plain-text errors', () => {
    expect(() => parseCsv('Invalid MAP_KEY.')).toThrow('FIRMS: Invalid MAP_KEY.')
    expect(parseCsv('')).toEqual([])
  })
})

describe('inBox', () => {
  const s = snapshot([det(10.5, 20.5, 1, 9), det(10.6, 20.6, 1, 50), det(40, 20, 1), det(5, 179.5, 1), det(5, -179.5, 1)], NOW)

  it('finds the detections in a small box, strongest first', () => {
    expect(inBox(s, [20, 10, 21, 11])!.map((d) => d.frp)).toEqual([50, 9])
  })

  it('works across the date line', () => {
    expect(inBox(s, [179, 4, -179, 6])).toHaveLength(2)
  })

  it('refuses a box bigger than 10° by 10°', () => {
    expect(inBox(s, [0, 0, 20, 5])).toBeNull()
    expect(inBox(s, [0, 0, 5, 20])).toBeNull()
  })

  it('counts every detection on the heat map’s grid', () => {
    expect(s.grid.reduce((a, b) => a + b, 0)).toBe(5)
  })
})

describe('fireItems', () => {
  const area = [makeArea({ label: 'Darwin' })]

  it('makes an Orange item of three detections in 12 hours in one ~11 km cell, keyed by cell and day', () => {
    const s = snapshot([det(-12.51, 130.51, 1), det(-12.52, 130.52, 2), det(-12.53, 130.53, 3)], NOW)
    const [item, ...rest] = fireItems(s, new Set(), NOW)
    expect(rest).toEqual([])
    expect(item).toMatchObject({ hazard: 'HS', level: 'Orange', key: expect.stringMatching(/^HS-.+-2026-11-15$/) })
    expect(item.lat).toBeCloseTo(-12.52)
    expect(item.payload(area).title).toBe('Fire seen near Darwin')
    expect(item.payload(area).body).toContain('3 hot spots seen by satellite in the last 12 hours')
  })

  it('makes one of a single big, confident fire; Red from 10 detections or 500 MW', () => {
    expect(fireItems(snapshot([det(0, 0, 1, 120, 'high')], NOW), new Set(), NOW)).toHaveLength(1)
    expect(fireItems(snapshot([det(0, 0, 1, 120, 'nominal')], NOW), new Set(), NOW)).toHaveLength(0)
    const many = snapshot(Array.from({ length: 10 }, (_, i) => det(0.001 * i, 0, 1)), NOW)
    expect(fireItems(many, new Set(), NOW)[0].level).toBe('Red')
  })

  it('leaves out detections older than 12 hours, and cells that burn every day', () => {
    expect(fireItems(snapshot([det(0, 0, 13), det(0, 0, 14), det(0, 0, 15)], NOW), new Set(), NOW)).toEqual([])
    const flare = snapshot([det(0.01, 0.01, 1), det(0.02, 0.02, 1), det(0.03, 0.03, 1)], NOW)
    expect(fireItems(flare, new Set(['0:0']), NOW)).toEqual([])
  })
})

describe('createFires', () => {
  const csv = [HEADER, row(-12.5, 130.5, at(1), 'n', 5), row(-12.5, 130.51, at(1), 'n', 6), row(-12.5, 130.52, at(2), 'n', 7)].join('\n')

  it('asks FIRMS for both satellites’ last day, once per 30 minutes', async () => {
    let t = NOW
    const fetchText = vi.fn(async (_url: string) => csv)
    const fires = createFires({ mapKey: 'k e y', fetchText, now: () => t })
    const grid = (await fires.grid())!
    expect(grid).toMatchObject({ count: 6, cols: 1440, rows: 720 })
    expect(Buffer.from(grid.data, 'base64')).toHaveLength(1440 * 720 * 2)
    expect(fetchText.mock.calls.map(([u]) => u)).toEqual([
      'https://firms.modaps.eosdis.nasa.gov/api/area/csv/k%20e%20y/VIIRS_NOAA20_NRT/world/1',
      'https://firms.modaps.eosdis.nasa.gov/api/area/csv/k%20e%20y/VIIRS_NOAA21_NRT/world/1',
    ])
    t += 29 * 60_000
    await fires.grid()
    expect(fetchText).toHaveBeenCalledTimes(2)
  })

  it('asks FIRMS for alerts only when an area wants them', async () => {
    const fetchText = vi.fn(async (_url: string) => csv)
    const fires = createFires({ mapKey: 'k', fetchText, now: () => NOW })
    expect(await fires.items(false)).toEqual([])
    expect(fetchText).not.toHaveBeenCalled()
    expect(await fires.items(true)).toHaveLength(1)
  })
})
