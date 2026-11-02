import { expect, test, type Page } from '@playwright/test'
import { stubHazardData, stubNominatim } from './stubs'

// A steady 10 m/s westerly everywhere
const grid = {
  run: '2026-11-02T18:00:00.000Z',
  validTime: '2026-11-02T21:00:00.000Z',
  width: 361,
  height: 181,
  bounds: { west: -180, east: 180, south: -90, north: 90 },
  u: Array(361 * 181).fill(10),
  v: Array(361 * 181).fill(0),
}

async function stubWind(page: Page, { fail = false } = {}) {
  let asked = 0
  await page.route(/\/api\/weather\/wind$/, (r) => {
    asked++
    return fail
      ? r.fulfill({ status: 503, json: { error: 'Wind data unavailable, try again shortly' } })
      : r.fulfill({ json: grid })
  })
  return () => asked
}

/** How many pixels of the wind overlay have something drawn on them */
const drawnPixels = (page: Page) =>
  page.locator('canvas.wind-particles').evaluate((c: HTMLCanvasElement) => {
    if (!c.width || !c.height) return 0
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    let n = 0
    for (let i = 3; i < data.length; i += 4) if (data[i]) n++
    return n
  })

test.use({ timezoneId: 'UTC' })

test.beforeEach(async ({ page }) => {
  await stubHazardData(page)
  await stubNominatim(page)
  await page.route(/\/api\/events\/history/, (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 30, type: 'FeatureCollection', features: [] } }),
  )
})

test('wind: particles drawn over the globe, hidden in history and when switched off', async ({ page }) => {
  const asked = await stubWind(page)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Weather' }).click()
  expect(asked()).toBe(0) // nothing until it's switched on

  await page.getByLabel('Show wind, moving').check()
  await expect(page.locator('.wind .meta')).toHaveText('Forecast for Mon 21:00, 10 m above the ground')
  await expect.poll(() => drawnPixels(page), { timeout: 15_000 }).toBeGreaterThan(200)
  expect(asked()).toBe(1)

  await page.getByRole('tab', { name: 'Events' }).click()
  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.locator('canvas.wind-particles')).toBeHidden()
  await page.getByRole('button', { name: 'Back to live' }).click()
  await expect(page.locator('canvas.wind-particles')).toBeVisible()
  await expect.poll(() => drawnPixels(page), { timeout: 15_000 }).toBeGreaterThan(200)

  await page.getByRole('tab', { name: 'Weather' }).click()
  await page.getByLabel('Show wind, moving').uncheck()
  await expect(page.locator('canvas.wind-particles')).toBeHidden()
  expect(await drawnPixels(page)).toBe(0)
})

test('wind: says so when the server has none', async ({ page }) => {
  await stubWind(page, { fail: true })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Weather' }).click()
  await page.getByLabel('Show wind, moving').check()
  await expect(page.getByText("Couldn't load the wind: Wind data unavailable, try again shortly")).toBeVisible()
})

test('wind: keeps drawing on the flat 2D map', async ({ page }) => {
  await stubWind(page)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.getByRole('tab', { name: 'Weather' }).click()
  await page.getByLabel('Show wind, moving').check()
  await expect.poll(() => drawnPixels(page), { timeout: 15_000 }).toBeGreaterThan(200)

  const picker = page.locator('.cesium-sceneModePicker-wrapper > button').first()
  await picker.click()
  await page.getByRole('button', { name: '2D', exact: true }).last().click()
  await expect(picker).toHaveAttribute('title', '2D')
  await page.getByRole('button', { name: 'Zoom in' }).click({ delay: 600 })
  await expect.poll(() => drawnPixels(page), { timeout: 15_000 }).toBeGreaterThan(200)
  expect(errors).toEqual([])
})
