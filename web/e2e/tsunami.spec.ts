import { expect, test, type Page } from '@playwright/test'
import { stubHazardData } from './stubs'

test.use({ geolocation: { latitude: 21.3, longitude: -157.8 }, permissions: ['geolocation'] }) // Honolulu

const H = 3_600_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const message = (over: Record<string, unknown>) => ({
  id: 'urn:uuid:1',
  centre: 'PTWC',
  event: 'PHEB-1',
  type: 'information',
  issuedAt: iso(H),
  region: 'NEAR THE COAST OF SOMEWHERE',
  lat: 20,
  lon: -155,
  magnitude: 6.1,
  url: 'https://www.tsunami.gov/events/PHEB/2026/11/15/1/1/WEPA40/WEPA40.txt',
  ...over,
})

async function stub(page: Page, messages: object[]) {
  await stubHazardData(page)
  await page.route(/\/api\/tsunami/, (r) => r.fulfill({ json: { fetchedAt: new Date().toISOString(), messages } }))
}

const banner = (page: Page) => page.getByRole('alert')

test('a warning in force shows across the top, with the bulletin, layer on or not', async ({ page }) => {
  await stub(page, [
    message({ id: 'urn:uuid:2', event: 'PHEB-7', type: 'warning', region: 'OFF THE EAST COAST OF HONSHU', issuedAt: iso(2 * H) }),
    message({}),
  ])
  await page.goto('/')
  await expect(banner(page)).toContainText('Tsunami warning: OFF THE EAST COAST OF HONSHU.')
  await expect(banner(page)).toContainText('Follow your local authorities.')
  await expect(banner(page).getByRole('link', { name: 'NOAA bulletin ↗' })).toHaveAttribute('href', /^https:\/\/www\.tsunami\.gov\//)

  await page.getByLabel('Tsunami messages, the last day').check()
  await expect(page.locator('.tsunami .messages li')).toHaveCount(2)
  await expect(page.locator('.tsunami .messages li').first()).toContainText('Warning: OFF THE EAST COAST OF HONSHU')
})

test('no banner once the warning is cancelled, nor for information alone', async ({ page }) => {
  await stub(page, [
    message({ id: 'urn:uuid:3', event: 'PHEB-7', type: 'cancellation', issuedAt: iso(H) }), // newest first
    message({ id: 'urn:uuid:2', event: 'PHEB-7', type: 'warning', issuedAt: iso(3 * H) }),
    message({}),
  ])
  await page.goto('/')
  await page.getByLabel('Tsunami messages, the last day').check()
  await expect(page.locator('.tsunami .messages li')).toHaveCount(3) // loaded, so the banner had its chance
  await expect(banner(page)).toHaveCount(0)
})

test('the banner is about now, so it goes while looking back', async ({ page }) => {
  await stub(page, [message({ type: 'warning' })])
  await page.route(/\/api\/events\/history/, (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 30, type: 'FeatureCollection', features: [] } }),
  )
  await page.goto('/')
  await expect(banner(page)).toBeVisible()
  await page.getByRole('button', { name: 'History' }).click()
  await expect(banner(page)).toHaveCount(0)
})

test('a DART buoy’s card shows its last day of water height, and when it has triggered', async ({ page }) => {
  await stub(page, [])
  const readings = Array.from({ length: 96 }, (_, i) => ({
    time: new Date(Date.now() - (96 - i) * 15 * 60_000).toISOString(),
    heightM: 4717 + 0.3 * Math.sin(i / 8),
  }))
  // At the middle of Cesium's default view (82.5° W, 35° N), so a click there finds it
  await page.route(/\/api\/dart$/, (r) => r.fulfill({ json: { stations: [{ id: '21415', name: 'TEST BUOY', lat: 35, lon: -82.5 }] } }))
  await page.route(/\/api\/dart\/21415/, (r) => r.fulfill({ json: { id: '21415', readings, eventMode: true } }))
  await page.goto('/')
  await page.getByLabel('Earthquakes', { exact: true }).uncheck()
  await page.getByLabel('DART buoys on the ocean floor').check()
  await page.locator('.panel .grip').click()
  const box = (await page.locator('.globe canvas').first().boundingBox())!
  await page.waitForTimeout(2000)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  await expect(page.locator('.cesium-infoBox-title')).toHaveText('DART buoy 21415')
  const card = page.frameLocator('.cesium-infoBox-iframe')
  await expect(card.getByText('In event mode:')).toBeVisible()
  await expect(card.getByRole('img', { name: /Water height over the last day/ })).toBeVisible()
})

test('a watch area can ask for tsunami messages, and is told what they cover', async ({ page }) => {
  await stub(page, [])
  await page.goto('/')
  await page.getByRole('tab', { name: 'My alerts' }).click()
  await page.getByRole('button', { name: '+ Add area' }).click()
  await page.getByRole('button', { name: 'Use my location' }).click()
  const editor = page.locator('form.editor')
  await expect(editor.getByLabel('Fires nearby')).toHaveCount(0) // this server has no FIRMS key
  await editor.getByLabel('Tsunami messages').check()
  await expect(editor.getByText(/cover the Pacific, the Caribbean and North American coasts/)).toBeVisible()
  await page.getByLabel('Name').fill('Honolulu')
  await page.getByRole('button', { name: 'Add area', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Honolulu' })).toContainText('Storms, floods and tsunami messages')
})
