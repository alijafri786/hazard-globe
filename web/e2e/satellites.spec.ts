import { expect, test, type Page } from '@playwright/test'
import { stubHazardData, stubNominatim } from './stubs'

// Elements as of today, so SGP4 is never asked to look far from their epoch
const epoch = new Date().toISOString().slice(0, 10) + 'T00:00:00.000000'
const iss = {
  OBJECT_NAME: 'ISS (ZARYA)',
  OBJECT_ID: '1998-067A',
  NORAD_CAT_ID: 25544,
  EPOCH: epoch,
  MEAN_MOTION: 15.49150046,
  ECCENTRICITY: 0.0007139,
  INCLINATION: 51.6332,
  RA_OF_ASC_NODE: 335.9757,
  ARG_OF_PERICENTER: 339.3739,
  MEAN_ANOMALY: 20.6961,
  BSTAR: 0.00010508,
  MEAN_MOTION_DOT: 5.374e-5,
  MEAN_MOTION_DDOT: 0,
  ELEMENT_SET_NO: 999,
}
const hubble = {
  ...iss,
  OBJECT_NAME: 'HST',
  OBJECT_ID: '1990-037B',
  NORAD_CAT_ID: 20580,
  MEAN_MOTION: 15.30,
  INCLINATION: 28.47,
  MEAN_ANOMALY: 200,
}
const gps = {
  ...iss,
  OBJECT_NAME: 'GPS BIIF-1 (PRN 25)',
  OBJECT_ID: '2010-022A',
  NORAD_CAT_ID: 36585,
  MEAN_MOTION: 2.00563,
  ECCENTRICITY: 0.009,
  INCLINATION: 54.6,
  BSTAR: 0,
  MEAN_MOTION_DOT: 0,
}
const GROUPS: Record<string, unknown[]> = { stations: [iss], visual: [iss, hubble], gnss: [gps] }

async function stubSatellites(page: Page, { fail = false } = {}) {
  const asked: string[] = []
  await page.route(/\/api\/satellites\//, (route) => {
    const group = new URL(route.request().url()).pathname.split('/').pop()!
    asked.push(group)
    if (fail) return route.fulfill({ status: 503, json: { error: 'Satellite data unavailable, try again shortly' } })
    return route.fulfill({ json: { group, fetchedAt: new Date().toISOString(), satellites: GROUPS[group] ?? [] } })
  })
  return asked
}

async function openSpace(page: Page) {
  await stubHazardData(page)
  await stubNominatim(page)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Sea & space' }).click()
}

const status = (page: Page) => page.locator('.meta[role="status"]')
const credits = (page: Page) => page.locator('.cesium-widget-credits')
const infoTitle = (page: Page) => page.locator('.cesium-infoBox-title')
const infoBody = (page: Page) => page.frameLocator('.cesium-infoBox-iframe').locator('body')

test('satellites: load by group, merged once each, find one, see where it is', async ({ page }) => {
  const asked = await stubSatellites(page)
  await openSpace(page)
  expect(asked).toEqual([]) // nothing until a group is chosen

  await page.getByLabel('Space stations').check()
  await expect(status(page)).toHaveText('1 satellite, moving live')
  await page.getByLabel('Brightest').check()
  await expect(status(page)).toHaveText('2 satellites, moving live') // the ISS is in both
  await expect(page.locator('.toggle', { hasText: 'Brightest' })).toContainText('2')
  await expect(credits(page)).toContainText('Orbits: CelesTrak')
  expect(asked).toEqual(['stations', 'visual'])

  await page.getByLabel('Find a satellite by name or NORAD number').fill('iss')
  await page.getByRole('button', { name: /ISS \(ZARYA\)/ }).click()
  await expect(infoTitle(page)).toHaveText('ISS (ZARYA)')
  // Worked out live in the worker: a low orbit at ~7.7 km/s
  await expect(infoBody(page)).toContainText(/Altitude now\s*\d{3} km/)
  await expect(infoBody(page)).toContainText(/Speed\s*7\.\d\d km\/s/)
  await expect(infoBody(page)).toContainText('Low Earth orbit')
  await expect(infoBody(page)).not.toContainText('Height range') // round orbit

  await page.getByLabel('Find a satellite by name or NORAD number').fill('20580')
  await expect(page.getByRole('button', { name: /HST/ })).toBeVisible()

  // Off again: the selection goes with it, and nothing is fetched twice
  await page.getByLabel('Space stations').uncheck()
  await page.getByLabel('Brightest').uncheck()
  await expect(infoTitle(page)).not.toBeVisible()
  await expect(credits(page)).not.toContainText('CelesTrak')
  await page.getByLabel('Navigation (GPS, Galileo…)').check()
  await page.getByLabel('Space stations').check()
  await expect(status(page)).toHaveText('2 satellites, moving live')
  expect(asked).toEqual(['stations', 'visual', 'gnss'])

  await page.getByLabel('Find a satellite by name or NORAD number').fill('GPS')
  await page.getByRole('button', { name: /GPS BIIF-1/ }).click()
  await expect(infoBody(page)).toContainText('Medium (navigation)')
  await expect(infoBody(page)).toContainText(/Altitude now\s*\d{2},\d{3} km/)
})

test('satellites: click one on the globe; clicks elsewhere still reach the rest of the globe', async ({ page }) => {
  await stubSatellites(page)
  await openSpace(page)
  await page.getByLabel('Navigation (GPS, Galileo…)').check()
  await page.getByLabel('Find a satellite by name or NORAD number').fill('GPS')
  await page.getByRole('button', { name: /GPS BIIF-1/ }).click() // flies to look straight down at it
  await expect(infoTitle(page)).toHaveText('GPS BIIF-1 (PRN 25)')
  await page.locator('.cesium-infoBox-close').click()
  await expect(infoTitle(page)).not.toBeVisible()

  // Navigation satellites barely move across the screen, so it's still in the middle once the flight is over
  const box = (await page.locator('.globe canvas').boundingBox())!
  await expect(async () => {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(infoTitle(page)).toHaveText('GPS BIIF-1 (PRN 25)', { timeout: 1_000 })
  }).toPass({ timeout: 10_000 })

  // Empty space below the globe isn't a satellite: Cesium's own click runs and clears the selection
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 120)
  await expect(infoTitle(page)).not.toBeVisible()
})

test('satellites: hidden in history, which is about past days', async ({ page }) => {
  await stubSatellites(page)
  await page.route(/\/api\/events\/history/, (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 30, type: 'FeatureCollection', features: [] } }),
  )
  await openSpace(page)
  await page.getByLabel('Space stations').check()
  await expect(credits(page)).toContainText('Orbits: CelesTrak')

  await page.getByRole('tab', { name: 'Events' }).click()
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('tab', { name: 'Sea & space' }).click()
  await expect(page.getByText("Satellites are shown where they are now, so they're hidden while you look at history.")).toBeVisible()
  await expect(credits(page)).not.toContainText('CelesTrak')

  await page.getByRole('button', { name: 'Back to live' }).click()
  await expect(status(page)).toHaveText('1 satellite, moving live')
  await expect(credits(page)).toContainText('Orbits: CelesTrak')
})

test('satellites: says so when the server has none', async ({ page }) => {
  await stubSatellites(page, { fail: true })
  await openSpace(page)
  await page.getByLabel('Weather').check()
  await expect(page.getByText("Couldn't load some satellites: Satellite data unavailable, try again shortly")).toBeVisible()
})
