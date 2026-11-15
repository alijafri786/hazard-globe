import { expect, test, type Page } from '@playwright/test'
import { stubHazardData } from './stubs'

test.use({ geolocation: { latitude: 25.8, longitude: -80.2 }, permissions: ['geolocation'] })

const info = {
  source: 'NOAA NCEI IBTrACS v04r01, since-1980 file',
  citation: 'Knapp et al. (2010)',
  from: '1980-01-02',
  to: '2026-11-12',
  years: 46.86,
  storms: 4101,
  reachKm: 100,
  classes: { all: 34, hurricane: 64, major: 96 },
  built: '2026-11-15T00:00:00.000Z',
  grids: [
    { res: 0.5, cols: 720, rows: 360 },
    { res: 1, cols: 360, rows: 180 },
  ],
}

/** Stubs the climatology API; returns the grids asked for, as "class:month" */
async function stub(page: Page) {
  const asked: string[] = []
  await page.route(/\/api\/climatology$/, (r) => r.fulfill({ json: info }))
  await page.route(/\/api\/climatology\/grid/, (r) => {
    const q = new URL(r.request().url()).searchParams
    asked.push(`${q.get('class')}:${q.get('month')}`)
    const { cols, rows } = info.grids[q.get('month') === '0' ? 0 : 1]
    const grid = new Uint16Array(cols * rows)
    for (let i = 0; i < grid.length; i += 7) grid[i] = i % 70 // something to draw
    return r.fulfill({ body: Buffer.from(grid.buffer), contentType: 'application/octet-stream' })
  })
  await page.route(/\/api\/climatology\/near/, (r) => {
    const radiusKm = Number(new URL(r.request().url()).searchParams.get('radiusKm'))
    return r.fulfill({
      json: {
        from: '1980-01-02',
        to: '2026-11-12',
        years: 46.86,
        radiusKm,
        storms: 19,
        hurricane: 5,
        major: 2,
        peakMonths: [9, 8, 10],
        strongest: { name: 'ANDREW', year: 1992, kt: 145 },
      },
    })
  })
  return asked
}

const key = (page: Page) => page.getByRole('complementary', { name: 'Map key' })

test('storm climatology loads only when switched on, then the strength and month chosen', async ({ page }) => {
  await stubHazardData(page)
  const asked = await stub(page)
  await page.goto('/')
  await expect(page.locator('.climatology')).toBeVisible()
  expect(asked).toEqual([])

  await page.getByLabel(/How often storms pass/).check()
  await expect.poll(() => asked).toEqual(['all:0'])
  await expect(page.locator('.climatology')).toContainText('4,101 storms, 1980-01-02 to 2026-11-12')
  await expect(key(page)).toContainText('Storms a decade within 100 km')

  await page.getByLabel('Strength').selectOption('hurricane')
  await page.getByLabel('When').selectOption({ label: 'Sep only' })
  await expect.poll(() => asked).toEqual(['all:0', 'hurricane:0', 'hurricane:9'])

  // About past decades, so it stays while looking back
  await page.route(/\/api\/events\/history/, (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 30, type: 'FeatureCollection', features: [] } }),
  )
  await page.getByRole('button', { name: 'History' }).click()
  await expect(key(page)).toContainText('Storms a decade within 100 km')

  // and a grid already fetched isn't fetched again
  await page.getByLabel('Strength').selectOption('all')
  await page.getByLabel('When').selectOption({ label: 'The whole year' })
  await page.waitForTimeout(500)
  expect(asked.filter((a) => a === 'all:0')).toHaveLength(1)
})

test('a link keeps the strength and month', async ({ page }) => {
  await stubHazardData(page)
  const asked = await stub(page)
  await page.goto('/#layers=gdacs-TC,climatology&clim=major:8')
  await expect.poll(() => asked).toEqual(['major:8']) // not the whole year first
  await expect(page.getByLabel('Strength')).toHaveValue('major')
  await page.getByLabel('When').selectOption({ label: 'Oct only' })
  await expect.poll(() => new URL(page.url()).hash).toContain('clim=major:10')
})

test('a watch area that watches storms says how often they have passed', async ({ page }) => {
  await stubHazardData(page)
  await stub(page)
  await page.goto('/')
  await page.getByRole('tab', { name: 'My alerts' }).click()
  await page.getByRole('button', { name: '+ Add area' }).click()
  await page.getByRole('button', { name: 'Use my location' }).click()
  const editor = page.locator('form.editor')
  const history = 'Since 1980: 19 storms within 150 km, 5 at hurricane strength (2 major), most in Sep, Aug and Oct. Strongest: Andrew (1992), 145 kt.'
  await expect(editor.getByText(history)).toBeVisible()

  await page.getByLabel('Name').fill('Miami')
  await page.getByRole('button', { name: 'Add area', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Miami' })).toContainText(history)

  // Not for an area that doesn't watch storms
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.locator('form.editor').getByLabel('Tropical cyclones').uncheck()
  await expect(page.locator('form.editor').getByText(/Since 1980/)).toHaveCount(0)
})
