// server/src/subscriptions/revenuecat-event.ts: reads a RevenueCat webhook body ({ api_version, event }).
// Only the fields the handler needs: the event id (idempotency), the type, and whose state to
// re-fetch. The rest of the body is never trusted for the entitlement itself.

/** RevenueCat's prefix for an id its SDK made up on the device; never a backend user id. */
export const ANONYMOUS_ID_PREFIX = '$RCAnonymousID:';

export type RevenueCatEvent = {
  readonly id: string;
  readonly type: string;
  readonly appUserId: string | null;
  readonly transferredFrom: readonly string[];
  readonly transferredTo: readonly string[];
  readonly environment: string | null;
};

const stringOr = (value: unknown, fallback: string | null): string | null =>
  typeof value === 'string' && value !== '' ? value : fallback;

const stringsOf = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];

/** The event, or null when the body is not a RevenueCat webhook (answered with 400). */
export function parseRevenueCatWebhook(body: unknown): RevenueCatEvent | null {
  if (typeof body !== 'object' || body === null) return null;
  const event: unknown = Reflect.get(body, 'event');
  if (typeof event !== 'object' || event === null) return null;
  const id = stringOr(Reflect.get(event, 'id'), null);
  const type = stringOr(Reflect.get(event, 'type'), null);
  if (id === null || type === null) return null;
  return {
    id,
    type,
    appUserId: stringOr(Reflect.get(event, 'app_user_id'), null),
    transferredFrom: stringsOf(Reflect.get(event, 'transferred_from')),
    transferredTo: stringsOf(Reflect.get(event, 'transferred_to')),
    environment: stringOr(Reflect.get(event, 'environment'), null),
  };
}

/**
 * The backend users whose entitlement this event may change: both sides of a TRANSFER, otherwise
 * the event's app user id. Anonymous SDK ids are left out (the app always logs in with the
 * backend user id, so one here is a setup bug the handler logs).
 */
export function affectedUserIds(event: RevenueCatEvent): readonly string[] {
  const ids =
    event.type === 'TRANSFER'
      ? [...event.transferredFrom, ...event.transferredTo]
      : [event.appUserId ?? ''];
  return [...new Set(ids)].filter((id) => id !== '' && !id.startsWith(ANONYMOUS_ID_PREFIX));
}
