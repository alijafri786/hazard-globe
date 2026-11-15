import { expect, test, type Page } from '@playwright/test'
import { stubHazardData } from './stubs'

const DAY = 86_400_000
const today = Math.floor(Date.now() / DAY) * DAY
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)
const formatDay = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

// A 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'layer-time-actual' }

/**
 * Stubs NASA GIBS: "default" is yesterday, and the days in `missing` have no tiles. Returns the days
 * tiles were asked for, by layer.
 */
async function stubGibs(page: Page, { missing = [] as string[] } = {}) {
  const asked = new Map<string, Set<string>>()
  await page.route('https://gibs.earthdata.nasa.gov/**', (r) => {
    const [, layer, , time] = new URL(r.request().url()).pathname.split('/').slice(3)
    if (!asked.has(layer)) asked.set(layer, new Set())
    asked.get(layer)!.add(time)
    if (missing.includes(time)) return r.fulfill({ status: 404, headers: CORS, body: 'not found' })
    const actual = time === 'default' ? isoDay(today - DAY) : time
    return r.fulfill({ body: PNG, contentType: 'image/png', headers: { ...CORS, 'layer-time-actual': `${actual}T00:00:00Z` } })
  })
  return (layer: string) => [...(asked.get(layer) ?? [])].filter((t) => t !== 'default')
}

test('a sea overlay shows the newest day NASA has, one overlay at a time', async ({ page }) => {
  await stubHazardData(page)
  const days = await stubGibs(page)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Sea & space' }).click()

  await page.getByLabel('Sea temperature', { exact: true }).check()
  await expect(page.getByRole('status').filter({ hasText: 'Sea temperature:' })).toHaveText(
    `Sea temperature: ${formatDay(today - DAY)}`,
  )
  await expect.poll(() => days('GHRSST_L4_MUR_Sea_Surface_Temperature')).toEqual([isoDay(today - DAY)])

  await page.getByLabel('Sea ice').check()
  await page.getByRole('button', { name: /^Layers/ }).click()
  const list = page.getByRole('dialog', { name: 'Layers' })
  await expect(list.getByLabel('Sea ice')).toBeChecked()
  await expect(list.getByLabel('Sea temperature', { exact: true })).not.toBeChecked()

  // the layer list keeps to one as well
  await list.getByLabel('Sea temperature anomaly').check()
  await expect(list.getByLabel('Sea ice')).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Map key' })).toContainText('Sea temperature against normal, °C')
})

test('in History, rainfall shows the day looked at, or the day before when NASA has none for it', async ({ page }) => {
  await stubHazardData(page)
  await page.route(/\/api\/events\/history/, (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 30, type: 'FeatureCollection', features: [] } }),
  )
  const missingDay = today - 5 * DAY
  const days = await stubGibs(page, { missing: [isoDay(missingDay)] })
  await page.goto(`/#tab=weather&layers=gibs-rain&history=30:${isoDay(missingDay)}`)

  // The Weather tab hides what's only about now, but rainfall has past days
  await expect(page.getByText(/Clouds, wind and temperature show the last few hours/)).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Rainfall (NASA IMERG)' })).toBeChecked()
  await expect(page.getByRole('status').filter({ hasText: 'Rainfall (NASA IMERG):' })).toHaveText(
    `Rainfall (NASA IMERG): ${formatDay(missingDay - DAY)}`,
  )
  await expect.poll(() => days('IMERG_Precipitation_Rate')).toContain(isoDay(missingDay - DAY))
})

test('says so when NASA has nothing for a day or the two before it', async ({ page }) => {
  await stubHazardData(page)
  await page.route(/\/api\/events\/history/, (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 30, type: 'FeatureCollection', features: [] } }),
  )
  const day = today - 10 * DAY
  await stubGibs(page, { missing: [0, 1, 2].map((back) => isoDay(day - back * DAY)) })
  await page.goto(`/#tab=space&layers=gibs-sst&history=30:${isoDay(day)}`)
  await expect(page.getByText('NASA has no map for this day or the two before it.')).toBeVisible()
})

test('fires come as images NASA draws, from the newest day it has', async ({ page }) => {
  await stubHazardData(page)
  const yesterday = isoDay(today - DAY)
  const times: string[] = []
  // WMS answers a day it lacks with an XML error, status 200: today it lacks
  await page.route('https://gibs.earthdata.nasa.gov/wms/**', (r) => {
    const q = new URL(r.request().url()).searchParams
    const time = q.get('TIME') ?? q.get('time') ?? ''
    times.push(time)
    if (time === isoDay(today)) return r.fulfill({ body: '<ServiceExceptionReport/>', contentType: 'text/xml', headers: CORS })
    return r.fulfill({ body: PNG, contentType: 'image/png', headers: CORS })
  })
  await page.goto('/')
  await page.getByLabel('Fires seen from space').check()
  await expect(page.getByRole('status').filter({ hasText: 'Fires seen from space:' })).toHaveText(
    `Fires seen from space: ${formatDay(today - DAY)}`,
  )
  await expect(page.locator('.gibs .swatch')).toHaveText('Fire seen by satellite that day')
  await expect.poll(() => times.filter((t) => t === yesterday).length).toBeGreaterThan(1) // the check, then the tiles
  expect(times).not.toContain(isoDay(today - 2 * DAY))
})
