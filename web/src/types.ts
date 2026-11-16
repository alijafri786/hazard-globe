import type { AlertHazard, HazardType } from './hazards'

export type { AlertHazard, HazardType } from './hazards'
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
  /** GLIDE disaster number, e.g. "EQ-2026-000186-VUT"; often empty */
  glide?: string
  /** the main country, ISO 3166 alpha-3 */
  iso3?: string
}

/** ReliefWeb's reports on an event's disaster (see server/src/reliefweb.ts) */
export interface EventReports {
  disaster: { name: string; url: string } | null
  reports: { title: string; source: string; date: string; format: string; url: string }[]
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
  hazards: AlertHazard[]
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
  /** the server has a NASA FIRMS key, so it can alert about fires near an area */
  fires?: boolean
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

/**
 * [mmsi, name, AIS ship type, lon, lat, speed over ground kn, course °, heading °, seconds since its report]
 * Speed, course and heading are null when the ship doesn't send them.
 */
export type Ship = [number, string, number, number, number, number | null, number | null, number | null, number]

export interface ShipsResponse {
  time: string
  refreshSeconds: number
  receiving: boolean
  /** when the server began collecting: positions build up over the first minutes */
  collectingSince: string | null
  error: string | null
  ships: Ship[]
}

export interface ShipDetails {
  mmsi: number
  name: string
  type: number
  sog: number | null
  cog: number | null
  heading: number | null
  /** AIS navigational status, e.g. 0 under way, 1 at anchor, 5 moored */
  navStatus: number | null
  seenAt: string
  destination: string
  callSign: string
  imo: number | null
  lengthM: number | null
  widthM: number | null
}

/** Wind 10 m above the ground on a regular grid, rows north to south, columns west to east from 180°W */
export interface WindGrid {
  /** when the GFS model run started */
  run: string
  /** the time the wind is forecast for */
  validTime: string
  width: number
  height: number
  bounds: { west: number; east: number; south: number; north: number }
  /** eastward and northward wind, m/s */
  u: number[]
  v: number[]
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

/** USGS PAGER alert level: estimated impact on people and the economy */
export type PagerAlert = 'green' | 'yellow' | 'orange' | 'red'

/** One earthquake from the USGS real-time feeds (see server/src/earthquakes.ts) */
export interface Quake {
  id: string
  lon: number
  lat: number
  depthKm: number
  mag: number
  /** epoch ms */
  time: number
  place: string
  url: string
  /** USGS's flag for a large event in an ocean region; not a sign a tsunami happened */
  tsunami: boolean
  alert: PagerAlert | null
}

export type QuakeFeed = 'day' | 'week'

export interface QuakesResponse {
  feed: QuakeFeed
  fetchedAt: string
  generatedAt: string | null
  quakes: Quake[]
}

export type StormClass = 'all' | 'hurricane' | 'major'

/** What the server built its storm climatology from (see server/src/climatology/) */
export interface ClimatologyInfo {
  source: string
  citation: string
  from: string
  to: string
  years: number
  storms: number
  reachKm: number
  classes: Record<StormClass, number>
  built: string
  /** whole year, then by month */
  grids: { res: number; cols: number; rows: number }[]
}

/** How often storms passed near a place */
export interface PlaceClimatology {
  from: string
  to: string
  years: number
  radiusKm: number
  storms: number
  hurricane: number
  major: number
  peakMonths: number[]
  strongest: { name: string; year: number; kt: number } | null
}

/** NOAA SWPC's OVATION aurora forecast: % chance overhead on a 1° grid, row-major from the north-west */
export interface AuroraGrid {
  observedAt: string
  forecastAt: string
  cols: 360
  rows: 180
  /** base64 of cols × rows bytes */
  data: string
}

export interface KpPoint {
  time: string
  kp: number
  observed: boolean
}

export interface SpaceWeatherSummary {
  fetchedAt: string
  now: KpPoint | null
  kp: KpPoint[]
  scales: { G: number; S: number; R: number }
}

export type TsunamiMessageType = 'warning' | 'threat' | 'advisory' | 'watch' | 'information' | 'cancellation'

/** A message from NOAA's tsunami warning centres (see server/src/tsunami.ts) */
export interface TsunamiMessage {
  id: string
  centre: 'PTWC' | 'NTWC'
  event: string
  type: TsunamiMessageType
  issuedAt: string
  region: string
  lat: number
  lon: number
  magnitude: number | null
  url: string
}

export interface DartStation {
  id: string
  name: string
  lat: number
  lon: number
}

export interface DartReadings {
  id: string
  readings: { time: string; heightM: number }[]
  eventMode: boolean
}

/** A day of fire detections from NASA FIRMS on a 0.25° grid (see server/src/fires.ts) */
export interface FireGrid {
  fetchedAt: string
  count: number
  cols: number
  rows: number
  /** base64 of little-endian Uint16 counts, row-major from the north-west */
  data: string
}

export interface FireDetection {
  lat: number
  lon: number
  time: number
  frp: number
  confidence: 'nominal' | 'high'
  satellite: string
  day: boolean
}
