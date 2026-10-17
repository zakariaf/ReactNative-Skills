// src/core/push/push-message.ts
// What a push notification's custom data may say, checked before anything acts on it. The data is
// untrusted input: anyone who holds a push token (or the server, after a bug) can send any JSON, and
// a newer server sends kinds this build has never seen. Every value is a string, because Firebase
// delivers a direct FCM data map as strings only; the Expo push service keeps JSON types, but a
// payload that is all strings survives both. A sender that skips Expo puts the data under the APNs
// payload's `body` key on iOS (expo-notifications reads it from there). contracts/push.json lists
// the same kinds for the server.
import * as v from 'valibot';

/** Every kind this build understands; the server sends one of them in `data.kind`. */
export const PUSH_KINDS = ['task-assigned', 'list-shared', 'announcement'] as const;

/** Ids travel as short opaque strings: never a path, a URL or text a person wrote. */
const idSchema = v.pipe(v.string(), v.regex(/^[\w-]{1,64}$/u));

const pushMessageSchema = v.variant('kind', [
  v.object({ kind: v.literal('task-assigned'), taskId: idSchema }),
  v.object({ kind: v.literal('list-shared'), listId: idSchema }),
  v.object({ kind: v.literal('announcement') }),
]);

/** A checked push message. Unknown fields are dropped (v.object), so a newer server stays compatible. */
export type PushMessage = v.InferOutput<typeof pushMessageSchema>;

/**
 * The notification's data as a PushMessage, or null when it is not one this build understands (an
 * unknown kind, a missing or malformed id, no data at all). Null is not an error: the notification
 * still shows; tapping it only opens the app.
 */
export function parsePushData(data: unknown): PushMessage | null {
  const parsed = v.safeParse(pushMessageSchema, data);
  return parsed.success ? parsed.output : null;
}
