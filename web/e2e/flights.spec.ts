import { expect, test, type Page } from '@playwright/test'
import { stubHazardData, stubNominatim } from './stubs'

// Mid-Atlantic, eastbound: on the way from New York to London
const jetblue = ['a4c592', 'JBU1107', 'United States', -40, 52, 11_000, 250, 80, 0]
// Also mid-Atlantic, but its callsign's listed route is Prague to Gatwick
const reused = ['406540', 'EZY93QR', 'United Kingdom', -35, 50, 10_500, 240, 85, 0]
// Nothing known about it
const mystery = ['abcdef', 'XYZ123', 'Nowhere', -30, 48, 9_000, 230, 90, 0]

const airport = (iata: string, icao: string, name: string, city: string, lat: number, lon: number) => ({
  iata_code: iata,
  icao_code: icao,
  name,
  municipality: city,
  latitude: lat,
  longitude: lon,
})
const JFK = airport('JFK', 'KJFK', 'John F Kennedy International Airport', 'New York', 40.6398, -73.7789)
const LHR = airport('LHR', 'EGLL', 'London Heathrow Airport', 'London', 51.4706, -0.46194)
const PRG = airport('PRG', 'LKPR', 'Václav Havel Airport Prague', 'Prague', 50.1008, 14.26)
const LGW = airport('LGW', 'EGKK', 'London Gatwick Airport', 'London', 51.1481, -0.19028)

const routes: Record<string, unknown> = {
  JBU1107: { airline: { name: 'JetBlue Airways' }, origin: JFK, destination: LHR },
  EZY93QR: { airline: { name: 'easyJet' }, origin: PRG, destination: LGW },
}
const aircraft: Record<string, unknown> = {
  a4c592: { type: 'A321-271NX', manufacturer: 'Airbus', registration: 'N4062J', registered_owner: 'JETBLUE AIRWAYS CORP' },
}

async function stubFlights(page: Page, { tracks = true } = {}) {
  /** What the next snapshot holds: tests change it to have planes land */
  const asked = { adsbdb: [] as string[], tracks: [] as string[], flights: [jetblue, reused, mystery] }
  await page.route(/\/api\/flights$/, (r) =>
    r.fulfill({
      json: { time: new Date().toISOString(), refreshSeconds: 120, tracks, flights: asked.flights },
    }),
  )
  await page.route(/\/api\/flights\/\w+\/track$/, (r) => {
    const icao24 = r.request().url().split('/').at(-2)!
    asked.tracks.push(icao24)
    const points = [
      [1, -73.78, 40.64, 0],
      [2, -60, 45, 11_000],
      [3, -40.1, 52, 11_000],
    ]
    return icao24 === 'a4c592'
      ? r.fulfill({ json: { icao24, points } })
      : r.fulfill({ status: 404, json: { error: 'No track available for this aircraft' } })
  })
  await page.route('https://api.adsbdb.com/**', (r) => {
    const [kind, id] = new URL(r.request().url()).pathname.split('/').slice(-2)
    asked.adsbdb.push(`${kind}/${id}`)
    const found = kind === 'callsign' ? routes[id] && { flightroute: routes[id] } : aircraft[id] && { aircraft: aircraft[id] }
    return found
      ? r.fulfill({ json: { response: found } })
      : r.fulfill({ status: 404, json: { response: `unknown ${kind}` } })
  })
  return asked
}

async function openFlight(page: Page, callsign: string) {
  await page.getByRole('tab', { name: 'Flights' }).click()
  const toggle = page.getByLabel('Show live flights')
  if (!(await toggle.isChecked())) await toggle.check()
  await page.getByPlaceholder('Find a callsign, e.g. BAW').fill(callsign)
  await page.getByRole('button', { name: new RegExp(callsign) }).click()
}

const card = (page: Page) => page.getByRole('article', { name: 'Selected flight' })

test.beforeEach(async ({ page }) => {
  await stubHazardData(page)
  await stubNominatim(page)
})

