import { sameChannel, type Notifier } from './delivery.js'
import { escapeHtml } from './html.js'
import type { SubscriptionStore } from './store/index.js'
import type { TelegramChannel } from './types.js'

export class TelegramError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
  ) {
    super(`Telegram ${status}: ${description}`)
  }
}

export interface TelegramApi {
  call<T = unknown>(method: string, body?: object, signal?: AbortSignal): Promise<T>
}

export function telegramApi(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  return {
    async call<T>(method: string, body: object = {}, signal?: AbortSignal) {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(60_000),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string }
      if (!data.ok) throw new TelegramError(res.status, data.description ?? res.statusText)
      return data.result as T
    },
  }
}

export function createTelegramNotifier(api: TelegramApi): Notifier<TelegramChannel> {
  return {
    async send(channel, payload) {
      const report = payload.url ? `\n<a href="${escapeHtml(payload.url)}">Full GDACS report</a>` : ''
      try {
        await api.call('sendMessage', {
          chat_id: channel.chatId,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          text:
            `<b>${escapeHtml(payload.title)}</b>\n${escapeHtml(payload.body)}${report}\n\n` +
            `<i>Not an official warning: follow your national weather service.</i>\nSend /stop to stop these messages.`,
        })
        return 'sent'
      } catch (err) {
        // 403: the user blocked the bot or deleted their account. 400 "chat not found": the chat is gone.
        if (err instanceof TelegramError && (err.status === 403 || /chat not found/i.test(err.description))) {
          return 'gone'
        }
        console.error('[telegram] failed', (err as Error).message)
        return 'failed'
      }
    },
  }
}

interface Update {
  update_id: number
  message?: { text?: string; chat: { id: number } }
}

const HELP =
  'This bot sends Hazard Globe alerts about tropical cyclones and floods.\n\n' +
  'To connect, open Hazard Globe, go to My alerts and press Connect Telegram. Send /stop to disconnect.'

/** Links chats to subscriptions (/start with a token from the app) and unlinks them (/stop). */
export function createBot({ api, store, now = Date.now }: { api: TelegramApi; store: SubscriptionStore; now?: () => number }) {
  async function link(chatId: string, token: string): Promise<string> {
    const sub = await store.findByToken(token)
    const ch = sub?.channels.find((c): c is TelegramChannel => c.kind === 'telegram' && c.token === token)
    if (!sub || !ch) return 'This link is no longer valid. In Hazard Globe, open My alerts and press Connect Telegram again.'
    if (ch.chatId === chatId) return 'This chat is already connected.'
    if (ch.chatId || !ch.linkExpiresAt || Date.parse(ch.linkExpiresAt) < now()) {
      return 'This link has expired. In Hazard Globe, open My alerts and press Connect Telegram again.'
    }
    const linked: TelegramChannel = { kind: 'telegram', chatId, token: ch.token }
    await store.upsert({ ...sub, channels: sub.channels.map((c) => (c === ch ? linked : c)) })
    return `Connected. You'll get alerts here for: ${sub.areas.map((a) => a.label).join(', ')}.\n\nSend /stop to disconnect.`
  }

  async function unlink(chatId: string): Promise<string> {
    const subs = await store.findByChannel('telegram', chatId)
    const gone: TelegramChannel = { kind: 'telegram', chatId, token: '' }
    for (const sub of subs) await store.upsert({ ...sub, channels: sub.channels.filter((c) => !sameChannel(c, gone)) })
    return subs.length ? "Disconnected. You won't get any more alerts here." : "This chat isn't connected to any alerts."
  }

  async function handle(update: Update): Promise<void> {
    const msg = update.message
    if (!msg?.text) return
    const chatId = String(msg.chat.id)
    const [command, arg] = msg.text.trim().split(/\s+/)
    const reply =
      command === '/start' && arg ? await link(chatId, arg) : command === '/stop' ? await unlink(chatId) : HELP
    await api.call('sendMessage', { chat_id: chatId, text: reply })
  }

  /** Long-polls for messages until stopped. Run it in one server instance only: Telegram allows one poller per bot. */
  function start(): () => void {
    const controller = new AbortController()
    void (async () => {
      let offset = 0
      while (!controller.signal.aborted) {
        try {
          const updates = await api.call<Update[]>(
            'getUpdates',
            { offset, timeout: 30, allowed_updates: ['message'] },
            AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
          )
          for (const update of updates) {
            offset = update.update_id + 1
            await handle(update).catch((err) => console.error('[telegram] update failed:', (err as Error).message))
          }
        } catch (err) {
          if (controller.signal.aborted) break
          console.error('[telegram] polling failed:', (err as Error).message)
          await new Promise((r) => setTimeout(r, 5000))
        }
      }
    })()
    return () => controller.abort()
  }

  return { handle, start }
}
