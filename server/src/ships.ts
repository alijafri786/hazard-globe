import type { Ship, ShipDetails, ShipsSnapshot } from './types.js'

const STREAM_URL = 'wss://stream.aisstream.io/v0/stream'
const MESSAGE_TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData']

const MINUTE = 60_000
/** AIS positions build up over minutes, so the stream stays open this long after anyone last asked */
const IDLE_MS = 30 * MINUTE
/** A ship not heard from for this long is dropped: it's out of range of receivers, or switched off */
const STALE_MS = 30 * MINUTE
const SNAPSHOT_MS = 2 * MINUTE
const RETRY_FIRST_MS = 5_000
const RETRY_MAX_MS = 5 * MINUTE
/** A refused key won't start working by itself */
const REFUSED_RETRY_MS = 30 * MINUTE
/** Memory guard: a real feed has well under this many ships at once */
const MAX_SHIPS = 200_000

/** What the stream needs of a WebSocket; the global one in Node 22+, a fake in tests */
export interface Socket {
  binaryType: string
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}

interface ShipState {
  mmsi: number
  name: string
  type: number
  lon: number
  lat: number
  sog: number | null
  cog: number | null
  heading: number | null
  navStatus: number | null
  seenAt: number
  destination: string
  callSign: string
  imo: number | null
  lengthM: number | null
  widthM: number | null
}

type Body = Record<string, unknown>
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** AIS text is upper case, padded with spaces or @ */
const text = (v: unknown) => (typeof v === 'string' ? v.replace(/@+/g, ' ').replace(/\s+/g, ' ').trim() : '')
const below = (v: unknown, limit: number) => {
  const n = num(v)
  return n !== null && n >= 0 && n < limit ? n : null // AIS uses values at or past the limit for "not available"
}

const decoder = new TextDecoder()

interface Options {
  apiKey: string
  connect: (url: string) => Socket
}

/**
 * Ships worldwide from AISStream.io, whose AIS comes from receivers on land: good near coasts and in busy
 * lanes, thin on the open ocean. One WebSocket to AISStream for the whole server (browsers may not connect
 * to it, and the key stays here). It opens when someone first asks and closes after 30 minutes with nobody
 * asking, dropping what it had. Each request then gets a snapshot rebuilt at most every 2 minutes.
 */
