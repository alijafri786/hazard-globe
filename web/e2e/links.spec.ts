import { expect, test, type Page } from '@playwright/test'
import { stubHazardData } from './stubs'

const DAY = 86_400_000
const today = Math.floor(Date.now() / DAY) * DAY
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)
const gdacs = (t: number) => new Date(t).toISOString().slice(0, 19)
const formatDay = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

const storm = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-60, 20] },
  properties: {
    eventtype: 'TC',
    eventid: 1001,
    episodeid: 1,
    name: 'Storm Linky',
    alertlevel: 'Orange',
    fromdate: gdacs(today - 8 * DAY),
    todate: gdacs(today - 3 * DAY),
  },
}

async function stub(page: Page) {
  const collection = (days: number) => ({ fetchedAt: new Date().toISOString(), days, type: 'FeatureCollection', features: [storm] })
  await page.route('**/api/events', (r) => r.fulfill({ json: collection(10) }))
  await page.route(/\/api\/events\/history/, (r) => r.fulfill({ json: collection(30) }))
  await page.route(/\/geometry$/, (r) => r.fulfill({ json: { type: 'FeatureCollection', features: [] } }))
  await page.route(/\/api\/weather\/wind/, (r) => r.fulfill({ status: 503, json: { error: 'stub' } }))
}

const hash = (page: Page) => new URL(page.url()).hash

test('a shared link opens the same view: layers, tab, History day and selected event', async ({ page }) => {
  await stub(page)
  const day = today - 5 * DAY
  await page.goto(`/#cam=-60.0000,20.0000,4000000,0.0,-90.0&layers=gdacs-TC,wind&tab=weather&history=30:${isoDay(day)}&event=TC-1001`)

  await expect(page.getByRole('tab', { name: 'Weather' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('status').filter({ hasText: 'History ·' })).toContainText(formatDay(day))
  await expect(page.locator('.cesium-infoBox-title')).toHaveText('Storm Linky')

  // (the Weather tab hides its own controls while looking back, so ask the layer list)
  await page.getByRole('button', { name: /^Layers/ }).click()
  const list = page.getByRole('dialog', { name: 'Layers' })
  await expect(list.getByLabel('Tropical cyclones')).toBeChecked()
  await expect(list.getByLabel('Wind')).toBeChecked()
  await expect(list.getByLabel('Floods')).not.toBeChecked()
})

test('the address follows the view, and never holds watch areas', async ({ page }) => {
  await stub(page)
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: 51.5, longitude: -0.12 })
  await page.goto('/')

  await page.getByRole('button', { name: /^Layers/ }).click()
  await page.getByRole('dialog', { name: 'Layers' }).getByLabel('Wind').check()
  await page.keyboard.press('Escape')
  await expect.poll(() => hash(page)).toContain('wind')
  expect(hash(page)).toMatch(/cam=-?\d/)

  await page.getByRole('tab', { name: 'My alerts' }).click()
  await page.getByRole('button', { name: '+ Add area' }).click()
  await page.getByRole('button', { name: 'Use my location' }).click()
  await page.getByLabel('Name').fill('Secret home')
  await page.getByRole('button', { name: 'Add area', exact: true }).click()
  await expect.poll(() => hash(page)).toContain('tab=alerts')
  expect(decodeURIComponent(hash(page))).not.toMatch(/Secret|home|51\.5|radius/i)
})

test('a malformed link is ignored, not obeyed', async ({ page }) => {
  await stub(page)
  await page.goto('/#cam=abc,1,2&layers=<script>,nolayer&event=../../x&history=99:2026-01-01&tab=nope')
  await expect(page.getByRole('tab', { name: 'Events' })).toHaveAttribute('aria-selected', 'true')
  // live, with the GDACS layers still on: a list naming no real layer changes nothing
  await expect(page.locator('.events strong')).toHaveText(['Storm Linky'])
  await expect(page.getByRole('status').filter({ hasText: 'History ·' })).toHaveCount(0)
  await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0)
})

test('a link with every layer off opens with every layer off', async ({ page }) => {
  await stub(page)
  await page.goto('/#layers=')
  await expect(page.getByRole('button', { name: /^Layers/ })).toContainText('0')
})

test('Share copies a link to this view', async ({ page }) => {
  await stub(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.getByRole('tab', { name: 'Flights' }).click()
  await page.getByRole('button', { name: 'Share' }).click()
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('tab=flights')
  expect(new URL(copied).origin).toBe(new URL(page.url()).origin)
})

test('embedded, it shows the globe and its key, with a way out to the full app', async ({ page }) => {
  await stubHazardData(page)
  await page.goto('/?embed=1')
  await expect(page.getByRole('link', { name: 'Open in Hazard Globe ↗' })).toBeVisible()
  await expect(page.getByText('Hazard Globe', { exact: true })).toHaveCount(0) // no side panel
  await expect(page.getByRole('complementary', { name: 'Map key' })).toBeVisible()
})

test('Share mid-way between 3D and 2D gives a link and no error', async ({ page }) => {
  await stub(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')

  const picker = page.locator('.cesium-sceneModePicker-wrapper > button').first()
  await picker.click()
  await page.getByRole('button', { name: '2D', exact: true }).last().click()
  // the camera has no heading or pitch until the change is over
  await page.getByRole('button', { name: 'Share' }).click()
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/cam=-?\d/)

  await expect(picker).toHaveAttribute('title', '2D')
  await expect.poll(() => new URL(page.url()).hash).toMatch(/cam=-?\d/)
  expect(errors).toEqual([])
})
