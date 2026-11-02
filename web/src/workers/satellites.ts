import { eciToEcf, eciToGeodetic, gstime, json2satrec, propagate, type SatRec } from 'satellite.js'
import type { OrbitalElements } from '../types'

/**
 * Satellite positions by SGP4, off the main thread: ~17,000 satellites a second is too much work to do
 * between frames. Positions are Earth-fixed metres, ready for Cesium.
 */
export type ToWorker =
  | { type: 'set'; version: number; elements: OrbitalElements[] }
  | { type: 'tick'; version: number; time: number; selected: number }

export interface Selected {
  index: number
  heightKm: number
  speedKms: number
  /** One full orbit from now as x, y, z triples, drawn as Earth is now, so it shows as a closed ring */
  orbit: Float64Array
}

export interface FromWorker {
  type: 'positions'
  version: number
  /** x, y, z for each satellite in the order set; NaN where SGP4 couldn't place it (e.g. decayed) */
  positions: Float64Array
  selected?: Selected
}

const ORBIT_POINTS = 180

let version = 0
let satrecs: (SatRec | null)[] = []

function satrec(el: OrbitalElements): SatRec | null {
  try {
    return json2satrec(el)
  } catch {
    return null
  }
}

function describe(index: number, time: number, gmst: number): Selected | undefined {
  const rec = satrecs[index]
  const now = rec && propagate(rec, new Date(time))
  if (!rec || !now) return undefined
  const { x, y, z } = now.velocity
  const orbit = new Float64Array(ORBIT_POINTS * 3)
  const periodMs = ((2 * Math.PI) / rec.no) * 60_000 // rec.no is radians a minute
  for (let i = 0; i < ORBIT_POINTS; i++) {
    const pv = propagate(rec, new Date(time + (i / (ORBIT_POINTS - 1)) * periodMs))
    if (!pv) return undefined
    const p = eciToEcf(pv.position, gmst)
    orbit.set([p.x * 1000, p.y * 1000, p.z * 1000], i * 3)
  }
  return {
    index,
    heightKm: eciToGeodetic(now.position, gmst).height,
    speedKms: Math.hypot(x, y, z),
    orbit,
  }
}

self.onmessage = ({ data: msg }: MessageEvent<ToWorker>) => {
  if (msg.type === 'set') {
    version = msg.version
    satrecs = msg.elements.map(satrec)
    return
  }
  if (msg.version !== version) return // asked about a list that's since been replaced

  const date = new Date(msg.time)
  const gmst = gstime(date)
  const positions = new Float64Array(satrecs.length * 3).fill(Number.NaN)
  for (let i = 0; i < satrecs.length; i++) {
    const rec = satrecs[i]
    const pv = rec && propagate(rec, date)
    if (!pv || !Number.isFinite(pv.position.x)) continue
    const p = eciToEcf(pv.position, gmst)
    positions[i * 3] = p.x * 1000
    positions[i * 3 + 1] = p.y * 1000
    positions[i * 3 + 2] = p.z * 1000
  }
  const selected = msg.selected >= 0 ? describe(msg.selected, msg.time, gmst) : undefined
  const reply: FromWorker = { type: 'positions', version, positions, selected }
  // Handed over rather than copied
  postMessage(reply, { transfer: selected ? [positions.buffer, selected.orbit.buffer] : [positions.buffer] })
}
