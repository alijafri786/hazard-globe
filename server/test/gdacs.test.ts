import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchEventGeometry, fetchEvents, fetchGeometryCollection } from '../src/gdacs.js'
import { makeEvent, square } from './fixtures.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const collection = (...features: unknown[]) => ({ type: 'FeatureCollection', features })

function mockFetch(handler: (url: URL) => Response | Promise<Response>) {
  const fn = vi.fn((input: string | URL | Request) => Promise.resolve(handler(new URL(String(input)))))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchEvents', () => {
  it('requests each alert level separately and keeps the latest episode of each event', async () => {
    mockFetch((url) => {
      const level = url.searchParams.get('alertlevel')
      if (level === 'Green') return json(collection(makeEvent({ eventid: 1, episodeid: 3, alertlevel: 'Green' })))
      if (level === 'Orange') return json(collection(makeEvent({ eventid: 1, episodeid: 5, alertlevel: 'Orange' })))
      return new Response(null, { status: 204 }) // GDACS's way of saying "no Red events"
    })

    const { features } = await fetchEvents()
    expect(features).toHaveLength(1)
    expect(features[0].properties).toMatchObject({ eventid: 1, episodeid: 5, alertlevel: 'Orange' })
  })

  it('asks for the last `days` days, defaulting to LOOKBACK_DAYS', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-30T15:00:00Z') })
    const fetch = mockFetch(() => json(collection()))
    const ranges = () => new Set(fetch.mock.calls.map(([u]) => `${new URL(String(u)).searchParams.get('fromdate')}..${new URL(String(u)).searchParams.get('todate')}`))

    await fetchEvents({ days: 30 })
    expect(ranges()).toEqual(new Set(['2026-05-31..2026-06-30']))
    fetch.mockClear()
    await fetchEvents()
    expect(ranges()).toEqual(new Set(['2026-06-20..2026-06-30'])) // config default: 10 days
  })

  it('drops hazard types it did not ask for', async () => {
    mockFetch(() => json(collection(makeEvent({ eventtype: 'EQ' as 'TC' }), makeEvent({ eventid: 2 }))))
    const { features } = await fetchEvents()
    expect(features.map((f) => f.properties.eventid)).toEqual([2])
  })

  it('keeps paging while pages come back full', async () => {
    const fetch = mockFetch((url) => {
      if (url.searchParams.get('alertlevel') !== 'Orange') return json(collection())
      const page = Number(url.searchParams.get('pageNumber'))
      const size = page === 1 ? 100 : 3
      return json(collection(...Array.from({ length: size }, (_, i) => makeEvent({ eventid: page * 1000 + i }))))
    })

    const { features } = await fetchEvents()
    expect(features).toHaveLength(103)
    const orangePages = fetch.mock.calls.filter(([u]) => String(u).includes('alertlevel=Orange'))
    expect(orangePages).toHaveLength(2)
  })

  it('retries once after a transient error', async () => {
    vi.useFakeTimers()
    let failures = 1
    mockFetch(() => (failures-- > 0 ? new Response('busy', { status: 503 }) : json(collection(makeEvent()))))

    const result = fetchEvents()
    await vi.advanceTimersByTimeAsync(3000)
    expect((await result).features).toHaveLength(1)
  })

  it('gives up when the retry fails too', async () => {
    vi.useFakeTimers()
    mockFetch(() => new Response('busy', { status: 503 }))

    const result = fetchEvents()
    const assertion = expect(result).rejects.toThrow('GDACS 503')
    await vi.advanceTimersByTimeAsync(3000)
    await assertion
  })
})

describe('fetchEventGeometry', () => {
  it('returns the geometries and caches them per episode', async () => {
    const fetch = mockFetch(() => json(collection({ type: 'Feature', properties: {}, geometry: square(0, 0, 1) })))
    expect(await fetchEventGeometry('TC', 501, 1)).toEqual([square(0, 0, 1)])
    expect(await fetchEventGeometry('TC', 501, 1)).toEqual([square(0, 0, 1)])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('treats 404 as no footprint yet', async () => {
    mockFetch(() => new Response(null, { status: 404 }))
    expect(await fetchEventGeometry('FL', 502, 1)).toEqual([])
  })

  it('asks again later when there was no footprint yet', async () => {
    let calls = 0
    const fetch = mockFetch(() =>
      ++calls === 1
        ? new Response(null, { status: 204 })
        : json(collection({ type: 'Feature', properties: {}, geometry: square(0, 0, 1) })),
    )
    expect(await fetchEventGeometry('TC', 503, 1)).toEqual([])
    expect(await fetchEventGeometry('TC', 503, 1)).toEqual([square(0, 0, 1)])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('shares its cache with the public geometry endpoint', async () => {
    const fetch = mockFetch(() => json(collection({ type: 'Feature', properties: {}, geometry: square(0, 0, 1) })))
    await fetchEventGeometry('TC', 504, 1)
    expect((await fetchGeometryCollection('TC', 504, 1))?.features).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
