import type { CycloneForecast, EventDetails, TrackPoint } from './forecast.js'
import { touchesArea } from './matcher.js'
import {
  ALERT_RANK,
  type AlertLevel,
  type AlertPayload,
  type GdacsEvent,
  type Subscription,
  type WatchArea,
} from './types.js'

const HAZARD_NAME = { TC: 'Tropical cyclone', FL: 'Flood' } as const

export interface PlannedAlert {
  sub: Subscription
  /** the event's key, or `${eventKey}:cone` for a forecast-cone alert */
  eventKey: string
  level: AlertLevel
  /** every area of `sub` this alert covers; one message names them all */
  areaIds: string[]
  payload: AlertPayload
}

/** The area wants this event and hasn't been told about it (under `key`) at this level or higher. */
function wants(area: WatchArea, event: GdacsEvent, key: string): boolean {
  const p = event.properties
  if (!area.hazards.includes(p.eventtype)) return false
  if (!(ALERT_RANK[p.alertlevel] >= ALERT_RANK[area.minAlert])) return false // also drops unknown levels
  const prev = area.notified[key]
  return !prev || ALERT_RANK[p.alertlevel] > ALERT_RANK[prev.level] // new, or escalated
}

export const eventKey = (e: GdacsEvent) => `${e.properties.eventtype}-${e.properties.eventid}`
export const coneKey = (e: GdacsEvent) => `${eventKey(e)}:cone`

const nameOf = (e: GdacsEvent) => e.properties.name || e.properties.description || HAZARD_NAME[e.properties.eventtype]

function describe(e: GdacsEvent): { title: string; body: string } {
  const p = e.properties
  const where = p.country ? ` — ${p.country}` : ''
  const severity = p.severitydata?.severitytext ? `\n${p.severitydata.severitytext}` : ''
  return {
    title: `${p.alertlevel.toUpperCase()} ${HAZARD_NAME[p.eventtype]} alert`,
    body: `${nameOf(e)}${where}${severity}`,
  }
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const issued = (iso: string) =>
  `${new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`

/** Great-circle distance in km */
function km(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** The forecast position closest to the area: when the storm's centre is expected to pass nearest. */
const closest = (area: WatchArea, track: TrackPoint[]) =>
  track.filter((t) => t.forecast).reduce<TrackPoint | null>((best, t) => (!best || km(t, area) < km(best, area) ? t : best), null)

function describeForecast(e: GdacsEvent, forecast: CycloneForecast, areas: WatchArea[]): { title: string; body: string } {
  const p = e.properties
  const when = areas
    .map((a) => [a.label, closest(a, forecast.track)] as const)
    .filter(([, t]) => t)
    .map(([label, t]) => `${label} around ${day(t!.time)}`)
  return {
    title: `Forecast: ${HAZARD_NAME.TC} may reach ${areas.length === 1 ? areas[0].label : 'your areas'}`,
    body:
      `${nameOf(e)}${p.country ? ` — ${p.country}` : ''} (${p.alertlevel})\n` +
      `Its forecast cone reaches: ${areas.map((a) => a.label).join(', ')}\n` +
      (when.length ? `Closest: ${when.join('; ')}\n` : '') +
      `Forecast issued ${issued(forecast.issuedAt)}. The cone shows the likely path of the storm's centre, ` +
      `not its size. Not an official warning.`,
  }
}

/**
 * Decides who to alert about which event: hazard filter, minimum level, new or escalated, and area match,
 * all per watch area. A subscriber gets one alert per event naming every area it touches.
 *
 * Areas that opted in also get a forecast alert when a cyclone's forecast cone reaches them, recorded
 * separately so it never stands in for the alert when the storm's winds do. No cone alert once the area
 * has had the real thing for that storm.
 *
 * The only I/O is the injected lookup, which is skipped for events nobody still needs to hear about.
 */
export async function planAlerts(
  events: GdacsEvent[],
  subs: Subscription[],
  detailsFor: (event: GdacsEvent) => Promise<EventDetails>,
): Promise<PlannedAlert[]> {
  const planned: PlannedAlert[] = []

  for (const event of events) {
    const p = event.properties
    const key = eventKey(event)
    const cone = coneKey(event)
    let details: EventDetails | undefined

    for (const sub of subs) {
      const pending = sub.areas.filter((a) => wants(a, event, key))
      const conePending =
        p.eventtype === 'TC'
          ? sub.areas.filter((a) => a.forecastAlerts && !a.notified[key] && wants(a, event, cone))
          : []
      if (!pending.length && !conePending.length) continue
      details ??= await detailsFor(event)

      const hit = pending.filter((a) => touchesArea(a, event.geometry, details!.affected))
      if (hit.length) {
        const { title, body } = describe(event)
        planned.push({
          sub,
          eventKey: key,
          level: p.alertlevel,
          areaIds: hit.map((a) => a.id),
          payload: { title, body: `${body}\nNear: ${hit.map((a) => a.label).join(', ')}`, url: p.url?.report, tag: key },
        })
      }

      const forecast = details.forecast
      if (!forecast?.cone) continue
      const coneHit = conePending.filter((a) => !hit.includes(a) && touchesArea(a, null, [forecast.cone!]))
      if (coneHit.length) {
        planned.push({
          sub,
          eventKey: cone,
          level: p.alertlevel,
          areaIds: coneHit.map((a) => a.id),
          payload: { ...describeForecast(event, forecast, coneHit), url: p.url?.report, tag: cone },
        })
      }
    }
  }

  return planned
}
