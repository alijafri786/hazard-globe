import type { SendMailOptions } from 'nodemailer'
import type { Notifier } from './delivery.js'
import { DISCLAIMER, escapeHtml } from './html.js'
import type { EmailChannel } from './types.js'

/** The part of a nodemailer transport we use, so tests and E2E runs can capture mail instead. */
export interface Mailer {
  sendMail(message: SendMailOptions): Promise<unknown>
}

export interface EmailNotifier extends Notifier<EmailChannel> {
  sendConfirmation(channel: EmailChannel, areaLabels: string[]): Promise<void>
}

export const emailLinks = (publicUrl: string, token: string) => ({
  confirm: `${publicUrl}/api/email/confirm?token=${token}`,
  unsubscribe: `${publicUrl}/api/email/unsubscribe?token=${token}`,
})

const paragraphs = (text: string) =>
  text
    .split('\n\n')
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n')

export function createEmailNotifier(mailer: Mailer, { from, publicUrl }: { from: string; publicUrl: string }): EmailNotifier {
  return {
    async send(channel, payload) {
      const { unsubscribe } = emailLinks(publicUrl, channel.token)
      const report = payload.url ? `\n\nGDACS report: ${payload.url}` : ''
      try {
        await mailer.sendMail({
          from,
          to: channel.address,
          subject: payload.title,
          text: `${payload.body}${report}\n\n${DISCLAIMER}\n\nStop email alerts: ${unsubscribe}`,
          html: `${paragraphs(payload.body)}
${payload.url ? `<p><a href="${escapeHtml(payload.url)}">Full GDACS report</a></p>` : ''}
<p style="color:#666;font-size:13px">${escapeHtml(DISCLAIMER)}</p>
<p style="font-size:13px"><a href="${escapeHtml(unsubscribe)}">Stop email alerts</a></p>`,
          // One-click unsubscribe (RFC 8058): mail apps POST to the URL themselves
          headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        })
        return 'sent'
      } catch (err) {
        const { code, responseCode } = err as { code?: string; responseCode?: number }
        // The server refused this recipient for good (no such mailbox etc.); anything else may pass next time
        if (code === 'EENVELOPE' && responseCode && responseCode >= 500) return 'gone'
        console.error('[email] failed', code, responseCode, (err as Error).message)
        return 'failed'
      }
    },

    async sendConfirmation(channel, areaLabels) {
      const { confirm } = emailLinks(publicUrl, channel.token)
      const text =
        `Someone, hopefully you, asked Hazard Globe to email this address about tropical cyclones and floods ` +
        `near: ${areaLabels.join(', ')}.\n\nConfirm here: ${confirm}\n\n` +
        `If that wasn't you, ignore this email: nothing more will be sent.\n\n${DISCLAIMER}`
      await mailer.sendMail({
        from,
        to: channel.address,
        subject: 'Confirm your Hazard Globe email alerts',
        text,
        html: paragraphs(text).replace(escapeHtml(confirm), `<a href="${escapeHtml(confirm)}">${escapeHtml(confirm)}</a>`),
      })
    },
  }
}
