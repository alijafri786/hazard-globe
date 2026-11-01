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
  features: HazardEvent[]
}

export interface WatchArea {
  label: string
  lon: number
  lat: number
  radiusKm: number
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
