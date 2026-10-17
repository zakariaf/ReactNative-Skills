// src/services/push/push-channels.ts
// The app's Android notification channels: one per kind of message a person may want to silence on
// its own. Android 8+ files every notification under a channel and lets the person mute each one in
// Settings, where the channel's name and description appear. A channel's id and importance are fixed
// once created on a device (only its name and description can change), so an id is never reused for
// something else: a new behaviour gets a new id. The ids equal contracts/push.json "channels", which the
// server reads to set `channelId`; "defaultChannel" there (and in the expo-notifications plugin) is
// where a push without a channelId lands.
import type { NamedPushChannel } from './push-port';
import type { MessageKey } from '@/i18n/messages';

export type PushChannel = {
  readonly id: string;
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly importance: NamedPushChannel['importance'];
};

export const PUSH_CHANNELS: readonly PushChannel[] = [
  {
    id: 'general',
    nameKey: 'push.channel.general.name',
    descriptionKey: 'push.channel.general.description',
    importance: 'default',
  },
  {
    id: 'task-updates',
    nameKey: 'push.channel.task-updates.name',
    descriptionKey: 'push.channel.task-updates.description',
    importance: 'high',
  },
];

/** The channels with their texts in the person's language (t is the app's translate function). */
export function namedPushChannels(
  t: (key: MessageKey) => string,
  channels: readonly PushChannel[] = PUSH_CHANNELS,
): readonly NamedPushChannel[] {
  return channels.map(({ id, nameKey, descriptionKey, importance }) => ({
    id,
    name: t(nameKey),
    description: t(descriptionKey),
    importance,
  }));
}
