import type { Feature, FeatureCollection, Geometry } from 'geojson'

export type HazardType = 'TC' | 'FL'
export type AlertLevel = 'Green' | 'Orange' | 'Red'

export const ALERT_RANK: Record<AlertLevel, number> = { Green: 0, Orange: 1, Red: 2 }

/** The subset of GDACS event properties this project relies on. */
export interface GdacsEventProps {
  eventtype: HazardType
  eventid: number
  episodeid: number
  name?: string
  description?: string
  alertlevel: AlertLevel
  country?: string
  fromdate?: string
  todate?: string
  iscurrent?: string | boolean
  url?: { report?: string; details?: string; geometry?: string }
  severitydata?: { severity?: number; severitytext?: string; severityunit?: string }
  [key: string]: unknown
}

export type GdacsEvent = Feature<Geometry, GdacsEventProps>
export type GdacsCollection = FeatureCollection<Geometry, GdacsEventProps>

export const MAX_AREAS = 10

export interface WatchArea {
  id: string
  label: string
  lon: number
  lat: number
  radiusKm: number
  hazards: HazardType[]
  minAlert: AlertLevel
  /** eventKey -> highest alert level already sent for this area, so we only re-alert on escalation */
  notified: Record<string, { level: AlertLevel; at: string }>
}

export interface PushChannel {
  kind: 'push'
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Ways to reach a subscriber. Email and Telegram join this union later. */
export type Channel = PushChannel

/** One device or person: where they want alerts for, and how to reach them. */
export interface Subscription {
  id: string
  createdAt: string
  channels: Channel[]
  areas: WatchArea[]
}

export interface Store {
  version: 2
  subscriptions: Subscription[]
}

export interface AlertPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

/**
 * One airborne aircraft, as a tuple to keep the global payload small (~10k aircraft):
 * [icao24, callsign, originCountry, lon, lat, altitudeM, velocityMs, trackDeg, verticalRateMs]
 */
export type Flight = [string, string, string, number, number, number, number | null, number | null, number | null]

export interface FlightsSnapshot {
  /** when OpenSky computed the positions */
  time: string
  refreshSeconds: number
  flights: Flight[]
}
