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
  /** Also alert when a cyclone's forecast cone reaches the area, before its winds do. Opt-in. */
  forecastAlerts: boolean
  /**
   * eventKey -> highest alert level already sent for this area, so we only re-alert on escalation.
   * Forecast-cone alerts are recorded under `${eventKey}:cone`.
   */
  notified: Record<string, { level: AlertLevel; at: string }>
}

export interface PushChannel {
  kind: 'push'
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Alerts go only to a confirmed address. `token` is the secret in its confirm and unsubscribe links. */
export interface EmailChannel {
  kind: 'email'
  address: string
  verified: boolean
  token: string
}

/** Pending until someone opens the bot with `token` before `linkExpiresAt`; then it has a chat. */
export interface TelegramChannel {
  kind: 'telegram'
  chatId?: string
  token: string
  linkExpiresAt?: string
}

/** Ways to reach a subscriber. */
export type Channel = PushChannel | EmailChannel | TelegramChannel
export type ChannelKind = Channel['kind']

/** Whether alerts can go to this channel yet. */
export const isActive = (ch: Channel): boolean =>
  ch.kind === 'push' || (ch.kind === 'email' ? ch.verified : Boolean(ch.chatId))

/** What identifies a channel among others of its kind: push endpoint, email address or chat id. */
export function channelAddress(ch: Channel): string {
  switch (ch.kind) {
    case 'push':
      return ch.endpoint
    case 'email':
      return ch.address
    case 'telegram':
      return ch.chatId ?? '' // pending: at most one per subscription
  }
}

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

export type SendResult = 'sent' | 'gone' | 'failed'

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

/** A satellite's orbit as CelesTrak publishes it (OMM, mean elements for SGP4), trimmed to what SGP4 uses */
export interface OrbitalElements {
  OBJECT_NAME: string
  /** International designator, e.g. 1998-067A */
  OBJECT_ID: string
  NORAD_CAT_ID: number
  /** ISO time the elements are for, UTC without a zone */
  EPOCH: string
  /** Revolutions a day */
  MEAN_MOTION: number
  ECCENTRICITY: number
  INCLINATION: number
  RA_OF_ASC_NODE: number
  ARG_OF_PERICENTER: number
  MEAN_ANOMALY: number
  BSTAR: number
  MEAN_MOTION_DOT: number
  MEAN_MOTION_DDOT: number
  ELEMENT_SET_NO: number
}

export interface SatellitesSnapshot {
  group: string
  /** when CelesTrak was asked */
  fetchedAt: string
  satellites: OrbitalElements[]
}
