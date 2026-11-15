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


const camOf = (link: string) => new URLSearchParams(new URL(link).hash.slice(1)).get('cam')
const modeOf = (link: string) => new URLSearchParams(new URL(link).hash.slice(1)).get('mode')

test('Share mid-way from 3D to 2D gives the view as it was before the change', async ({ page }) => {
  await stub(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // The page's clock is ours: frozen, Cesium can't move the change along, so Share lands mid-way every time
  await page.clock.install()
  await page.goto('/#cam=-60.0000,20.0000,9000000,0.0,-90.0')
  await expect(page.locator('.events strong')).toHaveText(['Storm Linky'])
  const share = page.getByRole('button', { name: 'Share' })
  await share.click()
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible()
  const before = await page.evaluate(() => navigator.clipboard.readText())
  expect(camOf(before)).toBe('-60.0000,20.0000,9000000,0.0,-90.0')

  await page.clock.pauseAt(Date.now() + 5_000) // past the "Link copied" note, then frozen
  const picker = page.locator('.cesium-sceneModePicker-wrapper > button').first()
  await picker.click()
  await page.getByRole('button', { name: '2D', exact: true }).last().click()
  // One second into the two-second change: the camera is mid-way between the two projections, where
  // reading it gives a place that isn't on either
  await page.clock.runFor(1_000)
  await page.evaluate(() => navigator.clipboard.writeText(''))
  await share.click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe('')
  const midway = await page.evaluate(() => navigator.clipboard.readText())
  expect(camOf(midway)).toBe(camOf(before)) // not a blend of the two projections
  expect(modeOf(midway)).toBeNull() // still the 3D view it was

  // Once the change is over, the address says 2D, once, without polling through it
  await page.clock.resume()
  await expect(picker).toHaveAttribute('title', '2D')
  // (read from the page: Playwright's page.url() lags behind replaceState while it holds the clock)
  const hash = () => page.evaluate(() => location.href)
  // software rendering takes a while to finish the change once the clock runs again
  await expect.poll(async () => modeOf(await hash()), { timeout: 30_000 }).toBe('2d')
  expect(errors).toEqual([])
})

test('a link made in 2D opens in 2D, at the same width of view', async ({ page }) => {
  await stub(page)
  await page.goto('/#cam=-60.0000,20.0000,12000000,0.0,-90.0&mode=2d')
  const picker = page.locator('.cesium-sceneModePicker-wrapper > button').first()
  await expect(picker).toHaveAttribute('title', '2D')
  // written back as it was read: the 2D width round-trips through setView
  await page.getByRole('tab', { name: 'Flights' }).click()
  await expect.poll(() => new URL(page.url()).hash).toContain('tab=flights')
  expect(camOf(page.url())).toBe('-60.0000,20.0000,12000000,0.0,-90.0')
  expect(modeOf(page.url())).toBe('2d')
})

test('a link keeps the quake feed and satellite groups, and loads only those', async ({ page }) => {
  await stub(page)
  const feeds: string[] = []
  const groups: string[] = []
  await page.route(/\/api\/earthquakes/, (r) => {
    const feed = new URL(r.request().url()).searchParams.get('feed')!
    feeds.push(feed)
    return r.fulfill({ json: { feed, fetchedAt: new Date().toISOString(), generatedAt: null, quakes: [] } })
  })
  await page.route(/\/api\/satellites\//, (r) => {
    const group = new URL(r.request().url()).pathname.split('/').pop()!
    groups.push(group)
    return r.fulfill({ json: { group, fetchedAt: new Date().toISOString(), satellites: [] } })
  })
  await page.goto('/#layers=gdacs-TC,satellites,usgs-quakes&quakes=week&sats=gnss')

  await expect.poll(() => feeds).toEqual(['week']) // never the default day feed first
  await expect.poll(() => groups).toEqual(['gnss']) // nor the default stations and brightest
  await page.getByRole('tab', { name: 'Sea & space' }).click()
  await expect(page.getByLabel('Navigation (GPS, Galileo…)')).toBeChecked()
  await expect(page.getByLabel('Space stations')).not.toBeChecked()

  await page.getByLabel('Weather', { exact: true }).check()
  await expect.poll(() => new URL(page.url()).hash).toContain('sats=gnss,weather')
  expect(new URL(page.url()).hash).toContain('quakes=week')
})
