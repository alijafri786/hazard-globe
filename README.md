# Hazard Globe

[![CI](https://github.com/alijafri786/hazard-globe/actions/workflows/ci.yml/badge.svg)](https://github.com/alijafri786/hazard-globe/actions/workflows/ci.yml) [![MIT licence](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

An open-source 3D globe of **tropical cyclones and floods** worldwide, with **alerts for the places you care about** — your home, your family abroad, a site you manage — by browser notification, email or Telegram.

Add up to 10 watch areas: pick each point on the globe (or use your location), then choose a radius, the hazards and a minimum alert level. You get a notification when a storm or flood footprint touches one of them. For cyclones, each area can also opt in to an earlier heads-up when a storm's **forecast cone** reaches it.

Select a cyclone to see its track (solid where it has been, dashed where it's forecast to go, with times) and its forecast cone.

Switch the Events tab to **History** to look back over the last 7, 30 or 90 days: drag the slider or press play to see which storms and floods were active on each day.

Turn on the **flood forecast** overlay to see where rivers are forecast to rise over the next 15 days, from the Copernicus Global Flood Awareness System (GloFAS). It's for information only, not a flood warning, and it doesn't trigger alerts.

You can also switch on **live flights** to see aircraft worldwide, coloured by altitude, and search by callsign.

**Search** (the magnifier at the top right) goes to any place by name, or to coordinates typed latitude first (`48.8566, 2.3522` or `51.5N 0.12W`), and drops a pin there.

The **Weather** tab gives the temperature and current conditions anywhere: pick a spot on the globe, use your location, or search for a place while the tab is open.

> ⚠️ **Not an official warning service.** Data comes from [GDACS](https://www.gdacs.org) and can be delayed, incomplete or wrong. Always follow your national meteorological and civil protection agencies.

## How it works

```
GDACS API ──(poll every 15 min)──▶ server ──▶ /api/events ──▶ web (CesiumJS globe)
                                     │
                                     ├─ fetches affected-area polygons for relevant events
                                     ├─ intersects them with each subscriber's watch circle (Turf.js)
                                     └─ sends Web Push, email or Telegram on new or escalated alerts

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

Each deployment should use its own token — never commit one. With a token, search uses Cesium ion's geocoder, which also suggests places as you type.

### Optional: email alerts

Set an SMTP server in `server/.env` (any provider works) and the app offers email as well as browser notifications:

```
SMTP_URL=smtps://user:password@smtp.example.org:465
MAIL_FROM="Hazard Globe <alerts@example.org>"
PUBLIC_URL=https://your-site.example   # where links in emails point; defaults to WEB_ORIGIN
```

Every address gets a confirmation email first, and nothing else until it's confirmed; an address gets at most 3 confirmation emails an hour. Alert emails carry a one-click unsubscribe link (RFC 8058), which mail apps show as their own Unsubscribe button. Links in emails open a page with a button rather than acting straight away, so mail scanners that visit links can't confirm or unsubscribe anyone.

### Optional: Telegram alerts

Create a bot with [@BotFather](https://t.me/BotFather) and add its token to `server/.env`:

```
TELEGRAM_BOT_TOKEN=123456:ABC-your-bot-token
```

In My alerts, **Connect** gives a link that opens the bot. Pressing Start there links that chat; the link works for 15 minutes. Sending `/stop` to the bot disconnects it. The server long-polls Telegram, so it needs no public URL. Only one server instance should have the token set, because Telegram delivers a bot's messages to one process at a time.

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

- **iPhone/iPad:** web push only works after the site is added to the Home Screen (iOS 16.4+). Email and Telegram work anywhere.
- **Channels:** a subscription can use any mix of browser, email and Telegram. If one stops working for good (browser permission revoked, mailbox rejected, bot blocked), it's removed; when none are left, so is the subscription.
- **Alert logic:** each area is notified once per event, and again only if its alert level escalates (e.g. Orange → Red). When one event touches several of your areas, you get one notification naming them all. Moving an area's centre resets what it has already been told.
- **What counts as a hit:** for a cyclone, the area its winds are expected to reach (GDACS's wind buffers), not its forecast cone or track.
- **Forecast-cone alerts:** opt-in per area. They're sent once per storm when its cone reaches the area, and again only if the storm's alert level rises. They're recorded separately, so the alert when the winds reach the area still comes. No cone alert is sent once an area has had that alert. The message says roughly when the storm passes closest, and that a cone is where the storm's centre is likely to go, not how big it is. Cones come from GDACS, so they cover every ocean basin.
- **Early events:** GDACS sometimes has no footprint polygon yet; the server falls back to the event's point location.
- **Be kind to GDACS:** the poll interval is clamped to a minimum of 10 minutes. History offers three fixed ranges, each ending today, and the server fetches each from GDACS at most once every 15 minutes however many people are looking.
- **History days** are UTC days, as GDACS dates are. An event shows on every day between its start and its latest update.
- **GloFAS overlay:** browsers fetch map images directly from the public GloFAS map service (`ows.globalfloods.eu`), with no key needed. Nothing is proxied or stored by this server. To keep the load on GloFAS light, images are fetched only while a layer is switched on, in 512-pixel tiles, and no more detailed than the forecast grid needs. Clicking the map never queries GloFAS. The layers are hidden in History mode, because they show today's forecast.
- **Storage:** the JSON store is fine for a few hundred subscribers (capped by `MAX_SUBSCRIBERS`); beyond that, use Postgres (see above). Both sit behind the `SubscriptionStore` interface in `server/src/store/` and are tested against the same suite, with Postgres run in-process via PGlite. If the JSON file is ever corrupted, the server refuses to start rather than overwrite it.
- **Abuse:** API routes are rate-limited per IP in memory (subscribing 20/hour, test alerts 5 per 10 minutes per subscription, footprint lookups 60/minute, everything else 300/minute). Behind a reverse proxy, set `TRUST_PROXY` so limits see real client IPs. With several server instances, each counts separately.
- **Flights:** the server only calls OpenSky while someone has the layer switched on, and shares one cached snapshot between all visitors, so it stays inside OpenSky's daily credit limit. Between snapshots, planes are moved along their last reported heading, so positions are approximate. Aircraft on the ground are left out.
- **Search:** without a Cesium ion token, place names are looked up by OpenStreetMap's public [Nominatim](https://nominatim.org) service, straight from the browser. Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) rules out searching as you type, so it searches when you press Enter; each browser makes at most one request a second and remembers recent answers. Typed coordinates never leave the browser. For heavy use, point a deployment at its own Nominatim instance or use an ion token.
- **Weather:** current conditions come from [Open-Meteo](https://open-meteo.com), straight from the browser, with no key. They're weather-model values for a patch a few kilometres across, not a reading from the nearest station. Each spot is asked about at most once every 10 minutes per browser, and nothing is asked until someone checks a spot. Open-Meteo's free API is for non-commercial use (under 10,000 calls a day); a commercial deployment needs one of their paid plans.
- **OpenSky terms:** OpenSky data is free for research and non-commercial use. Check the terms of use on [opensky-network.org](https://opensky-network.org) before deploying commercially.

## Roadmap

- [x] Forecast cones for cyclones, with opt-in cone alerts (from GDACS, which covers every basin; NHC/JTWC cones could be added for official agency versions)
- [x] Flood forecasts (Copernicus GloFAS), as a map overlay
- [x] Multiple watch areas per device
- [x] Email and Telegram delivery channels
- [x] Time slider for event history
- [x] Rate limiting
- [x] Postgres store
- [x] Tests: Vitest for matching logic, Playwright for the alert flow

## Contributing

Issues and PRs welcome. Please keep the "not an official warning" disclaimer visible in any fork that sends alerts.

## Licence

MIT. Event data © GDACS (European Commission JRC / UN OCHA) — see their terms of use. Flight data from The OpenSky Network. Place search © OpenStreetMap contributors (ODbL), shown on screen with each result. Weather data by Open-Meteo.com (CC BY 4.0), credited on screen while shown.

Flood forecasts: generated using Copernicus Emergency Management Service information, from [GloFAS](https://global-flood.emergency.copernicus.eu). They're shown under the [CEMS-FLOODS licence](https://ewds.climate.copernicus.eu/licences/cems-floods). It allows distribution and communication to the public, provided this credit is shown (the app shows it with the overlay, and on the map). The licence says the data is for information purposes only, is not a flood warning, and comes without warranty. The app shows the public layers unmodified. Before a commercial deployment, check the current terms: the licence doesn't address commercial use explicitly, and Copernicus moved some data stores to CC BY 4.0 in 2025.
