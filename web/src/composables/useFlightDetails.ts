import {
  ArcType,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  CustomDataSource,
  LabelStyle,
  Math as CesiumMath,
  PolylineDashMaterialProperty,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import { computed, shallowRef, watch, type ShallowRef } from 'vue'
import { aircraftInfo, flightRoute, type AircraftInfo, type Airport, type FlightRoute } from '../services/aircraft'
import { api } from '../services/api'
import { distanceKm } from '../services/geo'
import type { TrackPoint } from '../types'
import { bandColour, type useFlightLayer } from './useFlightLayer'

/** undefined while it's being looked up, null when there's none */
type Lookup<T> = T | null | undefined

export interface FlightDetails {
  icao24: string
  callsign: string
  aircraft: Lookup<AircraftInfo>
  route: Lookup<FlightRoute>
  /** The path flown so far, from OpenSky; null when the server can't give one */
  track: Lookup<TrackPoint[]>
}

// A plane this far off the straight line between its listed airports isn't flying that route: callsigns get
// reused, and the route database lags behind
const OFF_ROUTE_RATIO = 1.25
const OFF_ROUTE_SLACK_KM = 150

const AIRPORT_COLOUR = Color.fromCssColorString('#facc15')
const REMAINING = new PolylineDashMaterialProperty({ color: Color.WHITE.withAlpha(0.85), dashLength: 14 })
const APPROXIMATE = Color.WHITE.withAlpha(0.45)

/**
 * Flightradar24-style details for the selected aircraft: who flies it, where from and to, how far along it is,
 * and on the globe the path it's flown, the rest of the way, and both airports.
 */
export function useFlightDetails(viewer: ShallowRef<Viewer | null>, flights: ReturnType<typeof useFlightLayer>) {
  const details = shallowRef<FlightDetails | null>(null)
  const drawn = new CustomDataSource('flight-route')
  let request = 0

  /** The plane now, as lon/lat degrees and altitude */
  function here() {
    void flights.moved.value // read so that anything computed from this re-runs as planes move
    const icao = details.value?.icao24
    const p = icao ? flights.positionOf(icao) : undefined
    if (!p) return null
    const c = Cartographic.fromCartesian(p)
    return { lon: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude) }
  }

  /** How far along its route it is, or null if it's off the route or the route isn't known */
  const progress = computed(() => {
    const route = details.value?.route
    const now = here()
    if (!route || !now) return null
    const { origin: o, destination: d } = route
    const flown = distanceKm(o.lon, o.lat, now.lon, now.lat)
    const toGo = distanceKm(now.lon, now.lat, d.lon, d.lat)
    const whole = distanceKm(o.lon, o.lat, d.lon, d.lat)
    if (flown + toGo > whole * OFF_ROUTE_RATIO + OFF_ROUTE_SLACK_KM) return { onRoute: false as const }
    const speedMs = flights.flightOf(details.value!.icao24)?.[6] ?? null
    return {
      onRoute: true as const,
      flownKm: flown,
      toGoKm: toGo,
      fraction: flown / (flown + toGo),
      // Straight there at today's ground speed: rough, ignoring the approach and the wind ahead
      minutesLeft: speedMs && speedMs > 50 ? (toGo * 1000) / speedMs / 60 : null,
    }
  })

  const planeNow = (fallbackHeight = 0) => {
    const icao = details.value?.icao24
    const p = icao ? flights.positionOf(icao) : undefined
    return p ? Cartesian3.clone(p) : Cartesian3.fromDegrees(0, 0, fallbackHeight)
  }

  const airportAt = (a: Airport) => Cartesian3.fromDegrees(a.lon, a.lat)

  function draw() {
    drawn.entities.removeAll()
    const d = details.value
    if (!d) return viewer.value?.scene.requestRender()
    const onRoute = progress.value?.onRoute === true
    const route = onRoute ? d.route : null

    if (d.track?.length) {
      // The path flown, coloured by altitude like the planes, in runs of the same colour
      let run: Cartesian3[] = []
      let colour = bandColour(d.track[0][3])
      const flush = () => {
        if (run.length > 1) drawn.entities.add({ polyline: { positions: run, width: 3, arcType: ArcType.NONE, material: colour } })
      }
      for (const [, lon, lat, alt] of d.track) {
        const c = bandColour(alt)
        const p = Cartesian3.fromDegrees(lon, lat, alt)
        if (c !== colour) {
          run.push(p) // joins up with the next run
          flush()
          run = [p]
          colour = c
        } else run.push(p)
      }
      flush()
      const [, lon, lat, alt] = d.track[d.track.length - 1]
      const last = Cartesian3.fromDegrees(lon, lat, alt)
      drawn.entities.add({
        polyline: {
          positions: new CallbackProperty(() => [last, planeNow()], false),
          width: 3,
          arcType: ArcType.NONE,
          material: colour,
        },
      })
    } else if (route) {
      // No track to hand: straight from the airport it left, and the card says it's approximate
      drawn.entities.add({
        polyline: {
          positions: new CallbackProperty(() => [airportAt(route.origin), planeNow()], false),
          width: 2,
          arcType: ArcType.GEODESIC,
          material: APPROXIMATE,
        },
      })
    }

    if (route) {
      drawn.entities.add({
        polyline: {
          positions: new CallbackProperty(() => [planeNow(), airportAt(route.destination)], false),
          width: 2,
          arcType: ArcType.GEODESIC,
          material: REMAINING,
        },
      })
      for (const a of [route.origin, route.destination]) {
        drawn.entities.add({
          name: `${a.name}${a.iata ? ` (${a.iata})` : ''}`,
          position: airportAt(a),
          point: { pixelSize: 8, color: AIRPORT_COLOUR, outlineColor: Color.BLACK, outlineWidth: 2 },
          label: {
            text: a.iata || a.icao,
            font: '600 13px system-ui, sans-serif',
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 3,
            outlineColor: Color.BLACK,
            fillColor: AIRPORT_COLOUR,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -8),
          },
        })
      }
    }
    viewer.value?.scene.requestRender()
  }

  watch(flights.selectedIcao, (icao24) => {
    const ask = ++request
    const f = icao24 ? flights.flightOf(icao24) : undefined
    if (!icao24 || !f) {
      details.value = null
      draw()
      return
    }
    const callsign = f[1]
    details.value = {
      icao24,
      callsign,
      aircraft: undefined,
      route: callsign ? undefined : null,
      track: flights.tracks.value ? undefined : null,
    }
    draw()

    const fill = <K extends 'aircraft' | 'route' | 'track'>(key: K, lookup: Promise<FlightDetails[K]>) =>
      lookup
        .catch(() => null)
        .then((value) => {
          if (ask !== request || !details.value) return // another aircraft was chosen meanwhile
          details.value = { ...details.value, [key]: value ?? null }
          draw()
        })
    void fill('aircraft', aircraftInfo(icao24))
    if (callsign) void fill('route', flightRoute(callsign))
    if (flights.tracks.value) void fill('track', api.flightTrack(icao24).then((t) => t?.points ?? null))
  })

  // Whether it's on its route can change as it moves (and only then are the route lines drawn)
  watch(() => progress.value?.onRoute, draw)

  watch(
    viewer,
    (v) => {
      if (v) void v.dataSources.add(drawn)
    },
    { immediate: true },
  )

  return { details, progress, close: flights.deselect }
}
