import { expect, test, type Page } from '@playwright/test'
import { stubHazardData } from './stubs'

test.use({ geolocation: { latitude: 69.65, longitude: 18.96 }, permissions: ['geolocation'] }) // Tromsø

const H = 3_600_000
const start = Math.floor(Date.now() / (3 * H)) * 3 * H - 24 * H

/** 35% chance over a band round 66–72°N, nothing elsewhere */
function auroraGrid() {
  const bytes = new Uint8Array(360 * 180)
  for (let row = 90 - 72; row <= 90 - 66; row++) bytes.fill(35, row * 360, row * 360 + 360)
  return {
    observedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    forecastAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    cols: 360,
    rows: 180,
    data: Buffer.from(bytes).toString('base64'),
  }
}

function summary() {
  const kp = Array.from({ length: 32 }, (_, i) => {
    const time = start + i * 3 * H
    return { time: new Date(time).toISOString(), kp: i === 6 ? 5.33 : 2, observed: time <= Date.now() }
  })
  return { fetchedAt: new Date().toISOString(), now: kp.filter((p) => p.observed).at(-1), kp, scales: { G: 1, S: 0, R: 0 } }
}

async function stub(page: Page) {
  const asked: string[] = []
  await page.route(/\/api\/space\/aurora/, (r) => (asked.push('aurora'), r.fulfill({ json: auroraGrid() })))
  await page.route(/\/api\/space\/summary/, (r) => (asked.push('summary'), r.fulfill({ json: summary() })))
  return asked
}

test('the aurora forecast and Kp load only when switched on, with a chart that has a table too', async ({ page }) => {
  await stubHazardData(page)
  const asked = await stub(page)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Sea & space' }).click()
  expect(asked).toEqual([])

  await page.getByLabel('Show the aurora forecast').check()
  await expect(page.getByText(/Kp 2\.0 now · Geomagnetic storm: G1 \(minor\)/)).toBeVisible()
  await expect(page.getByRole('img', { name: /Kp index by 3-hour period/ })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Map key' })).toContainText('Aurora, % chance overhead')

  // Hovering a bar says its value; the table has every one
  await page.locator('.space .bar').nth(6).hover()
  await expect(page.locator('.readout')).toContainText('Kp 5.3')
  await page.getByText('Kp as a table').click()
  await expect(page.locator('.space table tbody tr')).toHaveCount(32)
})

test('a watch area under the aurora is told its chance', async ({ page }) => {
  await stubHazardData(page)
  await stub(page)
  await page.goto('/')
  await page.getByRole('tab', { name: 'My alerts' }).click()
  await page.getByRole('button', { name: '+ Add area' }).click()
  await page.getByRole('button', { name: 'Use my location' }).click()
  await page.getByLabel('Name').fill('Tromsø')
  await page.getByRole('button', { name: 'Add area', exact: true }).click()

  await page.getByRole('tab', { name: 'Sea & space' }).click()
  await page.getByLabel('Show the aurora forecast').check()
  // Turning the aurora on lights the globe for day and night, and CI's software rendering can stall for
  // seconds rebuilding the shaders of the many tiles round Tromsø, where the camera has just flown
  await expect(page.locator('.space .areas')).toContainText('Tromsø: 35% chance overhead', { timeout: 20_000 })
})

test('hidden while looking back, as it is a forecast for the next hour', async ({ page }) => {
  await stubHazardData(page)
  await page.route(/\/api\/events\/history/, (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 30, type: 'FeatureCollection', features: [] } }),
  )
  await stub(page)
  const day = new Date(Date.now() - 5 * 24 * H).toISOString().slice(0, 10)
  await page.goto(`/#layers=aurora&tab=space&history=30:${day}`)
  await expect(page.getByText('Live only: hidden while looking back.')).toBeVisible()
  // the aurora was the only layer on, and it's hidden: nothing for the key to explain
  await expect(page.getByRole('complementary', { name: 'Map key' })).toHaveCount(0)
})
