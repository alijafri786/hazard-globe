import type { AlertLevel, Channel, HazardType, Subscription, WatchArea } from '../types.js'
import { migrate, type Db, type Queryable } from './db.js'
import type { SubscriptionStore } from './index.js'

interface ChannelRow {
  subscription_id: string
  kind: string
  address: string
  data: Record<string, unknown>
}

interface AreaRow {
  id: string
  subscription_id: string
  label: string
  lon: number
  lat: number
  radius_km: number
  hazards: HazardType[]
  min_alert: AlertLevel
}

interface NotifiedRow {
  area_id: string
  event_key: string
  level: AlertLevel
  at: Date
}

function toChannelRow(ch: Channel): [kind: string, address: string, data: string] {
  switch (ch.kind) {
    case 'push':
      return ['push', ch.endpoint, JSON.stringify({ keys: ch.keys })]
  }
}

function fromChannelRow(row: ChannelRow): Channel | null {
  switch (row.kind) {
    case 'push':
      return { kind: 'push', endpoint: row.address, keys: row.data.keys as { p256dh: string; auth: string } }
    default:
      return null // a kind this version doesn't know, e.g. after a rollback
  }
}

/** Loads whole subscriptions in four queries, whatever their number. */
async function load(db: Queryable, where: string, params: unknown[] = []): Promise<Subscription[]> {
  const subs = await db.query<{ id: string; created_at: Date }>(
    `select id, created_at from subscriptions ${where} order by created_at, id`,
    params,
  )
  if (!subs.rows.length) return []
  const ids = subs.rows.map((r) => r.id)
  const [channels, areas, notified] = await Promise.all([
    db.query<ChannelRow>('select * from channels where subscription_id = any($1::text[])', [ids]),
    db.query<AreaRow>('select * from areas where subscription_id = any($1::text[]) order by position', [ids]),
    db.query<NotifiedRow>(
      `select n.* from notified n join areas a on a.id = n.area_id where a.subscription_id = any($1::text[])`,
      [ids],
    ),
  ])

  const notifiedByArea = new Map<string, WatchArea['notified']>()
  for (const n of notified.rows) {
    const map = notifiedByArea.get(n.area_id) ?? {}
    map[n.event_key] = { level: n.level, at: n.at.toISOString() }
    notifiedByArea.set(n.area_id, map)
  }

  return subs.rows.map((s) => ({
    id: s.id,
    createdAt: s.created_at.toISOString(),
    channels: channels.rows
      .filter((c) => c.subscription_id === s.id)
      .map(fromChannelRow)
      .filter((c): c is Channel => c !== null),
    areas: areas.rows
      .filter((a) => a.subscription_id === s.id)
      .map((a) => ({
        id: a.id,
        label: a.label,
        lon: a.lon,
        lat: a.lat,
        radiusKm: a.radius_km,
        hazards: a.hazards,
        minAlert: a.min_alert,
        notified: notifiedByArea.get(a.id) ?? {},
      })),
  }))
}

/** Postgres-backed store for deployments beyond a few hundred subscribers, or with several instances. */
export async function openPostgresStore(db: Db): Promise<SubscriptionStore> {
  await migrate(db)

  return {
    list: () => load(db, ''),

    get: async (id) => (await load(db, 'where id = $1', [id]))[0],

    async findByEndpoint(endpoint) {
      const { rows } = await db.query<{ subscription_id: string }>(
        `select subscription_id from channels where kind = 'push' and address = $1`,
        [endpoint],
      )
      return rows[0] ? (await load(db, 'where id = $1', [rows[0].subscription_id]))[0] : undefined
    },

    async count() {
      return (await db.query<{ n: number }>('select count(*)::int as n from subscriptions')).rows[0].n
    },

    /**
     * Saves the subscription's channels and areas. Alert history is merged rather than replaced, so an
     * alert recorded while the user was editing isn't lost; it is cleared only when an area is removed
     * or its centre moves.
     */
    async upsert(sub) {
      await db.transaction(async (tx) => {
        await tx.query('insert into subscriptions (id, created_at) values ($1, $2) on conflict (id) do nothing', [
          sub.id,
          sub.createdAt,
        ])

        await tx.query('delete from channels where subscription_id = $1', [sub.id])
        for (const ch of sub.channels) {
          await tx.query(
            `insert into channels (subscription_id, kind, address, data) values ($1, $2, $3, $4::jsonb)
             on conflict (kind, address) do update set subscription_id = excluded.subscription_id, data = excluded.data`,
            [sub.id, ...toChannelRow(ch)],
          )
        }

        await tx.query('delete from areas where subscription_id = $1 and not (id = any($2::text[]))', [
          sub.id,
          sub.areas.map((a) => a.id),
        ])
        for (const [position, a] of sub.areas.entries()) {
          await tx.query(
            `delete from notified where area_id = $1
             and exists (select 1 from areas where id = $1 and (lon <> $2 or lat <> $3))`,
            [a.id, a.lon, a.lat],
          )
          await tx.query(
            `insert into areas (id, subscription_id, position, label, lon, lat, radius_km, hazards, min_alert)
             values ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9)
             on conflict (id) do update set subscription_id = excluded.subscription_id, position = excluded.position,
               label = excluded.label, lon = excluded.lon, lat = excluded.lat, radius_km = excluded.radius_km,
               hazards = excluded.hazards, min_alert = excluded.min_alert`,
            [a.id, sub.id, position, a.label, a.lon, a.lat, a.radiusKm, a.hazards, a.minAlert],
          )
          const entries = Object.entries(a.notified)
          if (!entries.length) continue
          await tx.query(
            `insert into notified (area_id, event_key, level, at)
             select $1, * from unnest($2::text[], $3::text[], $4::timestamptz[])
             on conflict (area_id, event_key) do nothing`,
            [a.id, entries.map(([k]) => k), entries.map(([, n]) => n.level), entries.map(([, n]) => n.at)],
          )
        }
      })
    },

    async remove(id) {
      return (await db.query('delete from subscriptions where id = $1 returning id', [id])).rows.length > 0
    },

    async recordNotified(id, areaIds, eventKey, level) {
      await db.query(
        `insert into notified (area_id, event_key, level, at)
         select id, $3, $4, now() from areas where subscription_id = $1 and id = any($2::text[])
         on conflict (area_id, event_key) do update set level = excluded.level, at = excluded.at`,
        [id, areaIds, eventKey, level],
      )
    },

    async pruneNotified(activeKeys, before) {
      const { rows } = await db.query<{ n: number }>(
        `with gone as (delete from notified where at < $1 and not (event_key = any($2::text[])) returning 1)
         select count(*)::int as n from gone`,
        [before, [...activeKeys]],
      )
      return rows[0].n
    },
  }
}
