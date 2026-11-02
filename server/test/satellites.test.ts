import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSatellites, fetchGroup, parseElements } from '../src/satellites.js'
import type { OrbitalElements } from '../src/types.js'

// As CelesTrak sends it
const iss = {
  OBJECT_NAME: 'ISS (ZARYA)',
  OBJECT_ID: '1998-067A',
  EPOCH: '2026-11-02T10:25:21.580320',
  MEAN_MOTION: 15.49150046,
  ECCENTRICITY: 0.0007139,
  INCLINATION: 51.6332,
  RA_OF_ASC_NODE: 335.9757,
  ARG_OF_PERICENTER: 339.3739,
  MEAN_ANOMALY: 20.6961,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 25544,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 59318,
  BSTAR: 0.00010508,
  MEAN_MOTION_DOT: 5.374e-5,
  MEAN_MOTION_DDOT: 0,
}

describe('parseElements', () => {
  it('keeps what SGP4 needs and drops anything malformed', () => {
    const parsed = parseElements([
      iss,
      { ...iss, NORAD_CAT_ID: '25544' },
      { ...iss, MEAN_MOTION: null },
      { ...iss, MEAN_MOTION: 0 },
      { ...iss, EPOCH: 'yesterday' },
      { ...iss, EPHEMERIS_TYPE: 2 },
      { ...iss, OBJECT_NAME: undefined },
      null,
      'ISS',
    ])
    expect(parsed).toEqual([
      {
        OBJECT_NAME: 'ISS (ZARYA)',
        OBJECT_ID: '1998-067A',
        NORAD_CAT_ID: 25544,
        EPOCH: '2026-11-02T10:25:21.580320',
        MEAN_MOTION: 15.49150046,
        ECCENTRICITY: 0.0007139,
        INCLINATION: 51.6332,
        RA_OF_ASC_NODE: 335.9757,
        ARG_OF_PERICENTER: 339.3739,
        MEAN_ANOMALY: 20.6961,
        BSTAR: 0.00010508,
        MEAN_MOTION_DOT: 5.374e-5,
        MEAN_MOTION_DDOT: 0,
        ELEMENT_SET_NO: 999,
      },
    ])
  })

  it('refuses anything but a list', () => {
    expect(() => parseElements({ error: 'nope' })).toThrow('other than a list')
  })
})

describe('fetchGroup', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks CelesTrak for the group as JSON, saying who is asking', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify([iss])))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchGroup('stations')).toHaveLength(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json')
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^hazard-globe/)
  })

  it('treats CelesTrak’s plain-text answers and errors as failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('No GP data found')))
    await expect(fetchGroup('visual')).rejects.toThrow('No GP data found')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403 })))
    await expect(fetchGroup('visual')).rejects.toThrow('CelesTrak 403')
  })
})

describe('createSatellites', () => {
  const HOUR = 60 * 60_000
  const list = (n: number) => Array(n).fill(iss) as OrbitalElements[]

  it('fetches each group at most once per 2 hours, sharing a fetch between requests', async () => {
    let t = 0
    const fetch = vi.fn(async (group: string) => list(group === 'stations' ? 2 : 5))
    const satellites = createSatellites(fetch, () => t)

    const [a, b] = await Promise.all([satellites('stations'), satellites('stations')])
    expect(a).toBe(b)
    expect(a?.satellites).toHaveLength(2)
    expect(fetch).toHaveBeenCalledExactlyOnceWith('stations')

    await satellites('visual')
    t += 1.9 * HOUR
    await satellites('stations')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('serves the last good copy while refreshing and after a failed refresh, then waits before retrying', async () => {
    let t = 0
    let resolve!: (v: OrbitalElements[]) => void
    const fetch = vi
      .fn<(group: string) => Promise<OrbitalElements[]>>()
      .mockResolvedValueOnce(list(1))
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      .mockRejectedValueOnce(new Error('CelesTrak 503'))
      .mockResolvedValue(list(3))
    const satellites = createSatellites(fetch, () => t)
    expect((await satellites('gnss'))?.satellites).toHaveLength(1)

    t += 2 * HOUR // due: answered straight away from the old copy
    expect((await satellites('gnss'))?.satellites).toHaveLength(1)
    resolve(list(2))
    await vi.waitFor(async () => expect((await satellites('gnss'))?.satellites).toHaveLength(2))

    t += 2 * HOUR // this refresh fails: still the old copy
    await satellites('gnss')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect((await satellites('gnss'))?.satellites).toHaveLength(2)

    t += 9 * 60_000 // not retried for 10 minutes
    await satellites('gnss')
    expect(fetch).toHaveBeenCalledTimes(3)
    t += 60_000
    await satellites('gnss')
    await vi.waitFor(async () => expect((await satellites('gnss'))?.satellites).toHaveLength(3))
  })

  it('answers null when CelesTrak has never answered', async () => {
    const satellites = createSatellites(vi.fn().mockRejectedValue(new Error('down')), () => 0)
    expect(await satellites('active')).toBeNull()
  })
})
