# Hazard Globe

An open-source 3D globe of **tropical cyclones and floods** worldwide, with **push alerts for the places you care about** — your home, your family abroad, a site you manage.

Add up to 10 watch areas: pick each point on the globe (or use your location), then choose a radius, the hazards and a minimum alert level. You get a notification when a storm or flood footprint touches one of them.

You can also switch on **live flights** to see aircraft worldwide, coloured by altitude, and search by callsign.

> ⚠️ **Not an official warning service.** Data comes from [GDACS](https://www.gdacs.org) and can be delayed, incomplete or wrong. Always follow your national meteorological and civil protection agencies.

## How it works

```
GDACS API ──(poll every 15 min)──▶ server ──▶ /api/events ──▶ web (CesiumJS globe)
                                     │
                                     ├─ fetches affected-area polygons for relevant events
                                     ├─ intersects them with each subscriber's watch circle (Turf.js)
                                     └─ sends Web Push (VAPID) on new or escalated alerts

OpenSky API ──(on demand, cached)──▶ server ──▶ /api/flights ──▶ web (flights layer)
```

- **web/** — Vue 3 + TypeScript + CesiumJS (used directly, no wrapper library). Works with **no Cesium ion token** using the bundled Natural Earth imagery; add a token to get satellite imagery and terrain.
- **server/** — Node 22 + Hono. Caches GDACS so the public API isn't hammered by every visitor, stores subscriptions, and sends notifications. Zero infrastructure: subscriptions live in a JSON file.

## Quick start

Requires Node 22+.

```bash
npm install
cp server/.env.example server/.env
npm run vapid --workspace server   # paste the two keys into server/.env
npm run dev                         # server on :8787, web on :5173
npm test                            # server unit tests (Vitest)
```

Open http://localhost:5173. Push notifications work on `localhost`; anywhere else they need HTTPS.

End-to-end tests (Playwright) start their own server and web app on ports 8788 and 5174, with a throwaway store, so they never touch your dev data:

```bash
npx playwright install chromium   # once
npm run test:e2e
```

### Optional: satellite imagery and terrain

Create a free token at https://ion.cesium.com and add it to `web/.env.local`:

```
VITE_CESIUM_ION_TOKEN=your-token
```

Each deployment should use its own token — never commit one.

### Optional: Postgres

Subscriptions live in a JSON file by default. For more than a few hundred subscribers, or more than one server instance, point the server at Postgres in `server/.env`. Tables are created and migrated on startup:

```
DATABASE_URL=postgres://user:password@host:5432/dbname
```

`docker compose up -d` starts a local Postgres with the URL shown in `docker-compose.yml`. To move existing subscriptions across from the JSON file, alert history included (safe to re-run):

```bash
npm run store:import --workspace server   # reads DATA_FILE; or add: -- path/to/store.json
```

### Optional: faster flight updates

Flights work out of the box, but anonymous [OpenSky](https://opensky-network.org) access only allows a new snapshot every 15 minutes. With a free OpenSky account, create an API client (Account page) and add it to `server/.env` to get one every 2 minutes:

```
OPENSKY_CLIENT_ID=your-client-id
OPENSKY_CLIENT_SECRET=your-client-secret
```

## Controls

Drag to spin the globe, scroll or pinch to zoom, and right-drag (or two-finger drag) to tilt. The buttons at the bottom right do the same with a click or press-and-hold, and the compass turns the view back to north. Keyboard: arrow keys pan, `+`/`-` zoom, `Q`/`E` rotate, `W`/`S` tilt.

## Notes and limits

- **iPhone/iPad:** web push only works after the site is added to the Home Screen (iOS 16.4+).
- **Alert logic:** each area is notified once per event, and again only if its alert level escalates (e.g. Orange → Red). When one event touches several of your areas, you get one notification naming them all. Moving an area's centre resets what it has already been told.
- **Early events:** GDACS sometimes has no footprint polygon yet; the server falls back to the event's point location.
- **Be kind to GDACS:** the poll interval is clamped to a minimum of 10 minutes.
- **Storage:** the JSON store is fine for a few hundred subscribers (capped by `MAX_SUBSCRIBERS`); beyond that, use Postgres (see above). Both sit behind the `SubscriptionStore` interface in `server/src/store/` and are tested against the same suite, with Postgres run in-process via PGlite. If the JSON file is ever corrupted, the server refuses to start rather than overwrite it.
- **Abuse:** API routes are rate-limited per IP in memory (subscribing 20/hour, test alerts 5 per 10 minutes per subscription, footprint lookups 60/minute, everything else 300/minute). Behind a reverse proxy, set `TRUST_PROXY` so limits see real client IPs. With several server instances, each counts separately.
- **Flights:** the server only calls OpenSky while someone has the layer switched on, and shares one cached snapshot between all visitors, so it stays inside OpenSky's daily credit limit. Between snapshots, planes are moved along their last reported heading, so positions are approximate. Aircraft on the ground are left out.
- **OpenSky terms:** OpenSky data is free for research and non-commercial use. Check the terms of use on [opensky-network.org](https://opensky-network.org) before deploying commercially.

## Roadmap

- [ ] Forecast cones from NOAA NHC / JTWC for cyclones
- [ ] Flood forecasts (Copernicus GloFAS) — check licence terms before redistributing
- [x] Multiple watch areas per device
- [ ] Email and Telegram delivery channels
- [ ] Time slider for event history
- [x] Rate limiting
- [x] Postgres store
- [x] Tests: Vitest for matching logic, Playwright for the alert flow

## Contributing

Issues and PRs welcome. Please keep the "not an official warning" disclaimer visible in any fork that sends alerts.

## Licence

MIT. Event data © GDACS (European Commission JRC / UN OCHA) — see their terms of use. Flight data from The OpenSky Network.
