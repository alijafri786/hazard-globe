import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSpaceWeather, parseOvation, parseSummary } from '../src/spaceWeather.js'

// Trimmed from SWPC's files of 15 Nov 2026
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const ovation = fixture('swpc-ovation.json')
const kpForecast = fixture('swpc-kp-forecast.json')
const scales = fixture('swpc-scales.json')

const cell = (bytes: Uint8Array, lat: number, lon: number) =>
  bytes[Math.min(179, Math.floor(90 - lat)) * 360 + ((Math.floor(lon) + 180) % 360)]

afterEach(() => vi.restoreAllMocks())

describe('parseOvation', () => {
  it('lays the aurora chances out from the north-west, longitude 0 at column 180', () => {
    const { bytes, observedAt, forecastAt, cols, rows } = parseOvation(ovation)
    expect([cols, rows, bytes.length]).toEqual([360, 180, 64_800])
    expect(observedAt).toBe(ovation['Observation Time'])
    expect(forecastAt).toBe(ovation['Forecast Time'])
    expect(cell(bytes, 70, 48)).toBe(16) // [48, 70, 16]
    expect(cell(bytes, 65, 0)).toBe(4) // [0, 65, 4]
    expect(cell(bytes, -90, 0)).toBe(5) // the south pole's row is the last
    expect(cell(bytes, 10, 10)).toBe(0) // not in the file: nothing
  })

  it('puts 359°E (1°W) just west of the prime meridian, and clamps odd values', () => {
    const { bytes } = parseOvation({
      ...ovation,
      coordinates: [
        [359, 60, 40],
        [10, 60, 250],
        [10, 61, -5],
        [400, 60, 50],
        ['x', 60, 50],
      ],
    })
    expect(bytes[Math.floor(90 - 60) * 360 + 179]).toBe(40)
    expect(cell(bytes, 60, 10)).toBe(100)
    expect(cell(bytes, 61, 10)).toBe(0)
  })

  it('refuses a file with no grid or no times', () => {
    expect(() => parseOvation({})).toThrow('no aurora grid')
    expect(() => parseOvation({ coordinates: [] })).toThrow('no times')
  })
})

describe('parseSummary', () => {
  const now = Date.parse('2026-11-15T22:00:00Z')

  it('gives the latest observed Kp, the last day and the forecast, and today’s scales', () => {
    const s = parseSummary(kpForecast, scales, now)
    expect(s.now).toEqual({ time: '2026-11-15T21:00:00.000Z', kp: 1.67, observed: true }) // NOAA's estimate counts
    expect(s.kp[0].time >= '2026-11-14T22:00:00.000Z').toBe(true)
    expect(s.kp.at(-1)).toMatchObject({ time: '2026-11-18T00:00:00.000Z', observed: false })
    expect(s.kp.every((p, i) => i === 0 || p.time > s.kp[i - 1].time)).toBe(true)
    expect(s.scales).toEqual({ G: 0, S: 0, R: 0 })
  })

  it('counts NOAA’s estimate for a period still to come as forecast, not observed', () => {
    const early = Date.parse('2026-11-15T19:07:00Z') // the 21:00 value is "estimated" in the file
    const s = parseSummary(kpForecast, scales, early)
    expect(s.now?.time).toBe('2026-11-15T18:00:00.000Z')
    expect(s.kp.find((p) => p.time === '2026-11-15T21:00:00.000Z')?.observed).toBe(false)
  })

  it('gives the G level that Kp implies when the scales file is behind', () => {
    const stormy = [{ time_tag: '2026-11-15T21:00:00', kp: 7.33, observed: 'observed', noaa_scale: 'G3' }]
    expect(parseSummary(stormy, scales, now).scales.G).toBe(3)
    expect(parseSummary(stormy, null, now).scales).toEqual({ G: 3, S: 0, R: 0 })
  })

  it('refuses something other than a list of Kp values', () => {
    expect(() => parseSummary({}, scales, now)).toThrow('no Kp')
  })
})

describe('createSpaceWeather', () => {
  it('asks SWPC for each file only while someone is looking, then shares it', async () => {
    let t = Date.parse('2026-11-15T22:00:00Z')
    const fetchJson = vi.fn(async (path: string) =>
      path.includes('ovation') ? ovation : path.includes('k-index') ? kpForecast : scales,
    )
    const sw = createSpaceWeather(fetchJson, () => t)
    expect(fetchJson).not.toHaveBeenCalled()

    const aurora = (await sw.aurora())!
    expect(Buffer.from(aurora.data, 'base64')).toHaveLength(64_800)
    await sw.aurora()
    expect(fetchJson).toHaveBeenCalledTimes(1)

    expect((await sw.summary())?.now?.kp).toBe(1.67)
    expect(fetchJson.mock.calls.map(([p]) => p)).toEqual([
      '/json/ovation_aurora_latest.json',
      '/products/noaa-planetary-k-index-forecast.json',
      '/products/noaa-scales.json',
    ])
    t += 6 * 60_000 // the aurora is due again; the summary isn't
    await sw.aurora()
    await sw.summary()
    expect(fetchJson).toHaveBeenCalledTimes(4)
  })

  it('answers null when SWPC has never answered', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const sw = createSpaceWeather(vi.fn().mockRejectedValue(new Error('SWPC 503')), () => 0)
    expect(await sw.aurora()).toBeNull()
    expect(await sw.summary()).toBeNull()
  })
})
