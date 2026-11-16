import { describe, expect, it, vi } from 'vitest'
import { createReliefWeb, isGlide, parseDisaster, parseReports } from '../src/reliefweb.js'

// Shaped as ReliefWeb's API v2 documents its answers (not recorded: the API needs an approved app name)
const disasters = (...items: object[]) => ({ totalCount: items.length, count: items.length, data: items })
const disaster = {
  id: '52345',
  score: 1,
  fields: { name: 'Philippines: Earthquake - Oct 2026', glide: 'EQ-2026-000186-PHL', url: 'https://reliefweb.int/node/52345', url_alias: 'https://reliefweb.int/disaster/eq-2026-000186-phl' },
  href: 'https://api.reliefweb.int/v2/disasters/52345',
}
const report = (n: number, extra: Record<string, unknown> = {}) => ({
  id: String(4000 + n),
  score: 1,
  fields: {
    title: `Philippines: Earthquake - Situation Report No. ${n}`,
    url: `https://reliefweb.int/node/${4000 + n}`,
    url_alias: `https://reliefweb.int/report/philippines/sitrep-${n}`,
    date: { created: `2026-10-${10 + n}T08:00:00+00:00` },
    source: [{ shortname: 'OCHA', name: 'UN Office for the Coordination of Humanitarian Affairs' }],
    format: [{ name: 'Situation Report' }],
    ...extra,
  },
})
const reports = (...items: object[]) => ({ totalCount: items.length, count: items.length, data: items })

describe('parsing ReliefWeb', () => {
  it('keeps what a card shows of each report', () => {
    expect(parseReports(reports(report(1)))).toEqual([
      {
        title: 'Philippines: Earthquake - Situation Report No. 1',
        source: 'OCHA',
        date: '2026-10-11',
        format: 'Situation Report',
        url: 'https://reliefweb.int/report/philippines/sitrep-1',
      },
    ])
  })

  it('leaves out reports with no title, and links that are not ReliefWeb’s', () => {
    const odd = reports(report(1, { title: '' }), report(2, { url_alias: 'https://evil.example/', url: 'javascript:alert(1)' }))
    expect(parseReports(odd)).toEqual([])
  })

  it('takes a disaster only when exactly one matched', () => {
    expect(parseDisaster(disasters(disaster))).toEqual({
      id: '52345',
      name: 'Philippines: Earthquake - Oct 2026',
      url: 'https://reliefweb.int/disaster/eq-2026-000186-phl',
    })
    expect(parseDisaster(disasters())).toBeNull()
    expect(parseDisaster(disasters(disaster, { ...disaster, id: '52346' }))).toBeNull()
  })

  it('recognises GLIDE numbers', () => {
    expect(isGlide('EQ-2026-000186-VUT')).toBe(true)
    expect(isGlide('EQ-2026-186-VUT')).toBe(false)
    expect(isGlide('')).toBe(false)
  })
})

describe('createReliefWeb', () => {
  function fakeApi(answer: { disasters?: object; reports?: object; fail?: boolean } = {}) {
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (answer.fail) return new Response('busy', { status: 503 })
      const body = String(url).includes('/disasters') ? (answer.disasters ?? disasters(disaster)) : (answer.reports ?? reports(report(1), report(2)))
      void init
      return new Response(JSON.stringify(body))
    })
  }
  const body = (fetch: ReturnType<typeof fakeApi>, call: number) => JSON.parse(String(fetch.mock.calls[call][1]!.body))

  it('finds the disaster by GLIDE number, then its five newest reports', async () => {
    const fetch = fakeApi()
    const reliefweb = createReliefWeb({ appname: 'hazard-globe-test', fetch })
    const answer = await reliefweb({ type: 'EQ', glide: 'EQ-2026-000186-PHL' })
    expect(answer.disaster?.name).toBe('Philippines: Earthquake - Oct 2026')
    expect(answer.reports).toHaveLength(2)
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.reliefweb.int/v2/disasters?appname=hazard-globe-test')
    expect(body(fetch, 0).filter).toEqual({ field: 'glide', value: 'EQ-2026-000186-PHL' })
    expect(body(fetch, 1)).toMatchObject({ filter: { field: 'disaster.id', value: 52345 }, sort: ['date.created:desc'], limit: 5 })
  })

  it('without a GLIDE number, matches on type, country and a start within a week', async () => {
    const fetch = fakeApi()
    await createReliefWeb({ appname: 'a', fetch })({ type: 'TC', iso3: 'PHL', date: '2026-10-08' })
    expect(body(fetch, 0).filter).toEqual({
      operator: 'AND',
      conditions: [
        { field: 'type.name', value: 'Tropical Cyclone' },
        { field: 'country.iso3', value: 'phl' },
        { field: 'date.event', value: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z' } },
      ],
    })
  })

  it('says nothing, without asking for reports, when no single disaster matches', async () => {
    const fetch = fakeApi({ disasters: disasters() })
    expect(await createReliefWeb({ appname: 'a', fetch })({ type: 'FL', glide: 'FL-2026-000001-BGD' })).toEqual({ disaster: null, reports: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
    const nothingToGoOn = fakeApi()
    expect((await createReliefWeb({ appname: 'a', fetch: nothingToGoOn })({ type: 'FL' })).disaster).toBeNull()
    expect(nothingToGoOn).not.toHaveBeenCalled()
  })

  it('keeps an answer for an hour, and not a failure', async () => {
    let t = 0
    const fetch = fakeApi()
    const reliefweb = createReliefWeb({ appname: 'a', fetch, now: () => t })
    await reliefweb({ type: 'EQ', glide: 'EQ-2026-000186-PHL' })
    t += 59 * 60_000
    await reliefweb({ type: 'EQ', glide: 'EQ-2026-000186-PHL' })
    expect(fetch).toHaveBeenCalledTimes(2)

    const failing = fakeApi({ fail: true })
    const flaky = createReliefWeb({ appname: 'a', fetch: failing, now: () => 0 })
    await expect(flaky({ type: 'EQ', glide: 'EQ-2026-000186-PHL' })).rejects.toThrow('ReliefWeb 503')
    await expect(flaky({ type: 'EQ', glide: 'EQ-2026-000186-PHL' })).rejects.toThrow('ReliefWeb 503')
    expect(failing).toHaveBeenCalledTimes(2)
  })
})
