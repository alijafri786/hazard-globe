import { expect, test, type Page } from '@playwright/test'

// Cesium's default view looks straight down on (82.5° W, 35° N), so a quake there is under the screen's centre
const CENTRE: [number, number] = [-82.5, 35]
const time = Date.now() - 3_600_000
const gdacsDate = new Date(time + 60_000).toISOString().slice(0, 19) // GDACS dates: UTC, no zone

const quake = (id: string, mag: number, extra: object = {}) => ({
  id,
  lon: CENTRE[0],
  lat: CENTRE[1],
  depthKm: 12,
  mag,
  time,
  place: '10 km N of Testville',
  url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,
  tsunami: false,
  alert: null,
  ...extra,
})

async function stub(page: Page, quakes: object[]) {
  const feeds: string[] = []
  await page.route('**/api/events', (r) =>
    r.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        days: 10,
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            // ~30 km away and a minute later: the same earthquake, as GDACS reports it
            geometry: { type: 'Point', coordinates: [CENTRE[0] + 0.3, CENTRE[1]] },
            properties: {
              eventtype: 'EQ',
              eventid: 77,
              episodeid: 1,
              name: 'Earthquake in Testland',
              alertlevel: 'Orange',
              fromdate: gdacsDate,
              todate: gdacsDate,
              url: { report: 'https://www.gdacs.org/report.aspx?eventid=77' },
            },
          },
        ],
      },
    }),
  )
  await page.route(/\/api\/earthquakes/, (r) => {
    const feed = new URL(r.request().url()).searchParams.get('feed')!
    feeds.push(feed)
    return r.fulfill({ json: { feed, fetchedAt: new Date().toISOString(), generatedAt: new Date().toISOString(), quakes } })
  })
  return feeds
}

test('USGS earthquakes are off until chosen, then load the chosen feed', async ({ page }) => {
  const feeds = await stub(page, [quake('us1', 6.1), quake('us2', 3.0)])
  await page.goto('/')
  await expect(page.locator('.events strong')).toHaveCount(1)
  expect(feeds).toEqual([])

  await page.getByLabel('Show every recent earthquake, live').check()
  await expect(page.getByRole('status').filter({ hasText: 'USGS feed' })).toContainText('2 earthquakes')
  await page.getByLabel('Which earthquakes').selectOption('week')
  await expect.poll(() => feeds).toEqual(['day', 'week'])

  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.getByText('Live only: hidden while looking back.')).toBeVisible()
})

test('a quake’s card gives its depth, the tsunami caveat, and the GDACS alert for the same event', async ({ page }) => {
  await stub(page, [quake('us1', 7.2, { tsunami: true, alert: 'yellow' })])
  await page.goto('/')
  await page.getByLabel('Earthquakes', { exact: true }).uncheck() // GDACS's marker would sit on top of it
  await page.getByLabel('Show every recent earthquake, live').check()
  await expect(page.getByRole('status').filter({ hasText: 'USGS feed' })).toContainText('1 earthquakes')

  await page.locator('.panel .grip').click()
  const box = (await page.locator('.globe canvas').first().boundingBox())!
  await page.waitForTimeout(2000)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  await expect(page.locator('.cesium-infoBox-title')).toHaveText('M 7.2 — 10 km N of Testville')
  const card = page.frameLocator('.cesium-infoBox-iframe')
  await expect(card.getByRole('row', { name: /Depth/ })).toContainText('12 km')
  await expect(card.getByRole('row', { name: /PAGER/ })).toContainText('Yellow')
  await expect(card.getByRole('row', { name: /GDACS alert/ })).toContainText('Orange')
  await expect(card.getByText(/doesn't mean a\s+tsunami happened/)).toBeVisible()
  await expect(card.getByRole('link', { name: 'GDACS report ↗' })).toBeVisible()
})
