import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createDart, parseReadings, parseStations } from '../src/dart.js'

// Recorded from NOAA NDBC on 15 Nov 2026: four DART stations (one with data) and that buoy's file
const stations = readFileSync(new URL('./fixtures/ndbc-stations.xml', import.meta.url), 'utf8')
const buoy = readFileSync(new URL('./fixtures/ndbc-21415.dart', import.meta.url), 'utf8')
const NOW = Date.parse('2026-11-15T18:30:00Z')

describe('parseStations', () => {
  it('keeps the DART buoys that have data, and nothing else', () => {
    expect(parseStations(stations)).toEqual([{ id: '21415', name: 'ATTU - 175 NM South of Attu, AK', lat: 50.12, lon: 171.867 }])
  })
})

describe('parseReadings', () => {
  it('gives the last day of water heights, oldest first, at 15 minutes: not in event mode', () => {
    const r = parseReadings('21415', buoy, NOW)
    expect(r.eventMode).toBe(false)
    expect(r.readings.at(-1)).toEqual({ time: '2026-11-15T18:00:00.000Z', heightM: 4717.998 })
    expect(r.readings[0].time >= '2026-11-14T18:30:00.000Z').toBe(true)
    expect(r.readings.every((x, i) => i === 0 || x.time > r.readings[i - 1].time)).toBe(true)
  })

  it('is in event mode when it has reported every minute or 15 seconds in the last 6 hours', () => {
    const triggered = '2026 11 15 18 05 00 2 4718.120\n' + buoy
    expect(parseReadings('21415', triggered, NOW).eventMode).toBe(true)
    expect(parseReadings('21415', triggered, NOW + 7 * 3_600_000).eventMode).toBe(false)
  })

  it('skips lines that are not readings', () => {
    expect(parseReadings('21415', '#YY MM\n2026 11 15 18 00 00 1 n/a\n2026 11 15 18 00 00 1 99999\n', NOW).readings).toEqual([])
  })
})

describe('createDart', () => {
  it('fetches a buoy’s readings only for a buoy in the list', async () => {
    const fetch = vi.fn(async (url: string) => (url.endsWith('activestations.xml') ? stations : buoy))
    const dart = createDart(fetch, () => NOW)
    expect((await dart.readings('21415'))?.readings.length).toBeGreaterThan(50)
    expect(await dart.readings('99999')).toBeNull()
    expect(fetch.mock.calls.map(([u]) => u)).toEqual([
      'https://www.ndbc.noaa.gov/activestations.xml',
      'https://www.ndbc.noaa.gov/data/realtime2/21415.dart',
    ])
  })
})
