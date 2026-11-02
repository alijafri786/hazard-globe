import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createShips, type Socket } from '../src/ships.js'

class FakeSocket implements Socket {
  binaryType = 'blob'
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
    this.onclose?.()
  }
  /** As the server would: text or binary frames */
  receive(message: unknown, binary = false) {
    const text = JSON.stringify(message)
    this.onmessage?.({ data: binary ? new TextEncoder().encode(text).buffer : text })
  }
  /** The other end hangs up */
  drop() {
    this.onclose?.()
  }
}

const MINUTE = 60_000

const position = (mmsi: number, extra: Record<string, unknown> = {}) => ({
  MessageType: 'PositionReport',
  MetaData: { MMSI: mmsi, ShipName: 'EVER GIVEN          ', Latitude: 51.9, Longitude: 4.05 },
  Message: {
    PositionReport: {
      UserID: mmsi,
      Valid: true,
      Latitude: 51.9,
      Longitude: 4.05,
      Sog: 12.4,
      Cog: 86.7,
      TrueHeading: 87,
      NavigationalStatus: 0,
      ...extra,
    },
  },
})

const statics = (mmsi: number) => ({
  MessageType: 'ShipStaticData',
  MetaData: { MMSI: mmsi, ShipName: 'EVER GIVEN' },
  Message: {
    ShipStaticData: {
      UserID: mmsi,
      Valid: true,
      Name: 'EVER GIVEN@@@@@@@@@@',
      Type: 70,
      Destination: 'NLRTM  ',
      CallSign: 'H3RC',
      ImoNumber: 9811000,
      Dimension: { A: 300, B: 100, C: 30, D: 29 },
    },
  },
})

let sockets: FakeSocket[]
const connect = (url: string) => {
  const s = new FakeSocket(url)
  sockets.push(s)
  return s
}
const latest = () => sockets[sockets.length - 1]

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 2, 12) })
  sockets = []
})
afterEach(() => vi.useRealTimers())

describe('createShips', () => {
  it('connects on the first request and subscribes to the whole world', () => {
    const ships = createShips({ apiKey: 'k3y', connect })
    expect(sockets).toHaveLength(0)
    const first = ships.snapshot()
    expect(first.collectingSince).toBe('2026-11-02T12:00:00.000Z')
    expect(first.ships).toEqual([])

    latest().onopen?.()
    expect(latest().url).toBe('wss://stream.aisstream.io/v0/stream')
    expect(JSON.parse(latest().sent[0])).toEqual({
      APIKey: 'k3y',
      BoundingBoxes: [
        [
          [-90, -180],
          [90, 180],
        ],
      ],
      FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData'],
    })
    ships.snapshot()
    expect(sockets).toHaveLength(1) // one stream however many ask
  })

  it('merges positions and static data, reading text and binary frames, and leaves out what is not sent', () => {
    const ships = createShips({ apiKey: 'k', connect })
    ships.snapshot()
    const s = latest()
    s.receive(statics(1)) // no position yet: nowhere to put it
    s.receive(position(353136000), true)
    s.receive(statics(353136000))
    s.receive(position(2, { Sog: 102.3, Cog: 360, TrueHeading: 511 })) // AIS for "not available"
    s.receive(position(3, { Latitude: 91, Longitude: 181 })) // no position
    s.receive(position(4, { Valid: false }))
    s.receive({ MessageType: 'PositionReport', Message: {} })
    s.onmessage?.({ data: 'not json' })

    vi.advanceTimersByTime(30_000)
    // Snapshots are rebuilt at most every 2 minutes: this is still the empty first one
    expect(ships.snapshot().ships).toEqual([])
    vi.advanceTimersByTime(2 * MINUTE)
    expect(ships.snapshot().ships).toEqual([
      [353136000, 'EVER GIVEN', 70, 4.05, 51.9, 12.4, 87, 87, 150],
      [2, 'EVER GIVEN', 0, 4.05, 51.9, null, null, null, 150],
    ])
    expect(ships.details(353136000)).toMatchObject({
      name: 'EVER GIVEN',
      type: 70,
      destination: 'NLRTM',
      callSign: 'H3RC',
      imo: 9811000,
      lengthM: 400,
      widthM: 59,
      navStatus: 0,
      seenAt: '2026-11-02T12:00:00.000Z',
    })
    expect(ships.details(3)).toBeNull()
  })

  it('drops ships not heard from for 30 minutes', () => {
    const ships = createShips({ apiKey: 'k', connect })
    ships.snapshot()
    latest().receive(position(1))
    vi.advanceTimersByTime(20 * MINUTE)
    latest().receive(position(2))
    expect(ships.snapshot().ships.map((s) => s[0])).toEqual([1, 2])
    vi.advanceTimersByTime(11 * MINUTE)
    expect(ships.snapshot().ships.map((s) => s[0])).toEqual([2])
  })

  it('reconnects with growing waits, and lets go once nobody has asked for 30 minutes', () => {
    const ships = createShips({ apiKey: 'k', connect })
    ships.snapshot()
    latest().drop()
    vi.advanceTimersByTime(4_999)
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)
    latest().drop()
    vi.advanceTimersByTime(9_999)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(3)

    latest().receive(position(1)) // a working stream: waits start small again
    vi.advanceTimersByTime(31 * MINUTE)
    expect(latest().closed).toBe(true)
    expect(ships.details(1)).toBeNull() // what it had is dropped too
    // Asking opened it again; with nobody asking after that, it closes again and nothing reopens it
    const count = sockets.length
    expect(latest().closed).toBe(false)
    vi.advanceTimersByTime(60 * MINUTE)
    expect(latest().closed).toBe(true)
    expect(sockets).toHaveLength(count)
  })

  it('reports a refused key and waits a long time before trying it again', () => {
    const ships = createShips({ apiKey: 'wrong', connect })
    ships.snapshot()
    latest().receive({ error: 'Api Key Is Not Valid' })
    latest().drop()
    vi.advanceTimersByTime(2 * MINUTE)
    const snap = ships.snapshot()
    expect(snap.error).toBe('Api Key Is Not Valid')
    expect(snap.receiving).toBe(false)
    vi.advanceTimersByTime(20 * MINUTE)
    ships.snapshot()
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(9 * MINUTE)
    expect(sockets).toHaveLength(2)
  })
})
