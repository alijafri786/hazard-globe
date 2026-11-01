import type { Geometry } from 'geojson'
import { touchesArea } from './matcher.js'
import { ALERT_RANK, type AlertLevel, type AlertPayload, type GdacsEvent, type Subscription } from './types.js'

const HAZARD_NAME = { TC: 'Tropical cyclone', FL: 'Flood' } as const

export interface PlannedAlert {
  sub: Subscription
  eventKey: string
  level: AlertLevel
  payload: AlertPayload
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
 * Decides who to alert about which event: hazard filter, minimum level, new or escalated, and area match.
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
    const pending = subs.filter((s) => {
      if (!s.hazards.includes(p.eventtype)) return false
      if (!(ALERT_RANK[p.alertlevel] >= ALERT_RANK[s.minAlert])) return false // also drops unknown levels
      const prev = s.notified[key]
      return !prev || ALERT_RANK[p.alertlevel] > ALERT_RANK[prev] // new, or escalated
    })
    if (!pending.length) continue

    const affected = await geometryFor(event)
    const { title, body } = describe(event)
    for (const sub of pending) {
      if (!touchesArea(sub.area, event.geometry, affected)) continue
      planned.push({
        sub,
        eventKey: key,
        level: p.alertlevel,
        payload: { title, body: `${body}\nNear: ${sub.area.label}`, url: p.url?.report, tag: key },
      })
    }
  }

  return planned
}
