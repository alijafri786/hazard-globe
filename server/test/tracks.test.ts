import { describe, expect, it, vi } from 'vitest'
import { createTracks, parseTrack } from '../src/tracks.js'
import type { FlightTrack } from '../src/types.js'

describe('parseTrack', () => {
  it('keeps time, lon, lat and altitude, rounded, and drops broken waypoints', () => {
    const track = parseTrack('a4c592', {
      icao24: 'a4c592',
      path: [
        [1793630617, 40.62361, -73.78421, 0, 209, false],
        [1793630632, null, -73.7915, 0, 208, false],
        [1793630673, 40.5839, -73.813, null, 208, false],
        'nonsense',
        [1793630681, 40.5774, -73.8161, 609.6, 197, false],
      ],
    })
    expect(track).toEqual({
      icao24: 'a4c592',
      points: [
        [1793630617, -73.7842, 40.6236, 0],
        [1793630673, -73.813, 40.5839, 0],
        [1793630681, -73.8161, 40.5774, 610],
      ],
    })
  })

  it('is null without at least two usable points', () => {
    expect(parseTrack('a4c592', { path: [[1, 40, -73, 0, 0, false]] })).toBeNull()
    expect(parseTrack('a4c592', null)).toBeNull()
  })
})

describe('createTracks', () => {
  const track = (icao24: string): FlightTrack => ({ icao24, points: [] })
  const DAY = 86_400_000

  it('fetches each aircraft at most once every 5 minutes', async () => {
    let t = 0
    const fetch = vi.fn(async (icao24: string) => track(icao24))
    const tracks = createTracks({ fetch, perDay: 100, now: () => t })
    await tracks('a4c592')
    await tracks('a4c592')
    t += 4 * 60_000
    await tracks('a4c592')
    expect(fetch).toHaveBeenCalledTimes(1)
    t += 60_000
    await tracks('a4c592')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops at the daily allowance until the next UTC day', async () => {
    let t = Date.UTC(2026, 10, 2, 12)
    const fetch = vi.fn(async (icao24: string) => track(icao24))
    const tracks = createTracks({ fetch, perDay: 2, now: () => t })
    expect(await tracks('000001')).not.toBeNull()
    expect(await tracks('000002')).not.toBeNull()
    expect(await tracks('000003')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(await tracks('000001')).not.toBeNull() // still cached: costs nothing
    t += DAY / 2 // past midnight UTC
    expect(await tracks('000003')).not.toBeNull()
  })

  it('is off with no allowance, and answers null when OpenSky fails', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('OpenSky 503'))
    expect(await createTracks({ fetch, perDay: 0 })('a4c592')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(await createTracks({ fetch, perDay: 5 })('a4c592')).toBeNull()
  })
})
