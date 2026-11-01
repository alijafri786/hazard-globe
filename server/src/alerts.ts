import type { Geometry } from 'geojson'
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
  eventKey: string
  level: AlertLevel
  /** every area of `sub` this alert covers; one message names them all */
  areaIds: string[]
  payload: AlertPayload
}

/** The area wants this event and hasn't been told about it at this level or higher. */
function wants(area: WatchArea, event: GdacsEvent, key: string): boolean {
  const p = event.properties
  if (!area.hazards.includes(p.eventtype)) return false
  if (!(ALERT_RANK[p.alertlevel] >= ALERT_RANK[area.minAlert])) return false // also drops unknown levels
  const prev = area.notified[key]
  return !prev || ALERT_RANK[p.alertlevel] > ALERT_RANK[prev.level] // new, or escalated
}

export const eventKey = (e: GdacsEvent) => `${e.properties.eventtype}-${e.properties.eventid}`

function describe(e: GdacsEvent): { title: string; body: string } {
  const p = e.properties
  const name = p.name || p.description || HAZARD_NAME[p.eventtype]
  const where = p.country ? ` — ${p.country}` : ''
  const severity = p.severitydata?.severitytext ? `\n${p.severitydata.severitytext}` : ''
  return {
    title: `${p.alertlevel.toUpperCase()} ${HAZARD_NAME[p.eventtype]} alert`,
    body: `${name}${where}${severity}`,
  }
}

/**
 * Decides who to alert about which event: hazard filter, minimum level, new or escalated, and area match,
 * all per watch area. A subscriber gets one alert per event naming every area it touches.
 * The only I/O is the injected geometry lookup, which is skipped for events nobody still needs to hear about.
 */
export async function planAlerts(
  events: GdacsEvent[],
  subs: Subscription[],
  geometryFor: (event: GdacsEvent) => Promise<Geometry[]>,
): Promise<PlannedAlert[]> {
  const planned: PlannedAlert[] = []

  for (const event of events) {
    const p = event.properties
    const key = eventKey(event)
    let affected: Geometry[] | undefined

    for (const sub of subs) {
      const pending = sub.areas.filter((a) => wants(a, event, key))
      if (!pending.length) continue
      affected ??= await geometryFor(event)
      const hit = pending.filter((a) => touchesArea(a, event.geometry, affected!))
      if (!hit.length) continue

      const { title, body } = describe(event)
      planned.push({
        sub,
        eventKey: key,
        level: p.alertlevel,
        areaIds: hit.map((a) => a.id),
        payload: { title, body: `${body}\nNear: ${hit.map((a) => a.label).join(', ')}`, url: p.url?.report, tag: key },
      })
    }
  }

  return planned
}