export function createShips({
  apiKey,
  connect = (url) => new WebSocket(url) as unknown as Socket,
}: Pick<Options, 'apiKey'> & Partial<Options>) {
  const ships = new Map<number, ShipState>()
  let socket: Socket | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let refused = false
  let lastAskedAt = 0
  /** When the current run of collecting began; null while not collecting */
  let collectingSince: number | null = null
  let lastError: string | null = null
  let snapshot: ShipsSnapshot | null = null

  const idle = () => Date.now() - lastAskedAt > IDLE_MS

  function stop() {
    clearTimeout(retryTimer)
    retryTimer = undefined
    const s = socket
    socket = null
    s?.close()
    ships.clear()
    snapshot = null
    collectingSince = null
  }

  function update(mmsi: number, change: Partial<ShipState>) {
    let ship = ships.get(mmsi)
    if (!ship) {
      if (ships.size >= MAX_SHIPS || change.lon === undefined) return // nothing to place it with yet
      ship = {
        mmsi,
        name: '',
        type: 0,
        lon: 0,
        lat: 0,
        sog: null,
        cog: null,
        heading: null,
        navStatus: null,
        seenAt: 0,
        destination: '',
        callSign: '',
        imo: null,
        lengthM: null,
        widthM: null,
      }
      ships.set(mmsi, ship)
    }
    Object.assign(ship, change)
  }

  function handle(raw: string) {
    let msg: { MessageType?: string; MetaData?: Body; Message?: Record<string, Body>; error?: unknown }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.error) {
      lastError = String(msg.error)
      // AISStream reports a bad key this way before closing
      if (/key/i.test(lastError)) refused = true
      console.error('[ships] AISStream:', lastError)
      return
    }
    const type = msg.MessageType ?? ''
    const body = msg.Message?.[type]
    if (!body || body.Valid === false) return
    const mmsi = num(msg.MetaData?.MMSI) ?? num(body.UserID)
    if (!mmsi) return
    failures = 0
    lastError = null

    const named = text(body.Name) || text(msg.MetaData?.ShipName)
    const shipType = num(body.Type)
    const statics: Partial<ShipState> = {
      ...(named && { name: named }),
      ...(shipType !== null && shipType > 0 && { type: shipType }),
    }

    if (type === 'ShipStaticData') {
      const dim = (body.Dimension ?? {}) as Body
      const length = (num(dim.A) ?? 0) + (num(dim.B) ?? 0)
      const width = (num(dim.C) ?? 0) + (num(dim.D) ?? 0)
      update(mmsi, {
        ...statics,
        destination: text(body.Destination),
        callSign: text(body.CallSign),
        imo: num(body.ImoNumber) || null,
        lengthM: length || null,
        widthM: width || null,
      })
      return
    }

    const lat = num(body.Latitude)
    const lon = num(body.Longitude)
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return // 91/181: no position
    update(mmsi, {
      ...statics,
      lon,
      lat,
      sog: below(body.Sog, 102.2),
      cog: below(body.Cog, 360),
      heading: below(body.TrueHeading, 360),
      navStatus: type === 'PositionReport' ? num(body.NavigationalStatus) : null,
      seenAt: Date.now(),
    })
  }

  function open() {
    clearTimeout(retryTimer)
    retryTimer = undefined
    const s = connect(STREAM_URL)
    socket = s
    s.binaryType = 'arraybuffer'
    collectingSince ??= Date.now()
    s.onopen = () => {
      s.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [
            [
              [-90, -180],
              [90, 180],
            ],
          ],
          FilterMessageTypes: MESSAGE_TYPES,
        }),
      )
    }
    s.onmessage = ({ data }) => {
      if (typeof data === 'string') handle(data)
      else if (data instanceof ArrayBuffer) handle(decoder.decode(data))
    }
    s.onerror = () => {} // onclose follows and decides what to do
    s.onclose = () => {
      if (socket !== s) return // closed on purpose
      socket = null
      if (idle()) return stop()
      const wait = refused ? REFUSED_RETRY_MS : Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** failures)
      failures++
      console.error(`[ships] stream closed, reconnecting in ${Math.round(wait / 1000)}s`)
      retryTimer = setTimeout(() => {
        refused = false
        open()
      }, wait)
    }
  }

  function asked() {
    lastAskedAt = Date.now()
    if (!socket && !retryTimer) open()
  }

  // Lets the stream go once nobody has looked for a while
  setInterval(() => {
    if ((socket || retryTimer) && idle()) stop()
  }, MINUTE).unref()

  return {
    snapshot(): ShipsSnapshot {
      asked()
      const now = Date.now()
      if (snapshot && now - Date.parse(snapshot.time) < SNAPSHOT_MS) return snapshot
      const list: Ship[] = []
      for (const [mmsi, s] of ships) {
        if (now - s.seenAt > STALE_MS) {
          ships.delete(mmsi)
          continue
        }
        list.push([
          mmsi,
          s.name,
          s.type,
          Number(s.lon.toFixed(4)),
          Number(s.lat.toFixed(4)),
          s.sog,
          s.cog === null ? null : Math.round(s.cog),
          s.heading,
          Math.round((now - s.seenAt) / 1000),
        ])
      }
      snapshot = {
        time: new Date(now).toISOString(),
        refreshSeconds: SNAPSHOT_MS / 1000,
        receiving: Boolean(socket) && !lastError,
        collectingSince: collectingSince === null ? null : new Date(collectingSince).toISOString(),
        error: lastError,
        ships: list,
      }
      return snapshot
    },

    details(mmsi: number): ShipDetails | null {
      asked()
      const s = ships.get(mmsi)
      if (!s) return null
      const { seenAt, ...rest } = s
      return { ...rest, seenAt: new Date(seenAt).toISOString() }
    },

    /** For tests and shutdown */
    stop,
  }
}

export type Ships = ReturnType<typeof createShips>
