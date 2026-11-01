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
  flights: Flight[]
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
