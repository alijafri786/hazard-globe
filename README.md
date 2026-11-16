# Hazard Globe

https://github.com/user-attachments/assets/f0b0224c-102b-479c-9d00-36ede7c1d944

[![CI](https://github.com/alijafri786/hazard-globe/actions/workflows/ci.yml/badge.svg)](https://github.com/alijafri786/hazard-globe/actions/workflows/ci.yml) [![MIT licence](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

An open-source 3D globe of **tropical cyclones, floods, earthquakes, volcanoes, wildfires and droughts** worldwide, with **alerts for the places you care about** — your home, your family abroad, a site you manage — by browser notification, email or Telegram.

Add up to 10 watch areas: pick each point on the globe (or use your location), then choose a radius, the hazards and a minimum alert level. You get a notification when an event's footprint touches one of them. New areas watch storms and floods unless you choose other hazards too. For cyclones, each area can also opt in to an earlier heads-up when a storm's **forecast cone** reaches it.

Select a cyclone to see its track (solid where it has been, dashed where it's forecast to go, with times) and its forecast cone.

Switch the Events tab to **History** to look back over the last 7, 30 or 90 days: drag the slider or press play to see which events were active on each day.

**Tsunami messages** from NOAA's warning centres show on the globe and in a list, and a warning or threat in force shows across the top of the screen whatever else is on. Watch areas can choose to be alerted about them too. **DART buoys** on the ocean floor show the last day of water height, and when one has triggered.

Switch on **USGS earthquakes** to see every recent earthquake, live: magnitude 2.5 and over in the past day, or 4.5 and over in the past week, sized by magnitude and coloured by depth. Click one for its depth, USGS's impact estimate (PAGER) and, when GDACS reports the same earthquake, its GDACS alert.

Switch on the **storm climatology** to see how often tropical cyclones have passed near each place since 1980, as storms per decade: all tropical storms, or only those at hurricane or major strength, over the whole year or one month. Each watch area that watches storms says the same for itself, for example *Since 1980: 19 storms within 150 km, 5 at hurricane strength, most in Sep, Aug and Oct. Strongest: Andrew (1992), 145 kt.*

Turn on the **flood forecast** overlay to see where rivers are forecast to rise over the next 15 days, from the Copernicus Global Flood Awareness System (GloFAS). It's for information only, not a flood warning, and it doesn't trigger alerts.

You can also switch on **live flights** to see aircraft worldwide, coloured by altitude, with their callsigns once you zoom in. Search by callsign or click a plane for its **flight details**: airline, where it's flying from and to, how far along it is and roughly how long it has left, the aircraft type and registration, and on the globe the path it has flown and the rest of its route.

The **Sea & space** tab shows **ships** worldwide (with an AISStream key, see below), coloured by type, and **satellites** moving live: space stations, the brightest, navigation and weather satellites, Starlink, or all ~17,000 active ones, coloured by orbit. Find one by name or NORAD number, or click it, to see its height, speed and one full orbit.

**Layers** (top of the panel) lists every layer in one place, to switch any of them on or off without hunting through the tabs; **Events only** switches off everything but the GDACS events. A **key** beside the panel explains the colours and shapes of whatever is on the globe, and leaves out layers hidden while looking back in History.

**Share** copies a link to what you're looking at: the camera (on the globe, the flat map or Columbus view), the layers that are on (with the earthquake feed and satellite groups chosen), the selected event or earthquake, the tab, and the day when looking back. Opening the link shows the same view. It never includes your watch areas, alerts or searched places.

**Search** (the magnifier at the top right) goes to any place by name, or to coordinates typed latitude first (`48.8566, 2.3522` or `51.5N 0.12W`), and drops a pin there.

**Sea & space** also has the **aurora forecast** for the next hour, with the night side of the globe shaded, the Kp index for the last day and next three, any geomagnetic storm in progress, and the chance of seeing the aurora overhead at each of your watch areas.

The **Weather** tab also gives **air quality** wherever you check the weather (the European or US index, PM2.5 and PM10, and any desert dust), shows **rainfall** and **smoke, dust and haze** from satellites, and **Sea & space** the **sea temperature**, how far it is from normal, or **sea ice**: daily maps from NASA, which in History show the day you're looking at.

The **Weather** tab plays the last few hours of the world's **clouds** from satellite, shows the **wind** as moving particles, and gives the **temperature** and current conditions anywhere: pick a spot on the globe, use your location, or search for a place while the tab is open.

> ⚠️ **Not an official warning service.** Data comes from [GDACS](https://www.gdacs.org) and can be delayed, incomplete or wrong. Always follow your national meteorological and civil protection agencies.

## How it works

```
GDACS API ──(poll every 15 min)──▶ server ──▶ /api/events ──▶ web (CesiumJS globe)
                                     │
                                     ├─ fetches affected-area polygons for relevant events
                                     ├─ intersects them with each subscriber's watch circle (Turf.js)
                                     └─ sends Web Push, email or Telegram on new or escalated alerts

OpenSky API ──(on demand, cached)──▶ server ──▶ /api/flights ──▶ web (flights layer)

NOAA NOMADS (GFS) ──(on demand, per 3 h forecast step)──▶ server (GRIB2 decoder) ──▶ /api/weather/wind ──▶ web (wind particles)

AISStream ──(WebSocket, open while in use)──▶ server ──▶ /api/ships ──▶ web (ships layer)

CelesTrak ──(on demand, 2 h cache)──▶ server ──▶ /api/satellites/:group ──▶ web worker (SGP4) ──▶ satellites layer

USGS ──(on demand, 2 min cache)──▶ server ──▶ /api/earthquakes ──▶ web (earthquakes layer)

NOAA IBTrACS ──(built yearly into server/assets)──▶ server ──▶ /api/climatology ──▶ web (storm climatology, area storm history)
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

### Optional: live fires and fire alerts

The globe always has NASA's daily map of fires seen from space. With a free [NASA FIRMS map key](https://firms.modaps.eosdis.nasa.gov/api/map_key/) it also shows every single fire from the last day, with its time and power, and watch areas can choose to be alerted about fires nearby:

```
FIRMS_MAP_KEY=your-map-key
```

The server asks FIRMS for the last day of VIIRS detections (NOAA-20 and NOAA-21) at most every 30 minutes, and only while someone has the layer on or an area wants fire alerts, which keeps well inside FIRMS's limits. An area is alerted, at most once a day for each place, when an ~11 km patch has 3 or more confident detections in 12 hours, or one high-confidence detection of 100 MW or more. Patches that are hot on most days (gas flares, volcanoes, some factories) are left out once the server has seen a few weeks of them: that memory starts afresh when the server restarts.

### Optional: humanitarian reports

Event cards can list [ReliefWeb](https://reliefweb.int)'s newest situation reports, maps and appeals for the disaster. ReliefWeb's API needs an app name it has approved: [request one](https://apidoc.reliefweb.int/parameters#appname), then add it to `server/.env`:

```
RELIEFWEB_APPNAME=your-approved-app-name
```

The server looks a disaster up by its GLIDE number, or by type, country and a start within a week when exactly one matches, and only when someone opens its card. It keeps each answer for an hour. Only titles, sources, dates and links are shown; the reports belong to their publishers.

### Optional: ships

Create a free API key at [aisstream.io](https://aisstream.io) and add it to `server/.env`:

```
AISSTREAM_API_KEY=your-key
```

AISStream doesn't allow browsers to connect, so the server holds the one stream and hands each browser a snapshot. Without a key, the app says ships aren't set up.

### Optional: faster flight updates

Flights work out of the box, but anonymous [OpenSky](https://opensky-network.org) access only allows a new snapshot every 15 minutes. With a free OpenSky account, create an API client (Account page) and add it to `server/.env` to get one every 2 minutes, and the path each selected plane has actually flown:

```
OPENSKY_CLIENT_ID=your-client-id
OPENSKY_CLIENT_SECRET=your-client-secret
```

## Deploying the web app to Cloudflare

`wrangler.jsonc` serves the built web app (`web/dist`) from Cloudflare Workers. Requests to `/api/*` go through a small Worker (`worker/index.ts`) that forwards them to your server, so the app calls its API on its own origin: no `VITE_API_BASE`, no CORS, and you can move the server without rebuilding. The server itself is a long-running Node process (poller, subscription store, alert delivery), so host it separately.

In the Cloudflare dashboard, import the repository as a Worker and set:

- **Build command:** `npm run build --workspace web`
- **Deploy command:** `npx wrangler deploy`
- **Build variables:** `NODE_VERSION=22`, and `VITE_CESIUM_ION_TOKEN` if you use one (see above). Vite builds these into the app, so they must be build variables.
- **Runtime variable** (Settings > Variables and Secrets): `API_ORIGIN`, your server's origin, e.g. `https://api.example.org`. Until it's set, `/api/*` answers 503. Deploys keep it (`keep_vars`).
- **Secret** (optional, same place, type Secret): `ORIGIN_SECRET`. The Worker sends it to the server in an `X-Origin-Auth` header, so your server can refuse anything that didn't come through the Worker.

On the server, set `TRUST_PROXY=1` (add one for each proxy in front of the server itself, such as nginx) so rate limits see visitors' addresses, and set `WEB_ORIGIN` and `PUBLIC_URL` to the app's address. Email confirmation and unsubscribe links use the server's `/api/email/...` routes, which the Worker forwards, so they work on the app's address too. The Worker replaces any `X-Forwarded-For` a browser sends with the address Cloudflare saw. Anyone who calls your server directly could still send their own, so keep the server reachable only through the Worker: have the reverse proxy in front of it refuse requests without the `ORIGIN_SECRET` header, and set `HOST=127.0.0.1` so the server's port isn't reachable from outside.

### Running the server on a small VM

`deploy/vm-setup.sh` sets the server up on a Debian or Ubuntu VM (a Google Cloud e2-micro is enough) in one command: Node 22, the server as a systemd service on `127.0.0.1:8787`, and Caddy in front with automatic HTTPS, compression and the `ORIGIN_SECRET` check. With no domain, it uses `<ip>.sslip.io`. The VM needs ports 80 and 443 open.

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/alijafri786/hazard-globe/main/deploy/vm-setup.sh \
  | sudo APP_ORIGIN=https://hazard-globe.example.workers.dev bash
```

It ends by printing the `API_ORIGIN` and `ORIGIN_SECRET` to set on the Worker. Run it again to update the server; it keeps `server/.env` (which holds the push keys, so back it up) and the secret.

To try the Worker locally, start the server (`npm run dev --workspace server`, on port 8787), build the web app, put `API_ORIGIN=http://localhost:8787` in `.dev.vars`, and run `npx wrangler dev --port 8788`. Wrangler also defaults to port 8787, so without `--port` it would take the server's port and send `/api/*` back to itself.

Cloudflare also builds a Preview for each branch and pull request. Previews don't inherit production variables, so their `/api/*` answers 503 until you give them an `API_ORIGIN` in the `previews` block of `wrangler.jsonc`.

## Controls

Drag to spin the globe, scroll or pinch to zoom, and right-drag (or two-finger drag) to tilt. The buttons at the bottom right do the same with a click or press-and-hold, and the compass turns the view back to north. Keyboard: arrow keys pan, `+`/`-` zoom, `Q`/`E` rotate, `W`/`S` tilt.

### Embedding

Add `?embed=1` to a link to show just the globe and its key, with an "Open in Hazard Globe" link, for an `<iframe>`:

```html
<iframe src="https://your-site.example/?embed=1#layers=gdacs-TC,gdacs-FL" width="800" height="500" style="border:0" title="Hazard Globe"></iframe>
```

Whether other sites may embed your deployment is up to the web server that serves the app: it's a static site, so set `Content-Security-Policy: frame-ancestors` (or `X-Frame-Options`) there. With neither, any site can embed it.

## Notes and limits

- **iPhone/iPad:** web push only works after the site is added to the Home Screen (iOS 16.4+). Email and Telegram work anywhere.
- **Channels:** a subscription can use any mix of browser, email and Telegram. If one stops working for good (browser permission revoked, mailbox rejected, bot blocked), it's removed; when none are left, so is the subscription.
- **Alert logic:** each area is notified once per event, and again only if its alert level escalates (e.g. Orange → Red). When one event touches several of your areas, you get one notification naming them all. Moving an area's centre resets what it has already been told.
- **What counts as a hit:** for a cyclone, the area its winds are expected to reach (GDACS's wind buffers), not its forecast cone or track. For an earthquake, where the USGS ShakeMap shows strong shaking (intensity VI or more), or a 100 km circle round the epicentre before there is one (a ShakeMap with no strong shaking anywhere alerts no one); earthquake alerts come after the event, as a prompt to check on people. For a volcano, the circle GDACS draws round it. For floods, wildfires and droughts, GDACS's affected area. The globe shades the same area the alerts use.
- **Many small events:** GDACS lists hundreds of Green earthquakes and wildfires a week. The live view shows them all (each type can be hidden); History leaves their Green ones out, which would take dozens of requests and thousands of markers. Droughts are looked up over at least 40 days, because one can run for months between updates.
- **Forecast-cone alerts:** opt-in per area. They're sent once per storm when its cone reaches the area, and again only if the storm's alert level rises. They're recorded separately, so the alert when the winds reach the area still comes. No cone alert is sent once an area has had that alert. The message says roughly when the storm passes closest, and that a cone is where the storm's centre is likely to go, not how big it is. Cones come from GDACS, so they cover every ocean basin.
- **Early events:** GDACS sometimes has no footprint polygon yet; the server falls back to the event's point location.
- **Be kind to GDACS:** the poll interval is clamped to a minimum of 10 minutes. History offers three fixed ranges, each ending today, and the server fetches each from GDACS at most once every 15 minutes however many people are looking.
- **History days** are UTC days, as GDACS dates are. An event shows on every day between its start and its latest update.
- **GloFAS overlay:** browsers fetch map images directly from the public GloFAS map service (`ows.globalfloods.eu`), with no key needed. Nothing is proxied or stored by this server. To keep the load on GloFAS light, images are fetched only while a layer is switched on, in 512-pixel tiles, and no more detailed than the forecast grid needs. Clicking the map never queries GloFAS. The layers are hidden in History mode, because they show today's forecast.
- **Storage:** the JSON store is fine for a few hundred subscribers (capped by `MAX_SUBSCRIBERS`); beyond that, use Postgres (see above). Both sit behind the `SubscriptionStore` interface in `server/src/store/` and are tested against the same suite, with Postgres run in-process via PGlite. If the JSON file is ever corrupted, the server refuses to start rather than overwrite it.
- **Abuse:** API routes are rate-limited per IP in memory (subscribing 20/hour, test alerts 5 per 10 minutes per subscription, footprint lookups 60/minute, everything else 300/minute). Behind a reverse proxy, set `TRUST_PROXY` so limits see real client IPs. With several server instances, each counts separately.
- **Flights:** the server only calls OpenSky while someone has the layer switched on, and shares one cached snapshot between all visitors, so it stays inside OpenSky's daily credit limit. Between snapshots, planes are moved along their last reported heading, so positions are approximate. Aircraft on the ground are left out.
- **Search:** without a Cesium ion token, place names are looked up by OpenStreetMap's public [Nominatim](https://nominatim.org) service, straight from the browser. Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) rules out searching as you type, so it searches when you press Enter; each browser makes at most one request a second and remembers recent answers. Typed coordinates never leave the browser. For heavy use, point a deployment at its own Nominatim instance or use an ion token.
- **Clouds:** hourly infrared images from NOAA/NESDIS's Global Mosaic of Geostationary Satellite Imagery (GMGSI), which stitches GOES, Himawari and Meteosat into one picture of the whole world, fetched from NOAA's nowCOAST map service straight from the browser. Each hour is fetched once, as one ~1 MB whole-world image, and recoloured in the browser so clear ground and sea are see-through; playing the loop makes no further requests. The images are 1 to 3 hours old, cover about 72° N to 72° S, and are shown at about 20 km detail. Hidden in History mode.
- **Wind:** NOAA's GFS forecast model, 10 m above the ground, on its 1° grid (about 100 km), so it shows the large-scale flow, not local gusts. The server asks NOAA's NOMADS service for just the two wind fields (~160 KB), from the newest run likely published (GFS runs every 6 hours and takes about 4 to appear) at the 3-hourly forecast step nearest now, falling back to the run before; it fetches again only when a nearer step or newer run is due, and serves the last good grid meanwhile. GRIB2 is decoded by a small decoder in `server/src/weather/grib2.ts`, checked against ECMWF's ecCodes on NOAA's own file and on the same data in other packings (fixtures in `server/test/fixtures`). Browsers draw a few thousand particles on a canvas over the globe, the way earth.nullschool.net does, so the globe itself doesn't have to redraw every frame. Hidden in History mode.
- **Air quality:** from Open-Meteo's [air quality API](https://open-meteo.com/en/docs/air-quality-api) (Copernicus CAMS model data, CC BY 4.0), asked alongside the weather for the same spot, straight from the browser, and remembered for 10 minutes. The US index is shown in the Americas and the European one elsewhere, with a button to switch; each band's name always goes with its colour. The NASA haze layer (MODIS aerosol optical depth) is about the whole column of air, not what you breathe.
- **Weather:** current conditions come from [Open-Meteo](https://open-meteo.com), straight from the browser, with no key. They're weather-model values for a patch a few kilometres across, not a reading from the nearest station. Each spot is asked about at most once every 10 minutes per browser, and nothing is asked until someone checks a spot. Open-Meteo's free API is for non-commercial use (under 10,000 calls a day); a commercial deployment needs one of their paid plans.
- **Ships:** AIS positions from AISStream.io, whose data comes from volunteers' receivers on land: busy coasts and shipping lanes are well covered, the open ocean hardly at all. The server opens one WebSocket when someone first switches ships on, subscribes to the whole world, and closes it after 30 minutes with nobody looking, dropping what it collected. Positions build up over the first few minutes as ships report, and the app says so. Snapshots are rebuilt every 2 minutes; ships not heard from for 30 minutes are dropped; between snapshots, browsers move each ship along its course. A ship's destination, size and status are fetched when it's selected. Destinations are typed in by crews and often out of date. Node's WebSocket asks for compression, which AISStream needs to avoid its bandwidth limits.
- **Tsunami messages:** from the [Pacific and National Tsunami Warning Centers](https://www.tsunami.gov/) (NOAA, public domain), whose Atom feeds hold only each centre's latest message: the server reads them every 2 minutes and keeps a day of messages. A watch area that chooses tsunami messages is alerted when one is about an earthquake within 1,000 km: Red for a warning or threat, Orange for an advisory or watch, Green for an information statement. An upgraded message about the same earthquake alerts again; a cancellation never alerts, and nothing ever says "all clear". These centres cover the Pacific, the Caribbean and North American coasts; Japan (JMA), the Indian Ocean (INCOIS) and the north-east Atlantic and Mediterranean have their own. The banner shows a warning or threat for 12 hours unless a newer message about the same earthquake replaces it. Not an official warning service.
- **DART buoys:** NOAA's [National Data Buoy Center](https://www.ndbc.noaa.gov/dart.shtml) (public domain): the station list once a day, and a buoy's readings only when its card is opened (kept 15 minutes). A buoy reporting every minute or faster in the last 6 hours is in event mode.
- **Aurora and space weather:** NOAA's [Space Weather Prediction Center](https://www.swpc.noaa.gov/) (public domain, no key) through the server, which asks for the OVATION aurora forecast at most every 5 minutes and the Kp index and storm scales every 15, only while someone has the layer on. OVATION gives the chance of aurora overhead for the next 30 to 90 minutes on a 1° grid; it can only be seen at night with a clear sky. NOAA's "estimated" Kp for a period still to come counts as forecast. Hidden in History mode.
- **NASA overlays:** rainfall (IMERG), sea temperature and its anomaly, and sea ice (GHRSST MUR) are map tiles from [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) (no key, NASA's open data policy), fetched straight from the browser and only while a layer is on. Live shows the newest day GIBS has, found by asking for one tile and reading the day it answers with. In History they show the day being looked at, once the slider stops on it, or one of the two days before when GIBS lacks that day. Tiles are no more detailed than the data (about 10 km for rainfall, 1 km for the sea). The key's colours are sampled from GIBS's own colour maps.
- **Storm climatology:** built from NOAA's [IBTrACS](https://www.ncei.noaa.gov/products/international-best-track-archive) since-1980 file (public domain) by `npm run climatology --workspace server`, which writes `server/assets/climatology/` (about 1.4 MB, committed). A [yearly workflow](.github/workflows/climatology.yml) rebuilds it each January and opens a pull request if anything changed. A storm counts for a place when its centre passed within 100 km while at least that strong, using the US agencies' 1-minute wind (or WMO's), and counts once however long it lingered. Only the storm's tropical and subtropical stages count, not what it was before or became after. The map shows where storms have gone, not a forecast. Cite as Knapp, K. R., et al. (2010), *The International Best Track Archive for Climate Stewardship (IBTrACS)*, BAMS 91, 363–376.
- **USGS earthquakes:** from the [USGS real-time feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) (public domain, no key) through the server, which fetches each feed at most once every 2 minutes however many people are looking, and only while someone has the layer on. Quarry blasts and other non-earthquakes are left out. A USGS quake is matched to a GDACS one when they're within 50 km and 2 minutes of each other. USGS flags large earthquakes under the sea, but the flag doesn't mean a tsunami happened, and the card says so. Hidden in History mode.
- **Satellites:** orbital elements come from [CelesTrak](https://celestrak.org) through the server, which fetches each group at most once every 2 hours however many people are looking (CelesTrak updates about that often and blocks clients that download more often), and keeps serving the last good copy if a refresh fails. Each browser then works out positions itself with SGP4 ([satellite.js](https://github.com/shashwatak/satellite-js)) in a Web Worker, once a second, good to a few kilometres. Starlink and "All active" are a few MB to download and tens of thousands of dots, so they're off until chosen. Hidden in History mode.
- **Flight details:** the airline, route and aircraft come from [adsbdb](https://www.adsbdb.com), a free community database, looked up straight from the browser when you pick a plane. Routes are listed by callsign, which airlines reuse, so they can be out of date: if a plane is nowhere near the line between its listed airports, the card says so and draws no route. The path flown comes from OpenSky's track for that aircraft, which costs as many credits as a whole snapshot, so it's only offered with OpenSky credentials: the server works out how many tracks a day the credits left over from snapshots allow, keeps each for 5 minutes, and lets each IP ask for 30 a minute. Without one, the card shows a straight line from the departure airport and says it's a guess. "Time left" is the remaining distance at the current ground speed, so it's rough.
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

MIT. Event data © GDACS (European Commission JRC / UN OCHA) — see their terms of use. Flight data from The OpenSky Network; aircraft and routes from adsbdb. Ship positions from AISStream.io. Place search © OpenStreetMap contributors (ODbL), shown on screen with each result. Weather data by Open-Meteo.com (CC BY 4.0), credited on screen while shown. Cloud images from NOAA/NESDIS (GMGSI) via nowCOAST, and wind from NOAA's GFS model, both US public domain. Orbital data from CelesTrak.

Flood forecasts: generated using Copernicus Emergency Management Service information, from [GloFAS](https://global-flood.emergency.copernicus.eu). They're shown under the [CEMS-FLOODS licence](https://ewds.climate.copernicus.eu/licences/cems-floods). It allows distribution and communication to the public, provided this credit is shown (the app shows it with the overlay, and on the map). The licence says the data is for information purposes only, is not a flood warning, and comes without warranty. The app shows the public layers unmodified. Before a commercial deployment, check the current terms: the licence doesn't address commercial use explicitly, and Copernicus moved some data stores to CC BY 4.0 in 2025.
