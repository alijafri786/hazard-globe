import { randomUUID } from 'node:crypto'
import { ALERT_RANK, MAX_AREAS, type AlertLevel, type HazardType, type PushChannel, type WatchArea } from './types.js'

const isNumIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

function parseHazards(v: unknown): HazardType[] {
  const hazards = Array.isArray(v) ? (['TC', 'FL'] as const).filter((h) => v.includes(h)) : []
  return hazards.length ? hazards : ['TC', 'FL']
}

const parseLevel = (v: unknown): AlertLevel =>
  typeof v === 'string' && Object.hasOwn(ALERT_RANK, v) ? (v as AlertLevel) : 'Orange'

export function parsePushChannel(v: unknown): PushChannel | null {
  const p = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  if (!isText(p?.endpoint, 2048) || !p.endpoint.startsWith('https://')) return null
  if (!isText(p.keys?.p256dh, 256) || !isText(p.keys?.auth, 256)) return null
  return { kind: 'push', endpoint: p.endpoint, keys: { p256dh: p.keys.p256dh, auth: p.keys.auth } }
}

/**
 * Validates the full list of areas a client sent and merges it with the areas already stored.
 * An area keeps its id, and the record of alerts already sent, when the client sends that id back,
 * or sends no id but the same centre (older clients, and browsers migrating from one saved area).
 * Moving the centre starts that record afresh.
 */
export function parseAreas(
  input: unknown,
  existing: WatchArea[] = [],
  defaults: { hazards?: unknown; minAlert?: unknown } = {},
): WatchArea[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_AREAS) return null
  const used = new Set<string>()
  const areas: WatchArea[] = []

  for (const raw of input) {
    const a = raw as Record<string, unknown> | null
    if (!a || typeof a !== 'object') return null
    const { lon, lat, radiusKm } = a
    if (!isNumIn(lon, -180, 180) || !isNumIn(lat, -90, 90) || !isNumIn(radiusKm, 5, 1000)) return null

    const unused = existing.filter((e) => !used.has(e.id))
    const prev =
      typeof a.id === 'string'
        ? unused.find((e) => e.id === a.id)
        : unused.find((e) => e.lon === lon && e.lat === lat)
    const moved = !prev || prev.lon !== lon || prev.lat !== lat
    const id = prev?.id ?? randomUUID()
    used.add(id)

    areas.push({
      id,
      label: typeof a.label === 'string' && a.label.trim() ? a.label.trim().slice(0, 80) : 'My area',
      lon,
      lat,
      radiusKm,
      hazards: parseHazards(a.hazards ?? defaults.hazards),
      minAlert: parseLevel(a.minAlert ?? defaults.minAlert),
      notified: moved ? {} : prev.notified,
    })
  }
  return areas
}
