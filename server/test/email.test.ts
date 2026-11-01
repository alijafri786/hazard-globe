import type { SendMailOptions } from 'nodemailer'
import { describe, expect, it, vi } from 'vitest'
import { createEmailNotifier, type Mailer } from '../src/email.js'
import { emailChannel } from './fixtures.js'

function capture(fail?: object) {
  const sent: SendMailOptions[] = []
  const mailer: Mailer = {
    sendMail: vi.fn(async (m: SendMailOptions) => {
      if (fail) throw Object.assign(new Error('refused'), fail)
      sent.push(m)
    }),
  }
  const notifier = createEmailNotifier(mailer, { from: 'Hazard Globe <alerts@example.org>', publicUrl: 'https://hg.example' })
  return { sent, notifier }
}

const payload = { title: 'RED Flood alert', body: 'Big <River> — Atlantis\nNear: Home', url: 'https://gdacs.example/r?a=1&b=2' }

describe('email alerts', () => {
  it('sends the alert with an unsubscribe link and one-click unsubscribe headers', async () => {
    const { sent, notifier } = capture()
    expect(await notifier.send(emailChannel(), payload)).toBe('sent')

    const [m] = sent
    expect(m).toMatchObject({ from: 'Hazard Globe <alerts@example.org>', to: 'me@example.com', subject: 'RED Flood alert' })
    const unsubscribe = 'https://hg.example/api/email/unsubscribe?token=email-token'
    expect(m.headers).toEqual({ 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
    expect(m.text).toContain('Big <River> — Atlantis\nNear: Home')
    expect(m.text).toContain('GDACS report: https://gdacs.example/r?a=1&b=2')
    expect(m.text).toContain('not an official warning service')
    expect(m.text).toContain(unsubscribe)
  })

  it('escapes event text in the HTML version', async () => {
    const { sent, notifier } = capture()
    await notifier.send(emailChannel(), payload)
    expect(sent[0].html).toContain('Big &lt;River&gt; — Atlantis<br>Near: Home')
    expect(sent[0].html).toContain('href="https://gdacs.example/r?a=1&amp;b=2"')
    expect(sent[0].html).not.toContain('<River>')
  })

  it('treats a permanently refused recipient as gone, and other errors as worth retrying', async () => {
    expect(await capture({ code: 'EENVELOPE', responseCode: 550 }).notifier.send(emailChannel(), payload)).toBe('gone')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await capture({ code: 'EENVELOPE', responseCode: 451 }).notifier.send(emailChannel(), payload)).toBe('failed')
    expect(await capture({ code: 'ECONNECTION' }).notifier.send(emailChannel(), payload)).toBe('failed')
  })
})

describe('confirmation email', () => {
  it('names the areas and links to the confirm page', async () => {
    const { sent, notifier } = capture()
    await notifier.sendConfirmation(emailChannel({ verified: false, token: 'tok' }), ['Home', "Mum's"])

    const confirm = 'https://hg.example/api/email/confirm?token=tok'
    expect(sent[0].subject).toBe('Confirm your Hazard Globe email alerts')
    expect(sent[0].text).toContain("near: Home, Mum's")
    expect(sent[0].text).toContain(confirm)
    expect(sent[0].html).toContain(`<a href="${confirm}">${confirm}</a>`)
    expect(sent[0].html).toContain('Mum&#39;s')
  })
})
