import { expect, test, type Page } from '@playwright/test'
import { linkIn, outbox, STORAGE_KEY, stubHazardData, stubPush } from './stubs'

interface View {
  id: string
  areas: { id: string; label: string; minAlert: string; hazards: string[] }[]
}

test.use({ geolocation: { latitude: 51.5, longitude: -0.12 }, permissions: ['geolocation'] })

const status = (page: Page) => page.getByRole('status')
const areaRow = (page: Page, label: string) => page.getByRole('listitem').filter({ hasText: label })
const savedId = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').subscriptionId as string | undefined, STORAGE_KEY)

async function openAlerts(page: Page) {
  await page.goto('/')
  await page.getByRole('tab', { name: 'My alerts' }).click()
}

async function addArea(page: Page, name: string, options: { minAlert?: string } = {}) {
  await page.getByRole('button', { name: '+ Add area' }).click()
  await page.getByRole('button', { name: 'Use my location' }).click()
  await expect(status(page)).toHaveText('Centred on your location.')
  await page.getByLabel('Name').fill(name)
  if (options.minAlert) await page.getByLabel('Minimum alert level').selectOption(options.minAlert)
  await page.getByRole('button', { name: 'Add area', exact: true }).click()
}

test('add several areas, turn alerts on, edit, reload and turn off', async ({ page, context, request }) => {
  await stubPush(page, 'https://push.example/e2e-flow')
  await stubHazardData(page)
  await openAlerts(page)
  await expect(page.getByRole('button', { name: 'Turn on alerts' })).toBeDisabled() // nothing to watch yet

  await addArea(page, 'Home')
  await expect(status(page)).toHaveText('Added Home.')
  await context.setGeolocation({ latitude: 48.85, longitude: 2.35 })
  await addArea(page, "Mum's", { minAlert: 'Red' })
  await expect(areaRow(page, "Mum's")).toContainText('150 km · Storms and floods, red only')

  await page.getByRole('button', { name: 'Turn on alerts' }).click()
  await expect(status(page)).toHaveText('Alerts turned on. Send a test to check they arrive.')
  await expect(page.getByText('Alerts are on for 2 areas.')).toBeVisible()
  const id = (await savedId(page))!
  const created = (await (await request.get(`/api/subscriptions/${id}`)).json()) as View
  expect(created.areas.map((a) => [a.label, a.minAlert])).toEqual([
    ['Home', 'Orange'],
    ["Mum's", 'Red'],
  ])

  await page.getByRole('button', { name: 'Send test' }).click()
  await expect(status(page)).toHaveText('Test sent to this browser.')

  // Edits sync straight away once alerts are on, keeping the area's id
  await areaRow(page, 'Home').getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Name').fill('Home (London)')
  await page.getByRole('button', { name: 'Save area' }).click()
  await expect(status(page)).toHaveText('Saved Home (London). Alerts updated.')
  const edited = (await (await request.get(`/api/subscriptions/${id}`)).json()) as View
  expect(edited.areas[0]).toMatchObject({ id: created.areas[0].id, label: 'Home (London)' })

  await page.reload()
  await page.getByRole('tab', { name: 'My alerts' }).click()
  await expect(page.getByText('Alerts are on for 2 areas.')).toBeVisible()
  await expect(areaRow(page, 'Home (London)')).toBeVisible()

  await areaRow(page, "Mum's").getByRole('button', { name: 'Remove' }).click()
  await expect(status(page)).toHaveText("Removed Mum's.")
  await expect(areaRow(page, 'Home (London)').getByRole('button', { name: 'Remove' })).toBeDisabled() // last one
  expect(((await (await request.get(`/api/subscriptions/${id}`)).json()) as View).areas).toHaveLength(1)

  await page.getByRole('button', { name: 'Turn off all alerts' }).click()
  await expect(status(page)).toHaveText('Alerts turned off. Your areas are kept on this device.')
  expect((await request.get(`/api/subscriptions/${id}`)).status()).toBe(404)
  await expect(areaRow(page, 'Home (London)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Turn on alerts' })).toBeEnabled()
})

