import { USER_AGENT } from './gdacs.js'
import type { HazardType } from './hazards.js'

/**
 * Humanitarian reports for an event from ReliefWeb (UN OCHA): situation reports, maps and appeals. Its API
 * needs an app name approved by ReliefWeb (https://apidoc.reliefweb.int/parameters#appname); without one,
 * this is off. Reports belong to their publishers: only titles, sources, dates and links are passed on.
 */
const API = 'https://api.reliefweb.int/v2'
const TIMEOUT_MS = 15_000
const TTL_MS = 60 * 60_000 // reports arrive over days; an hour old is fine
const CACHE_SIZE = 300

/** ReliefWeb's names for the disaster types GDACS has */
const DISASTER_TYPE: Record<HazardType, string> = {
  TC: 'Tropical Cyclone',
  FL: 'Flood',
  EQ: 'Earthquake',
  VO: 'Volcano',
  WF: 'Wild Fire',
  DR: 'Drought',
}

export interface ReliefWebReport {
  title: string
  source: string
  /** ISO date */
  date: string
  /** "Situation Report", "Map", "Appeal"… */
  format: string
  url: string
}

export interface EventReports {
  disaster: { name: string; url: string } | null
  reports: ReliefWebReport[]
}

/** What's known about the event to find it on ReliefWeb with */
export interface ReportQuery {
  type: HazardType
  /** GLIDE number, the surest match */
  glide?: string
  /** ISO 3166 alpha-3 */
  iso3?: string
  /** the event's first day, YYYY-MM-DD */
  date?: string
}

type Item = { id?: unknown; fields?: Record<string, unknown> }

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | undefined
const reliefWebUrl = (v: unknown) => (typeof v === 'string' && v.startsWith('https://reliefweb.int/') ? v : '')

/** A ReliefWeb report as the card shows it; anything without a title or a ReliefWeb link is left out */
export function parseReports(body: unknown): ReliefWebReport[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) throw new Error('ReliefWeb sent no reports')
  return (data as Item[]).flatMap((item) => {
    const f = item.fields ?? {}
    const url = reliefWebUrl(f.url_alias) || reliefWebUrl(f.url)
    const title = str(f.title).trim()
    if (!title || !url) return []
    const date = str((f.date as Record<string, unknown> | undefined)?.created).slice(0, 10)
    return [{ title: title.slice(0, 300), source: str(first(f.source)?.shortname), date, format: str(first(f.format)?.name), url }]
  })
}

/** The one disaster a search found, or null: none, or several, which can't be told apart */
export function parseDisaster(body: unknown): { id: string; name: string; url: string } | null {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data) || data.length !== 1) return null
  const item = data[0] as Item
  const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : ''
  const f = item.fields ?? {}
  if (!/^\d+$/.test(id)) return null
  return { id, name: str(f.name), url: reliefWebUrl(f.url_alias) || reliefWebUrl(f.url) || `https://reliefweb.int/node/${id}` }
}

export const isGlide = (s: string) => /^[A-Z]{2}-\d{4}-\d{6}-[A-Z]{3}$/.test(s)

/**
 * Looks up an event's disaster on ReliefWeb, by GLIDE number when it has one, else by type, country and
 * a start within a week (kept only when exactly one disaster matches), and then its five newest reports.
 * Each event's answer is kept an hour, and asked for only when someone opens its card.
 */
export function createReliefWeb({
  appname,
  fetch: fetchFn = fetch,
  now = Date.now,
}: {
  appname: string
  fetch?: typeof fetch
  now?: () => number
}) {
  const cache = new Map<string, { at: number; answer: Promise<EventReports> }>()

  async function post(resource: 'disasters' | 'reports', query: object): Promise<unknown> {
    const res = await fetchFn(`${API}/${resource}?appname=${encodeURIComponent(appname)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`ReliefWeb ${res.status}`)
    return res.json()
  }

  async function lookUp(q: ReportQuery): Promise<EventReports> {
    const fields = { include: ['name', 'glide', 'url', 'url_alias'] }
    let filter: object | null = null
    if (q.glide) filter = { field: 'glide', value: q.glide }
    else if (q.iso3 && q.date) {
      const day = Date.parse(`${q.date}T00:00:00Z`)
      const iso = (t: number) => new Date(t).toISOString()
      filter = {
        operator: 'AND',
        conditions: [
          { field: 'type.name', value: DISASTER_TYPE[q.type] },
          { field: 'country.iso3', value: q.iso3.toLowerCase() },
          { field: 'date.event', value: { from: iso(day - 7 * 86_400_000), to: iso(day + 7 * 86_400_000) } },
        ],
      }
    }
    if (!filter) return { disaster: null, reports: [] }
    const disaster = parseDisaster(await post('disasters', { filter, fields, limit: 2 }))
    if (!disaster) return { disaster: null, reports: [] }
    const reports = parseReports(
      await post('reports', {
        filter: { field: 'disaster.id', value: Number(disaster.id) },
        sort: ['date.created:desc'],
        limit: 5,
        fields: { include: ['title', 'url', 'url_alias', 'date.created', 'source.shortname', 'format.name'] },
      }),
    )
    return { disaster: { name: disaster.name, url: disaster.url }, reports }
  }

  return function reports(q: ReportQuery): Promise<EventReports> {
    const key = [q.type, q.glide ?? '', q.iso3 ?? '', q.date ?? ''].join('|')
    const hit = cache.get(key)
    if (hit && now() - hit.at < TTL_MS) return hit.answer
    const answer = lookUp(q)
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!)
    cache.set(key, { at: now(), answer })
    answer.catch(() => cache.get(key)?.answer === answer && cache.delete(key)) // failures aren't kept
    return answer
  }
}

export type ReliefWeb = ReturnType<typeof createReliefWeb>
