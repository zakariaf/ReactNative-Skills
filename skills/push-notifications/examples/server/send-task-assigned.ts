// server/push/send-task-assigned.ts
// The server half of the contract, for the developer of the backend (Node, expo-server-sdk; never
// in the app: the app does not send pushes). Text is written here in the registration's language;
// data carries only strings (a direct FCM message turns every value into a string anyway); the
// channel is one of contracts/push.json channels; tickets are read at once and receipts about
// 15 minutes later, and DeviceNotRegistered deletes the registration. The texts are neutral ("A task
// was assigned to you"): a task title or a person's name would sit on a locked screen and pass
// through Apple, Google and Expo; showing them is a product decision weighed against that exposure.
import { Expo } from 'expo-server-sdk';

import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

type Registration = { readonly token: string; readonly language: string };
type Texts = Readonly<Record<string, { readonly title: string; readonly body: string }>>;

// Enhanced push security (EAS dashboard) requires this token on every send.
const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

export function taskAssignedMessage(to: Registration, taskId: string, texts: Texts): ExpoPushMessage {
  const text = texts[to.language] ?? texts['en'];
  return {
    to: to.token,
    title: text?.title,
    body: text?.body,
    data: { kind: 'task-assigned', taskId },
    channelId: 'task-updates',
    priority: 'high',
    ttl: 60 * 60 * 24,
  };
}

export async function send(messages: readonly ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  const tickets: ExpoPushTicket[] = [];
  // At most 100 messages per request; the SDK chunks and the service allows 600 per second.
  for (const chunk of expo.chunkPushNotifications([...messages])) {
    tickets.push(...(await expo.sendPushNotificationsAsync(chunk)));
  }
  // A ticket with details.error === 'DeviceNotRegistered' deletes that registration now; the others
  // keep their ids for getPushNotificationReceiptsAsync about 15 minutes later (kept 24 hours).
  return tickets;
}
