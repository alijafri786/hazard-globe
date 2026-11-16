import { expect, test, type Page } from '@playwright/test'
import { stubHazardData } from './stubs'

test.use({ geolocation: { latitude: -12.46, longitude: 130.84 }, permissions: ['geolocation'] }) // Darwin

/** A day's grid: 1,440 × 720 cells with a few fires round Darwin */
function grid() {
  const counts = new Uint16Array(1440 * 720)
  const cell = (lat: number, lon: number) => Math.floor((90 - lat) / 0.25) * 1440 + Math.floor((lon + 180) / 0.25)
  counts[cell(-12.5, 130.5)] = 12
  counts[cell(-13, 131)] = 3
  return { fetchedAt: new Date().toISOString(), count: 15, cols: 1440, rows: 720, data: Buffer.from(counts.buffer).toString('base64') }
}

async function stubFirms(page: Page) {
  const boxes: string[] = []
  await page.route(/\/api\/fires\/grid/, (r) => r.fulfill({ json: grid() }))
  await page.route(/\/api\/fires\?/, (r) => {
    boxes.push(new URL(r.request().url()).searchParams.get('bbox')!)
    const time = Date.now() - 2 * 3_600_000
    return r.fulfill({
      json: { detections: [{ lat: -12.5, lon: 130.5, time, frp: 64.2, confidence: 'high', satellite: 'N20', day: true }] },
    })
  })
  return boxes
}

test('says so when this server has no FIRMS key', async ({ page }) => {
  await stubHazardData(page)
  await page.goto('/')
  await page.getByLabel('Every fire seen in the last day').check()
  await expect(page.getByText("This server has no NASA FIRMS key, so it can't show single fires")).toBeVisible()
})

test('from afar, a heat map of the day’s fires', async ({ page }) => {
  await stubHazardData(page)
  const boxes = await stubFirms(page)
  await page.goto('/')
  await page.getByLabel('Every fire seen in the last day').check()
  await expect(page.locator('.firms [role=status]')).toContainText('15 fires in the last day')
  await expect(page.locator('.firms [role=status]')).toContainText('Zoom in for single fires.')
  await expect(page.getByRole('complementary', { name: 'Map key' })).toContainText('Fires per 25 km cell, last day')
  expect(boxes).toEqual([]) // too far out to ask for single fires
})

test('close up, single fires with their power', async ({ page }) => {
  await stubHazardData(page)
  const boxes = await stubFirms(page)
  // Straight down on the fire from 300 km up: single fires, and a click on it opens its card
  await page.goto('/#cam=130.5000,-12.5000,300000,0.0,-90.0&layers=firms')
  await expect.poll(() => boxes.length).toBeGreaterThan(0)
  const [w, s, e, n] = boxes.at(-1)!.split(',').map(Number)
  expect(e - w).toBeLessThanOrEqual(10)
  expect(n - s).toBeLessThanOrEqual(10)
  await expect(page.getByRole('complementary', { name: 'Map key' })).toContainText('Fires by power (FIRMS)')

  await page.locator('.panel .grip').click()
  const box = (await page.locator('.globe canvas').first().boundingBox())!
  await page.waitForTimeout(1500)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.cesium-infoBox-title')).toHaveText('Fire, 64 MW')
  await expect(page.frameLocator('.cesium-infoBox-iframe').getByRole('row', { name: /Power/ })).toContainText('64.2 MW')
})

test('with a FIRMS key, a watch area can ask about fires nearby', async ({ page }) => {
  await stubHazardData(page)
  let fires = true
  await page.route(/\/api\/channels/, (r) => r.fulfill({ json: { push: true, email: false, telegram: null, fires } }))
  await page.goto('/')
  await page.getByRole('tab', { name: 'My alerts' }).click()
  await page.getByRole('button', { name: '+ Add area' }).click()
  await page.getByRole('button', { name: 'Use my location' }).click()
  await page.locator('form.editor').getByLabel('Fires nearby').check()
  await page.getByLabel('Name').fill('Darwin')
  await page.getByRole('button', { name: 'Add area', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Darwin' })).toContainText('Storms, floods and fires nearby')

  // The server loses its key: the area's fire alerts still show when editing, so they can be taken off
  fires = false
  await page.reload()
  await page.getByRole('tab', { name: 'My alerts' }).click()
  await page.getByRole('button', { name: 'Edit' }).click()
  const fireBox = page.locator('form.editor').getByLabel('Fires nearby')
  await expect(fireBox).toBeChecked()
  await fireBox.uncheck()
  await page.getByRole('button', { name: 'Save area' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Darwin' })).not.toContainText('fires nearby')
  // and new areas aren't offered them
  await page.getByRole('button', { name: '+ Add area' }).click()
  await expect(page.locator('form.editor').getByLabel('Fires nearby')).toHaveCount(0)
})
