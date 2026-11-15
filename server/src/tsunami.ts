import { USER_AGENT } from './gdacs.js'
import type { AlertItem } from './sourceAlerts.js'
import type { AlertLevel } from './types.js'

/**
 * Tsunami messages from NOAA's two warning centres: the Pacific (PTWC, Hawaii) and the National (NTWC,
 * Alaska), from their Atom feeds at tsunami.gov (US government, public domain). Each feed holds only the
 * centre's latest message, so the server keeps every one it has seen for a day. They cover the Pacific,
 * Caribbean and US and Canadian coasts; Japan, the Indian Ocean and Europe have their own centres.
 */
export const FEEDS = {
  PTWC: 'https://www.tsunami.gov/events/xml/PHEBAtom.xml',
  NTWC: 'https://www.tsunami.gov/events/xml/PAAQAtom.xml',
} as const
export type Centre = keyof typeof FEEDS

const TIMEOUT_MS = 20_000
const KEEP_MS = 86_400_000

export type MessageType = 'warning' | 'threat' | 'advisory' | 'watch' | 'information' | 'cancellation'

export interface TsunamiMessage {
  /** the message's own id */
  id: string
  centre: Centre
  /** the earthquake the message is about, as the centre numbers it; the same across a message's updates */
  event: string
  type: MessageType
  issuedAt: string
  /** where the earthquake was, as the centre names it */
  region: string
  lat: number
  lon: number
  magnitude: number | null
  /** the bulletin itself, on tsunami.gov */
  url: string
}

/** How strong an alert each kind of message makes. A cancellation never alerts. */
export const LEVEL: Record<MessageType, AlertLevel | null> = {
  warning: 'Red',
  threat: 'Red',
  advisory: 'Orange',
  watch: 'Orange',
  information: 'Green',
  cancellation: null,
}

/** A message reaches areas within this distance of its earthquake */
export const REACH_KM = 1000

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? ''
const field = (summary: string, name: string) =>
  summary.match(new RegExp(`<strong>\\s*${name}:?\\s*</strong>\\s*:?\\s*([^<]*)`, 'i'))?.[1]?.trim() ?? ''

function messageType(category: string): MessageType {
  const c = category.toLowerCase()
  if (c.includes('cancel')) return 'cancellation'
  if (c.includes('warning')) return 'warning'
  if (c.includes('threat')) return 'threat'
  if (c.includes('advisory')) return 'advisory'
  if (c.includes('watch')) return 'watch'
  return 'information'
}

/** The messages in one centre's Atom feed: anything without a place or a time is left out */
export function parseFeed(xml: string, centre: Centre): TsunamiMessage[] {
  const out: TsunamiMessage[] = []
  for (const entry of xml.split('<entry>').slice(1)) {
    // An empty tag is no position at all, not 0°
    const num = (v: string) => (v ? Number(v) : Number.NaN)
    const lat = num(tag(entry, 'geo:lat'))
    const lon = num(tag(entry, 'geo:long'))
    const issued = Date.parse(tag(entry, 'updated'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    if (Number.isNaN(issued)) continue
    const summary = tag(entry, 'summary')
    const bulletin = entry.match(/<link[^>]*rel="alternate"[^>]*href="(https:\/\/www\.tsunami\.gov\/[^"]+)"/)?.[1] ?? ''
    // .../events/PHEB/2026/11/13/26317050/1/WECA42/WECA42.txt: the centre and its event (PTWC numbers
    // them, NTWC uses letters: .../PAAQ/2026/11/13/togrrv/1/...)
    const path = bulletin.match(/\/events\/([A-Z]{4})\/\d{4}\/\d{2}\/\d{2}\/([A-Za-z0-9]+)\//)
    const id = tag(entry, 'id')
    const magnitude = Number.parseFloat(field(summary, 'Preliminary Magnitude'))
    out.push({
      id: id || bulletin,
      centre,
      event: path ? `${path[1]}-${path[2]}` : id,
      type: messageType(field(summary, 'Category')),
      issuedAt: new Date(issued).toISOString(),
      region: (field(summary, 'Affected Region') || tag(entry, 'title')).replace(/\s+/g, ' ').slice(0, 200),
      lat,
      lon,
      magnitude: Number.isFinite(magnitude) ? magnitude : null,
      url: bulletin || 'https://www.tsunami.gov/',
    })
  }
  return out
}

/** An alert for a message, at its level, keyed by its earthquake so an upgraded message alerts again */
export function alertItem(m: TsunamiMessage): AlertItem | null {
  const level = LEVEL[m.type]
  if (!level) return null
  const kind = m.type === 'information' ? 'Tsunami information statement' : `Tsunami ${m.type}`
  return {
    key: `TS-${m.event}`,
    hazard: 'TS',
    level,
    lon: m.lon,
    lat: m.lat,
    reachKm: REACH_KM,
    payload: (areas) => ({
      title: `${kind.toUpperCase()} near ${areas.length === 1 ? areas[0].label : 'your areas'}`,
      body:
        `${m.region}${m.magnitude ? ` (magnitude ${m.magnitude})` : ''}\n` +
        `Issued by NOAA's ${m.centre} ${new Date(m.issuedAt).toISOString().slice(11, 16)} UTC\n` +
        `Near: ${areas.map((a) => a.label).join(', ')}\n` +
        'Not an official warning. Follow your local authorities.',
      url: m.url,
    }),
  }
}

async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`tsunami.gov ${res.status}`)
  return res.text()
}

/**
 * Keeps the messages seen in the last day, from both centres. poll() is meant to run every couple of
 * minutes (the alert poller does), so a message isn't missed between one and the next.
 */
export function createTsunamiWatch(fetchText: (url: string) => Promise<string> = fetchFeed, now = Date.now) {
  const seen = new Map<string, TsunamiMessage>()
  let fetchedAt: string | null = null

  async function poll(): Promise<TsunamiMessage[]> {
    const results = await Promise.allSettled(
      (Object.keys(FEEDS) as Centre[]).map(async (c) => parseFeed(await fetchText(FEEDS[c]), c)),
    )
    for (const r of results) if (r.status === 'fulfilled') for (const m of r.value) seen.set(m.id, m)
    if (results.every((r) => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason
    fetchedAt = new Date(now()).toISOString()
    for (const [id, m] of seen) if (now() - Date.parse(m.issuedAt) > KEEP_MS) seen.delete(id)
    return recent()
  }

  /** Newest first */
  const recent = () => [...seen.values()].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))

  return {
    poll,
    recent,
    fetchedAt: () => fetchedAt,
    /** What to alert about now: each earthquake's newest message */
    items: async (): Promise<AlertItem[]> => {
      const newest = new Map<string, TsunamiMessage>()
      for (const m of await poll()) if (!newest.has(m.event)) newest.set(m.event, m)
      return [...newest.values()].flatMap((m) => alertItem(m) ?? [])
    },
  }
}

export type TsunamiWatch = ReturnType<typeof createTsunamiWatch>
