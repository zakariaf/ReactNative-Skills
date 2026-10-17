// src/core/push/push-destination.ts
// Where a tap on a push notification takes the person. The data never names a screen, a path or a
// URL: it names a kind and an id (push-message.ts), and only this table turns that into a place in
// the app. So a forged or stale payload can open nothing but the screens listed here, and a route
// rename is a change in one file, not in the server and every build still installed.
import type { PushMessage } from './push-message';

/** The action id of a tap on the notification itself (the port maps the SDK's own id to it). */
export const OPEN_ACTION = 'open';

/** A place in the app a notification may open; the app's model maps each one to a route. */
export type PushDestination =
  | { readonly screen: 'task'; readonly taskId: string }
  | { readonly screen: 'list'; readonly listId: string }
  | { readonly screen: 'inbox' };

/**
 * The destination of a tap, or null to just bring the app forward where it was: data this build
 * does not understand, or an action button this table does not handle.
 */
export function destinationFor(
  message: PushMessage | null,
  action: string,
): PushDestination | null {
  if (message === null || action !== OPEN_ACTION) return null;
  switch (message.kind) {
    case 'task-assigned':
      return { screen: 'task', taskId: message.taskId };
    case 'list-shared':
      return { screen: 'list', listId: message.listId };
    case 'announcement':
      return { screen: 'inbox' };
  }
}
