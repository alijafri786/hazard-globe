import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { alertItem, createTsunamiWatch, FEEDS, parseFeed, type TsunamiMessage } from '../src/tsunami.js'
import { makeArea } from './fixtures.js'

// Recorded from tsunami.gov on 15 Nov 2026: one information statement from each centre
const ptwc = readFileSync(new URL('./fixtures/tsunami-ptwc.xml', import.meta.url), 'utf8')
const ntwc = readFileSync(new URL('./fixtures/tsunami-ntwc.xml', import.meta.url), 'utf8')

/** The PTWC feed as it would read for another kind of message about the same earthquake */
const as = (category: string, id = 'urn:uuid:upgraded', issued = '2026-11-13T17:10:00Z') =>
  ptwc
    .replace('<strong>Category:</strong> Information', `<strong>Category:</strong> ${category}`)
    .replace('urn:uuid:4e58fbfd-f504-4705-9b75-a82babbdde3c', id)
    .replaceAll('2026-11-13T16:43:19Z', issued)

describe('parseFeed', () => {
  it('reads a centre’s message: kind, place, magnitude, time and bulletin', () => {
    expect(parseFeed(ptwc, 'PTWC')).toEqual<TsunamiMessage[]>([
      {
        id: 'urn:uuid:4e58fbfd-f504-4705-9b75-a82babbdde3c',
        centre: 'PTWC',
        event: 'PHEB-26317050',
        type: 'information',
        issuedAt: '2026-11-13T16:43:19.000Z',
        region: 'ABOUT 84 MILES NORTHWEST OF ISLA MONA',
        lat: 18.6,
        lon: -69.1,
        magnitude: 4.9,
        url: 'https://www.tsunami.gov/events/PHEB/2026/11/13/26317050/1/WECA42/WECA42.txt',
      },
    ])
  })

  it('keys NTWC’s events by their letter ids too', () => {
    expect(parseFeed(ntwc, 'NTWC')[0]).toMatchObject({ event: 'PAAQ-togrrv', region: '65 miles NE of Kodiak City, Alaska' })
  })

  it.each([
    ['Warning', 'warning'],
    ['Tsunami Threat', 'threat'],
    ['Advisory', 'advisory'],
    ['Watch', 'watch'],
    ['Cancellation', 'cancellation'],
    ['Something new', 'information'],
  ])('reads the category %s as %s', (category, type) => {
    expect(parseFeed(as(category), 'PTWC')[0].type).toBe(type)
  })

  it('leaves out an entry with no place or time', () => {
    expect(parseFeed(ptwc.replace('<geo:lat>18.6</geo:lat>', ''), 'PTWC')).toEqual([])
    expect(parseFeed(ptwc.replace(/<updated>[^<]*<\/updated>/g, '<updated>soon</updated>'), 'PTWC')).toEqual([])
  })
})

describe('alertItem', () => {
  const message = (category: string) => parseFeed(as(category), 'PTWC')[0]

  it('makes a red alert of a warning, keyed by the earthquake, reaching 1,000 km', () => {
    const item = alertItem(message('Warning'))!
    expect(item).toMatchObject({ key: 'TS-PHEB-26317050', hazard: 'TS', level: 'Red', lat: 18.6, lon: -69.1, reachKm: 1000 })
    const payload = item.payload([makeArea({ label: 'Santo Domingo' })])
    expect(payload.title).toBe('TSUNAMI WARNING near Santo Domingo')
    expect(payload.body).toContain('ABOUT 84 MILES NORTHWEST OF ISLA MONA (magnitude 4.9)')
    expect(payload.body).toContain('Not an official warning. Follow your local authorities.')
    expect(payload.url).toMatch(/^https:\/\/www\.tsunami\.gov\//)
  })

  it.each([
    ['Advisory', 'Orange'],
    ['Watch', 'Orange'],
    ['Information', 'Green'],
  ])('a %s is %s', (category, level) => {
    expect(alertItem(message(category))!.level).toBe(level)
  })

  it('never alerts about a cancellation, nor says "all clear"', () => {
    expect(alertItem(message('Cancellation'))).toBeNull()
  })
})

describe('createTsunamiWatch', () => {
  const feeds = (ptwcXml: string, ntwcXml = ntwc) => vi.fn(async (url: string) => (url === FEEDS.PTWC ? ptwcXml : ntwcXml))

  it('keeps every message seen for a day, newest first', async () => {
    let t = Date.parse('2026-11-13T18:00:00Z')
    let feed = ptwc
    const watch = createTsunamiWatch(vi.fn(async (url: string) => (url === FEEDS.PTWC ? feed : ntwc)), () => t)
    await watch.poll()
    feed = as('Advisory')
    await watch.poll()
    expect(watch.recent().map((m) => m.type)).toEqual(['information', 'advisory', 'information'])
    t = Date.parse('2026-11-14T17:00:00Z') // a day after the first PTWC message
    await watch.poll()
    expect(watch.recent().map((m) => m.id)).toEqual(['urn:uuid:d8216564-9d47-448a-9721-c02a26a16dad', 'urn:uuid:upgraded'])
  })

  it('alerts about each earthquake’s newest message only', async () => {
    let feed = as('Watch', 'urn:uuid:first', '2026-11-13T16:50:00Z')
    const watch = createTsunamiWatch(vi.fn(async (url: string) => (url === FEEDS.PTWC ? feed : ntwc)), () =>
      Date.parse('2026-11-13T18:00:00Z'),
    )
    await watch.poll()
    feed = as('Warning', 'urn:uuid:second', '2026-11-13T17:20:00Z')
    const items = await watch.items()
    expect(items.map((i) => [i.key, i.level])).toEqual([
      ['TS-PAAQ-togrrv', 'Green'],
      ['TS-PHEB-26317050', 'Red'],
    ])
  })

  it('carries on with one centre when the other fails, and fails only when both do', async () => {
    const one = createTsunamiWatch(
      vi.fn(async (url: string) => {
        if (url === FEEDS.NTWC) throw new Error('tsunami.gov 503')
        return ptwc
      }),
      () => Date.parse('2026-11-13T18:00:00Z'),
    )
    expect(await one.poll()).toHaveLength(1)
    const none = createTsunamiWatch(vi.fn().mockRejectedValue(new Error('tsunami.gov 503')))
    await expect(none.poll()).rejects.toThrow('tsunami.gov 503')
    expect(none.fetchedAt()).toBeNull()
    void feeds
  })
})
