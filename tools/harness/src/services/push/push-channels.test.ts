// src/services/push/push-channels.test.ts
import { namedPushChannels, PUSH_CHANNELS } from './push-channels';

import type { MessageKey } from '@/i18n/messages';

describe('PUSH_CHANNELS', () => {
  it('has unique ids', () => {
    const ids = PUSH_CHANNELS.map((channel) => channel.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the ids the server and the plugin read (contracts/push.json)', () => {
    expect(PUSH_CHANNELS.map((channel) => channel.id)).toStrictEqual(['general', 'task-updates']);
  });
});

describe('namedPushChannels', () => {
  it('translates each name and description and keeps id and importance', () => {
    const t = (key: MessageKey): string => `<${key}>`;
    expect(namedPushChannels(t)).toStrictEqual([
      {
        id: 'general',
        name: '<push.channel.general.name>',
        description: '<push.channel.general.description>',
        importance: 'default',
      },
      {
        id: 'task-updates',
        name: '<push.channel.task-updates.name>',
        description: '<push.channel.task-updates.description>',
        importance: 'high',
      },
    ]);
  });

  it('takes another table', () => {
    const t = (key: MessageKey): string => key;
    expect(namedPushChannels(t, [])).toStrictEqual([]);
  });
});