test('a browser that saved one area before this version picks up its settings from the server', async ({
  page,
  request,
}) => {
  const endpoint = 'https://push.example/e2e-legacy'
  // An older client created this subscription: single area, settings sent at the top level
  const res = await request.post('/api/subscriptions', {
    data: {
      area: { label: 'Old home', lon: 10, lat: 20, radiusKm: 200 },
      hazards: ['TC'],
      minAlert: 'Red',
      push: { endpoint, keys: { p256dh: 'p', auth: 'a' } },
    },
  })
  const { id } = (await res.json()) as View
  await page.addInitScript(
    ({ id }) => {
      if (!localStorage.getItem('hazard-globe:watch')) {
        localStorage.setItem(
          'hazard-globe:watch',
          JSON.stringify({ area: { label: 'Old home', lon: 10, lat: 20, radiusKm: 200 }, subscriptionId: id }),
        )
      }
    },
    { id },
  )
  await stubPush(page, endpoint)
  await stubHazardData(page)
  await openAlerts(page)

  await expect(areaRow(page, 'Old home')).toContainText('200 km · Storms, red only')
  await expect(page.getByText('Alerts are on for Old home.')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('hazard-globe:watch'))).toBeNull()
})

test('says so when the server has forgotten the subscription', async ({ page }) => {
  await page.addInitScript((key) => {
    const area = { label: 'Gone', lon: 1, lat: 1, radiusKm: 100, hazards: ['TC', 'FL'], minAlert: 'Orange' }
    localStorage.setItem(key, JSON.stringify({ areas: [area], subscriptionId: 'no-such-subscription' }))
  }, STORAGE_KEY)
  await stubPush(page, 'https://push.example/e2e-gone')
  await stubHazardData(page)
  await openAlerts(page)

  await expect(page.getByText('Your alerts were switched off on the server.')).toBeVisible()
  await expect(areaRow(page, 'Gone')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Turn on alerts' })).toBeEnabled()
})

test('email alerts: confirm from the email, test, then one-click unsubscribe', async ({ page, context }) => {
  const address = `e2e-${Date.now()}@example.com`
  await stubPush(page, 'https://push.example/e2e-email')
  await stubHazardData(page)
  await openAlerts(page)
  await addArea(page, 'Home')

  await page.getByLabel('Notifications in this browser').uncheck()
  await page.getByLabel('Email', { exact: true }).check()
  await page.getByLabel('Email address').fill(address)
  await page.getByRole('button', { name: 'Turn on alerts' }).click()
  await expect(status(page)).toHaveText('Alerts turned on. Check your inbox to confirm your email address.')
  await expect(page.getByRole('listitem').filter({ hasText: address })).toContainText('Waiting for you to confirm')
  await expect(page.getByText('Nowhere to send alerts yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send test' })).toBeDisabled()

  // Confirm in another tab: the link only shows a button, so mail scanners can't confirm by visiting it
  const [confirmation] = await outbox(address)
  expect(confirmation.subject).toBe('Confirm your Hazard Globe email alerts')
  const mailTab = await context.newPage()
  await mailTab.goto(linkIn(confirmation, '/api/email/confirm'))
  await expect(mailTab.getByRole('heading', { name: 'Confirm email alerts' })).toBeVisible()
  await mailTab.getByRole('button', { name: 'Confirm' }).click()
  await expect(mailTab.getByRole('heading', { name: 'Email alerts are on' })).toBeVisible()

  // Back in the app, which refreshes when it becomes visible again
  await page.bringToFront()
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('listitem').filter({ hasText: address })).toContainText('Confirmed')
  await page.getByRole('button', { name: 'Send test' }).click()
  await expect(status(page)).toHaveText('Test sent to email.')

  const testMail = (await outbox(address)).at(-1)!
  expect(testMail.subject).toBe('Hazard Globe test alert')
  expect(testMail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')

  await mailTab.goto(linkIn(testMail, '/api/email/unsubscribe'))
  await mailTab.getByRole('button', { name: 'Stop email alerts' }).click()
  await expect(mailTab.getByRole('heading', { name: 'Unsubscribed' })).toBeVisible()

  // Email was its only channel, so the subscription is gone and the app says so
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByText('Your alerts were switched off on the server.')).toBeVisible()
  await expect(areaRow(page, 'Home')).toBeVisible()
})
