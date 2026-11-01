import {
  channelAddress,
  isActive,
  type AlertPayload,
  type Channel,
  type ChannelKind,
  type SendResult,
  type Subscription,
} from './types.js'

/** Sends an alert over one kind of channel. 'gone' means the channel will never work again: remove it. */
export interface Notifier<C extends Channel> {
  send(channel: C, payload: AlertPayload): Promise<SendResult>
}

export type Notifiers = { [K in ChannelKind]?: Notifier<Extract<Channel, { kind: K }>> }

export interface Delivery {
  results: Partial<Record<ChannelKind, SendResult>>
  gone: Channel[]
}

export type Deliver = (sub: Subscription, payload: AlertPayload) => Promise<Delivery>

export const anySent = (d: Delivery) => Object.values(d.results).includes('sent')

export const sameChannel = (a: Channel, b: Channel) => a.kind === b.kind && channelAddress(a) === channelAddress(b)

/** Sends to every channel that can take alerts yet: push, confirmed email, linked Telegram. */
export function createDeliver(notifiers: Notifiers): Deliver {
  return async (sub, payload) => {
    const delivery: Delivery = { results: {}, gone: [] }
    for (const ch of sub.channels.filter(isActive)) {
      const notifier = notifiers[ch.kind] as Notifier<typeof ch> | undefined
      const result = notifier ? await notifier.send(ch, payload) : 'failed' // e.g. SMTP since removed from config
      delivery.results[ch.kind] = result
      if (result === 'gone') delivery.gone.push(ch)
    }
    return delivery
  }
}
