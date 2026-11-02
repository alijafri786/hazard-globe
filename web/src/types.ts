export type HazardType = 'TC' | 'FL'
export type AlertLevel = 'Green' | 'Orange' | 'Red'

export interface HazardEventProps {
  eventtype: HazardType
  eventid: number
  episodeid: number
  name?: string
  description?: string
  alertlevel: AlertLevel
  country?: string
  fromdate?: string
  todate?: string
  url?: { report?: string }
  severitydata?: { severitytext?: string }
}

export interface HazardEvent {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown } | null
  properties: HazardEventProps
}

export interface EventsResponse {
  fetchedAt: string
  /** how many days back the events reach */
  days: number
  features: HazardEvent[]
}

export const MAX_AREAS = 10

export interface WatchArea {
  /** assigned by the server once alerts are on */
  id?: string
  label: string
  lon: number
  lat: number
  radiusKm: number
  hazards: HazardType[]
  minAlert: AlertLevel
  /** also alert when a cyclone's forecast cone reaches the area */
  forecastAlerts?: boolean
}

/** An area being added or edited: it has no centre until one is picked. */
export type DraftArea = Omit<WatchArea, 'lon' | 'lat'> & { lon?: number; lat?: number }

export type ChannelView =
  | { kind: 'push' }
  | { kind: 'email'; address: string; verified: boolean }
  | { kind: 'telegram'; linked: boolean }

export interface SubscriptionView {
  id: string
  areas: (WatchArea & { id: string })[]
  channels: ChannelView[]
  /** set when the request added an email address */
  emailConfirmation?: 'sent' | 'limited' | 'failed'
}

/** Which ways of being notified the server offers */
export interface ServerChannels {
  push: boolean
  email: boolean
  telegram: { bot: string } | null
}

/** [icao24, callsign, originCountry, lon, lat, altitudeM, velocityMs, trackDeg, verticalRateMs] */
export type Flight = [string, string, string, number, number, number, number | null, number | null, number | null]

export interface FlightsResponse {
  /** when OpenSky computed the positions */
  time: string
  /** how often the server fetches a new snapshot */
  refreshSeconds: number
  /** whether the server can give an aircraft's track (it needs OpenSky credits to spare) */
  tracks: boolean
  flights: Flight[]
}

/** [unix seconds, lon, lat, barometric altitude m] */
export type TrackPoint = [number, number, number, number]

export interface FlightTrack {
  icao24: string
  points: TrackPoint[]
}

/**
 * A satellite's orbit as CelesTrak publishes it (OMM mean elements, for SGP4). A type rather than an
 * interface, so it fits satellite.js's open-ended OMM type.
 */
export type OrbitalElements = {
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

export interface SatellitesResponse {
  group: string
  fetchedAt: string
  satellites: OrbitalElements[]
}

export const ALERT_COLOURS: Record<AlertLevel, string> = {
  Red: '#e5484d',
  Orange: '#f5a524',
  Green: '#46a758',
}

export const HAZARD_LABELS: Record<HazardType, string> = {
  TC: 'Tropical cyclones',
  FL: 'Floods',
}
