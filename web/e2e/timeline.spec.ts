import { expect, test, type Page } from '@playwright/test'

const DAY = 86_400_000
const today = Math.floor(Date.now() / DAY) * DAY
/** GDACS-style date (UTC, no zone) `n` days before today, plus some hours */
const daysAgo = (n: number, hours = 12) => new Date(today - n * DAY + hours * 3_600_000).toISOString().slice(0, 19)
const formatDay = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

function event(eventid: number, name: string, from: string, to: string, alertlevel = 'Orange') {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [eventid / 10, 10] },
    properties: { eventtype: 'TC', eventid, episodeid: 1, name, alertlevel, fromdate: from, todate: to },
  }
}

const past = event(1, 'Storm Past', daysAgo(20), daysAgo(10))
const ongoing = event(2, 'Storm Ongoing', daysAgo(5), daysAgo(0))
const brief = event(3, 'Storm Brief', daysAgo(3), daysAgo(2, 6))

async function stubEvents(page: Page) {
  const historyCalls: string[] = []
  await page.route('**/api/events', (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 10, type: 'FeatureCollection', features: [ongoing] } }),
  )
  await page.route(/\/api\/events\/history/, (r) => {
    const days = Number(new URL(r.request().url()).searchParams.get('days'))
    historyCalls.push(String(days))
    return r.fulfill({ json: { fetchedAt: new Date().toISOString(), days, type: 'FeatureCollection', features: [past, ongoing, brief] } })
  })
  return historyCalls
}

const listed = (page: Page) => page.locator('.events strong')

test('look back day by day, then return to live', async ({ page }) => {
  const historyCalls = await stubEvents(page)
  await page.goto('/')
  await expect(listed(page)).toHaveText(['Storm Ongoing'])
  await expect(page.getByRole('slider', { name: 'Day' })).toHaveCount(0)

  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.getByText(`1 event on ${formatDay(today)}`)).toBeVisible()
  await expect(listed(page)).toHaveText(['Storm Ongoing'])
  await expect(page.getByRole('status').filter({ hasText: 'History ·' })).toContainText(formatDay(today))
  expect(historyCalls).toEqual(['30'])

  // 30-day range: index 29 is today, so 15 days ago is index 14
  const slider = page.getByRole('slider', { name: 'Day' })
  await slider.fill('14')
  await expect(listed(page)).toHaveText(['Storm Past'])
  await expect(page.getByRole('status').filter({ hasText: 'History ·' })).toContainText(formatDay(today - 15 * DAY))

  await slider.fill('27') // 2 days ago: the brief storm's last (partial) day, and the ongoing one
  await expect(listed(page)).toHaveText(['Storm Ongoing', 'Storm Brief'])

  await slider.fill('2')
  await expect(page.getByText(`No storm or flood events on ${formatDay(today - 27 * DAY)}.`)).toBeVisible()

  await page.getByLabel('How far back').selectOption('7')
  expect(historyCalls).toEqual(['30', '7'])
  await expect(slider).toHaveValue('6') // back to today

  await slider.fill('0')
  await page.getByRole('button', { name: 'Play through the days' }).click()
  await expect(slider).toHaveValue('6', { timeout: 10_000 }) // plays to the end and stops
  await expect(page.getByRole('button', { name: 'Play through the days' })).toBeVisible()

  await page.getByRole('button', { name: 'Back to live' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'History ·' })).toHaveCount(0)
  await expect(listed(page)).toHaveText(['Storm Ongoing'])
  await expect(page.getByText('Updated')).toBeVisible()
})