test('flight details: route, progress, aircraft and the path it has flown', async ({ page }) => {
  const asked = await stubFlights(page)
  await page.goto('/')
  await openFlight(page, 'JBU1107')

  await expect(card(page).locator('.callsign')).toHaveText('JBU1107')
  await expect(card(page)).toContainText('JetBlue Airways')
  await expect(card(page).locator('.ends')).toContainText('JFK')
  await expect(card(page).locator('.ends')).toContainText('LHR')
  await expect(card(page).getByText(/^[\d,]+ km flown · [\d,]+ km to go · about \d+ h \d+ min left$/)).toBeVisible()
  // About two-thirds of the way across: the bar says so too
  const flown = Number(await card(page).getByRole('progressbar').getAttribute('aria-valuenow'))
  expect(flown).toBeGreaterThan(50)
  expect(flown).toBeLessThan(80)
  await expect(card(page)).toContainText('Airbus A321-271NX')
  await expect(card(page)).toContainText('N4062J')
  await expect(card(page)).toContainText('JETBLUE AIRWAYS CORP')
  await expect(card(page)).toContainText('11,000 m (36,089 ft)')
  await expect(card(page)).toContainText('The coloured line is the path it has flown, from OpenSky.')

  expect(asked.tracks).toEqual(['a4c592'])
  expect(asked.adsbdb.sort()).toEqual(['aircraft/a4c592', 'callsign/JBU1107'])

  await card(page).getByRole('button', { name: 'Close flight details' }).click()
  await expect(card(page)).toBeHidden()
  await expect(page.locator('.cesium-infoBox-title')).not.toBeVisible()
})

test('without OpenSky credits to spare, no track is asked for and the guessed path is labelled', async ({ page }) => {
  const asked = await stubFlights(page, { tracks: false })
  await page.goto('/')
  await openFlight(page, 'JBU1107')
  await expect(card(page)).toContainText('km flown')
  await expect(card(page)).toContainText('a straight guess, not its actual path')
  expect(asked.tracks).toEqual([])
})

test('a listed route the plane is nowhere near is called out, and unknown ones say so', async ({ page }) => {
  await stubFlights(page)
  await page.goto('/')
  await openFlight(page, 'EZY93QR')
  await expect(card(page)).toContainText('PRG')
  await expect(card(page)).toContainText("It isn't flying between these airports")
  await expect(card(page).getByRole('progressbar')).toHaveCount(0)

  await openFlight(page, 'XYZ123')
  await expect(card(page).locator('.callsign')).toHaveText('XYZ123')
  await expect(card(page)).toContainText('Route not known.')
  await expect(card(page)).not.toContainText('Registration')
  await expect(card(page)).toContainText('ABCDEF') // the transponder, at least
})

test('clicking a plane on the globe opens its details in the Flights tab', async ({ page }) => {
  await stubFlights(page)
  await page.goto('/')
  await openFlight(page, 'JBU1107') // flies the camera to look straight down on it
  await card(page).getByRole('button', { name: 'Close flight details' }).click()
  await page.getByRole('tab', { name: 'Events' }).click()

  const box = (await page.locator('.globe canvas').boundingBox())!
  await page.waitForTimeout(2_000) // a click while the camera is still flying stops it short of the plane
  await expect(async () => {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByRole('tab', { name: 'Flights' })).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
  await expect(card(page).locator('.callsign')).toHaveText('JBU1107')
})

test('the selected plane’s path is asked for again with each snapshot, and a plane that drops out says so', async ({
  page,
}) => {
  const asked = await stubFlights(page)
  await page.goto('/')
  await openFlight(page, 'JBU1107')
  await expect(card(page)).toContainText('The coloured line is the path it has flown')
  expect(asked.tracks).toEqual(['a4c592'])

  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(() => asked.tracks).toEqual(['a4c592', 'a4c592'])

  // It's landed: no longer in the snapshot, so no line is drawn to where it was (or anywhere else)
  asked.flights = [reused, mystery]
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(card(page)).toContainText('No longer in the latest report: it may have landed.')
  expect(asked.tracks).toHaveLength(2) // and not asked for while it's gone
  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})

test('flights are hidden in History, details and all, and come back with live', async ({ page }) => {
  await stubFlights(page)
  await page.route(/\/api\/events\/history/, (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 30, type: 'FeatureCollection', features: [] } }),
  )
  await page.goto('/')
  await openFlight(page, 'JBU1107')
  await expect(card(page)).toBeVisible()

  await page.getByRole('tab', { name: 'Events' }).click()
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('tab', { name: 'Flights' }).click()
  await expect(page.getByText("Flights are shown where they are now, so they're hidden while you look at history.")).toBeVisible()
  await expect(card(page)).toBeHidden()
  await expect(page.locator('.cesium-infoBox-title')).not.toBeVisible()

  await page.getByRole('button', { name: 'Back to live' }).click()
  await expect(page.getByText(/^3 aircraft · reported/)).toBeVisible()
})
