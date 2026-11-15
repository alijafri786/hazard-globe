import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEarthquakes, fetchFeed, parseQuakes, type Quake } from '../src/earthquakes.js'

// Trimmed from the real USGS M4.5+ past-week feed (15 Nov 2026), plus a quarry blast and a broken feature
const feed = JSON.parse(readFileSync(new URL('./fixtures/usgs-4.5-week.json', import.meta.url), 'utf8'))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseQuakes', () => {
  it('keeps what the globe needs from each earthquake', () => {
    const { generatedAt, quakes } = parseQuakes(feed)
    expect(generatedAt).toBe(new Date(feed.metadata.generated).toISOString())
    expect(quakes[0]).toEqual<Quake>({
      id: 'us7000tyek',
      lon: 126.2,
      lat: 9.7595,
      depthKm: 9.971,
      mag: 5.5,
      time: feed.features[0].properties.time,
      place: '9 km E of Union, Philippines',
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000tyek',
      tsunami: false,
      alert: 'green',
    })
    expect(quakes[1]).toMatchObject({ id: 'us7000txfz', tsunami: true, alert: null })
  })

  it('leaves out anything that is not an earthquake, and anything malformed', () => {
    expect(parseQuakes(feed).quakes.map((q) => q.id)).toEqual(['us7000tyek', 'us7000txfz', 'us7000tyd3'])
  })

  it('drops links that do not point at USGS, and PAGER levels it does not know', () => {
    const odd = structuredClone(feed)
    odd.features[0].properties.url = 'https://evil.example/'
    odd.features[0].properties.alert = 'purple'
    expect(parseQuakes(odd).quakes[0]).toMatchObject({ url: '', alert: null })
  })

  it('refuses anything but a feature collection', () => {
    expect(() => parseQuakes({ error: 'nope' })).toThrow('USGS')
    expect(() => parseQuakes(null)).toThrow('USGS')
  })
})

describe('fetchFeed', () => {
  it('asks USGS for the chosen feed, saying who is asking', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(feed)))
    vi.stubGlobal('fetch', fetch)
    expect((await fetchFeed('day')).quakes).toHaveLength(3)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson')
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/hazard-globe/)
  })

  it('treats an error status as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })))
    await expect(fetchFeed('week')).rejects.toThrow('USGS 503')
  })
})

describe('createEarthquakes', () => {
  it('fetches each feed at most once per 2 minutes and dates the snapshot', async () => {
    let t = Date.parse('2026-11-15T12:00:00Z')
    const fetch = vi.fn(async () => parseQuakes(feed))
    const earthquakes = createEarthquakes(fetch, () => t)

    const snapshot = await earthquakes('week')
    expect(snapshot).toMatchObject({ feed: 'week', fetchedAt: '2026-11-15T12:00:00.000Z' })
    expect(snapshot?.quakes).toHaveLength(3)
    t += 60_000
    await earthquakes('week')
    expect(fetch).toHaveBeenCalledTimes(1)
    await earthquakes('day')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('answers null when USGS has never answered', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const earthquakes = createEarthquakes(vi.fn().mockRejectedValue(new Error('USGS 503')), () => 0)
    expect(await earthquakes('day')).toBeNull()
  })
})
