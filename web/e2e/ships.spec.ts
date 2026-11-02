import { expect, test, type Page } from '@playwright/test'
import { stubHazardData, stubNominatim } from './stubs'

const everGiven = [353136000, 'EVER GIVEN', 70, 4.05, 51.9, 12.4, 87, 87, 30]
const tanker = [244010000, 'NORDIC SPIRIT', 80, 3.5, 51.6, 0, null, null, 300]
const yacht = [235000001, '', 37, -1.3, 50.7, 6.2, 210, null, 60]
const details = {
  mmsi: 353136000,
  name: 'EVER GIVEN',
  type: 70,
  sog: 12.4,
  cog: 87,
  heading: 87,
  navStatus: 0,
  seenAt: new Date().toISOString(),
  destination: 'NLRTM',
  callSign: 'H3RC',
  imo: 9811000,
  lengthM: 400,
  widthM: 59,
}

async function stubShips(page: Page, snapshot: Record<string, unknown> | 'not set up') {
  const asked: string[] = []
  await page.route(/\/api\/ships(\/\d+)?$/, (route) => {
    const path = new URL(route.request().url()).pathname
    asked.push(path)
    if (snapshot === 'not set up') {
      return route.fulfill({ status: 501, json: { error: "Ships aren't set up on this server" } })
    }
    if (path === '/api/ships') return route.fulfill({ json: snapshot })
    return path.endsWith('/353136000')
      ? route.fulfill({ json: details })
      : route.fulfill({ status: 404, json: { error: 'No recent report from this ship' } })
  })
  return asked
}

const snapshot = (extra: Record<string, unknown> = {}) => ({
  time: new Date().toISOString(),
  refreshSeconds: 120,
  receiving: true,
  collectingSince: new Date(Date.now() - 60 * 60_000).toISOString(),
  error: null,
  ships: [everGiven, tanker, yacht],
  ...extra,
})

async function openShips(page: Page) {
  await stubHazardData(page)
  await stubNominatim(page)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Sea & space' }).click()
  await page.getByLabel('Show ships').check()
}

const status = (page: Page) => page.locator('.ships .meta[role="status"]')
const credits = (page: Page) => page.locator('.cesium-widget-credits')
const infoTitle = (page: Page) => page.locator('.cesium-infoBox-title')
const infoBody = (page: Page) => page.frameLocator('.cesium-infoBox-iframe').locator('body')

test('ships: shown with the AIS credit, found by name or MMSI, with details from the server', async ({ page }) => {
  const asked = await stubShips(page, snapshot())
  await openShips(page)
  await expect(status(page)).toContainText('3 ships · reported')
  await expect(credits(page)).toContainText('Ships: AISStream.io')
  await expect(page.getByText('Collecting positions')).toBeHidden() // the feed has been running an hour

  const find = page.getByLabel('Find a ship by name or MMSI')
  await find.fill('ever')
  await page.getByRole('button', { name: /EVER GIVEN/ }).click()
  await expect(infoTitle(page)).toHaveText('EVER GIVEN')
  // Destination and size come from the details the server is asked for on selection
  await expect(infoBody(page)).toContainText(/Destination\s*NLRTM/)
  await expect(infoBody(page)).toContainText(/Size\s*400 × 59 m/)
  await expect(infoBody(page)).toContainText(/Status\s*Under way, using engine/)
  await expect(infoBody(page)).toContainText(/Speed\s*12\.4 kn/)
  expect(asked).toContain('/api/ships/353136000')

  // No name yet (it hasn't sent its static data): found by MMSI, and named by it
  await find.fill('235000001')
  await page.getByRole('button', { name: /MMSI 235000001/ }).click()
  await expect(infoTitle(page)).toHaveText('MMSI 235000001')
  await expect(infoBody(page)).toContainText(/Type\s*Pleasure craft/)

  await page.getByLabel('Show ships').uncheck()
  await expect(credits(page)).not.toContainText('AISStream')
  await expect(infoTitle(page)).not.toBeVisible()
})

test('ships: says when the server has only just started collecting, or AISStream refused it', async ({ page }) => {
  await stubShips(page, snapshot({ collectingSince: new Date(Date.now() - 60_000).toISOString(), ships: [everGiven] }))
  await openShips(page)
  await expect(page.getByText('Collecting positions: ships appear over the first few minutes')).toBeVisible()
  await expect(status(page)).toContainText('1 ship · reported')

  await page.unroute(/\/api\/ships(\/\d+)?$/)
  await stubShips(page, snapshot({ receiving: false, error: 'Api Key Is Not Valid', ships: [] }))
  await page.getByLabel('Show ships').uncheck()
  await page.reload()
  await page.getByRole('tab', { name: 'Sea & space' }).click()
  await page.getByLabel('Show ships').check()
  await expect(page.getByText("Couldn't get ships: Api Key Is Not Valid")).toBeVisible()
})

test("ships: says so when the server isn't set up for them", async ({ page }) => {
  await stubShips(page, 'not set up')
  await openShips(page)
  await expect(page.getByText("Ships aren't set up on this server: it needs a free AISStream.io key")).toBeVisible()
  await expect(page.getByLabel('Find a ship by name or MMSI')).toHaveCount(0)
})

test('ships: hidden in history, which is about past days', async ({ page }) => {
  await stubShips(page, snapshot())
  await page.route(/\/api\/events\/history/, (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 30, type: 'FeatureCollection', features: [] } }),
  )
  await openShips(page)
  await expect(credits(page)).toContainText('Ships: AISStream.io')
  await page.getByRole('tab', { name: 'Events' }).click()
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('tab', { name: 'Sea & space' }).click()
  await expect(page.getByText("Ships are shown where they are now, so they're hidden while you look at history.")).toBeVisible()
  await expect(credits(page)).not.toContainText('AISStream')
  await page.getByRole('button', { name: 'Back to live' }).click()
  await expect(credits(page)).toContainText('Ships: AISStream.io')
})

test('ships: switched off and on again, the snapshot in hand is used and the next one is still fetched', async ({
  page,
}) => {
  await page.clock.install()
  const asked = await stubShips(page, snapshot())
  await openShips(page)
  await expect(status(page)).toContainText('3 ships')
  await page.getByLabel('Show ships').uncheck()
  await page.getByLabel('Show ships').check()
  expect(asked.filter((p) => p === '/api/ships')).toHaveLength(1) // reused, not fetched again

  await page.clock.fastForward('00:02:10') // past the snapshot's 2 minutes
  await expect.poll(() => asked.filter((p) => p === '/api/ships').length).toBe(2)
})
