// src/services/crash-reporter/crash-scrubber.ts
// The last filter before a report leaves the device: the SDK's beforeSend, beforeSendTransaction
// and beforeBreadcrumb hooks call these pure functions. They remove the person (user, request
// cookies and headers), strip URL queries (and redact bare ones under http.query and http.fragment),
// mask e-mail addresses, bearer tokens and JWTs in every
// text, mask standalone digit runs of nine or more digits (phone and card numbers) in every text
// except the SDK's own contexts (their trace and update ids must survive), redact values under
// sensitive keys, and keep only the breadcrumb categories the app chose. They see JavaScript events
// only: a native crash is written by the native SDK and sent on the next launch, so nothing personal
// may ever reach the SDK's scope.

export const REDACTED = '[redacted]';

/** Keys whose values are never sent, wherever they appear (extra, contexts, tags, breadcrumb data). */
export const SENSITIVE_KEY =
  /pass(word)?|secret|token|auth|cookie|session|e-?mail|phone|address|card|iban|ssn|birth/iu;

/**
 * Keys that hold a bare query string or fragment (`?q=doctor&token=...`, `#x`) with no URL in front,
 * so URL_QUERY never sees them: Sentry's fetch and XHR request spans and breadcrumbs set
 * `http.query` and `http.fragment` when tracing is on. Their values are never sent.
 */
export const QUERY_KEY = /^(?:http\.)?(?:query|fragment)$/iu;

/** How deep the scrubber walks nested values; deeper values are replaced. */
export const MAX_DEPTH = 6;

/** Breadcrumb categories that may leave the device; everything else (console, touch, ui.*) is dropped. */
export const KEPT_BREADCRUMB_CATEGORIES: readonly string[] = ['navigation', 'xhr', 'fetch', 'http'];
const APP_CATEGORY_PREFIX = 'app.';
const SDK_CATEGORY_PREFIX = 'sentry.';

const EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/gu;
const BEARER = /\bBearer\s+[\w.~+/=-]+/giu;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/gu;
/**
 * Digits with spaces, dots, brackets or hyphens between them, standing alone: a run glued to a
 * letter, digit, underscore or hyphen on either side is part of an identifier (a hex trace id, a
 * UUID group, `user-123456789`) and is not matched.
 */
const DIGIT_RUN = /(?<![\w-])\+?\d[\d\s().-]*\d(?![\w-])/gu;
/** A UUID whose groups happen to be all digits: an identifier, never a phone or card number. */
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;
/**
 * A run with this many digits is a phone, card or account number; ISO dates and versions have fewer.
 * A standalone epoch timestamp (10 digits in seconds, 13 in milliseconds) is masked too: log ISO dates.
 */
export const MIN_SECRET_DIGITS = 9;
const URL_QUERY = /(https?:\/\/[^\s?#"']+)[?#][^\s"']*/giu;

/**
 * Contexts the SDKs fill with identifiers and device facts (trace and span ids, the OTA update id,
 * versions, model names). Their texts get every mask except the digit-run one, which would corrupt
 * ids such as contexts.trace.trace_id and contexts.ota_updates.update_id; keys are redacted as
 * everywhere. Any other context (one the app or a library sets) is scrubbed like `extra`.
 */
export const SDK_CONTEXTS: readonly string[] = [
  'app',
  'device',
  'os',
  'culture',
  'runtime',
  'trace',
  'ota_updates',
  'react_native_context',
];

/** Masks URL queries, JWTs, bearer tokens and e-mail addresses (identifiers survive). */
export function maskSecrets(text: string): string {
  return text
    .replace(URL_QUERY, '$1')
    .replace(JWT, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(EMAIL, REDACTED);
}

/** Masks personal data and secrets inside one text: maskSecrets plus long standalone digit runs. */
export function scrubText(text: string): string {
  return maskSecrets(text).replace(DIGIT_RUN, (run) =>
    run.replace(/\D/gu, '').length >= MIN_SECRET_DIGITS && !UUID.test(run) ? REDACTED : run,
  );
}

function walk(value: unknown, depth: number, mask: (text: string) => string): unknown {
  if (typeof value === 'string') return mask(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item: unknown) => walk(item, depth + 1, mask));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] =
      SENSITIVE_KEY.test(key) || QUERY_KEY.test(key) ? REDACTED : walk(item, depth + 1, mask);
  }
  return result;
}

/** A copy of `value` with every text scrubbed and every sensitive key redacted. */
export function scrubValue(value: unknown, depth = 0): unknown {
  return walk(value, depth, scrubText);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function scrubRecord(
  value: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  return value === undefined ? undefined : asRecord(scrubValue(value));
}

/** Contexts: SDK contexts keep their ids (maskSecrets only), every other context is scrubbed. */
export function scrubContexts(
  contexts: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (contexts === undefined) return undefined;
  const result: Record<string, unknown> = {};
  for (const [name, context] of Object.entries(contexts)) {
    if (SENSITIVE_KEY.test(name)) result[name] = REDACTED;
    else if (SDK_CONTEXTS.includes(name)) result[name] = walk(context, 1, maskSecrets);
    else result[name] = scrubValue(context, 1);
  }
  return result;
}

/** The part of a breadcrumb the scrubber reads (Sentry's Breadcrumb has this shape). */
export type ScrubbableBreadcrumb = {
  readonly category?: string | undefined;
  readonly message?: string | undefined;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
};

/** The breadcrumb, scrubbed, or null when its category may not leave the device. */
export function filterBreadcrumb<TBreadcrumb extends ScrubbableBreadcrumb>(
  breadcrumb: TBreadcrumb,
): TBreadcrumb | null {
  const category = breadcrumb.category ?? '';
  const isKept =
    KEPT_BREADCRUMB_CATEGORIES.includes(category) ||
    category.startsWith(APP_CATEGORY_PREFIX) ||
    category.startsWith(SDK_CATEGORY_PREFIX);
  if (!isKept) return null;
  return {
    ...breadcrumb,
    message: breadcrumb.message === undefined ? undefined : scrubText(breadcrumb.message),
    data: scrubRecord(breadcrumb.data),
  };
}

type ScrubbableException = {
  readonly value?: string | undefined;
};

/** The part of a transaction span the scrubber reads (Sentry's SpanJSON fits it). */
export type ScrubbableSpan = {
  readonly description?: string | undefined;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
};

/** The part of an event the scrubber reads (Sentry's ErrorEvent and TransactionEvent fit it). */
export type ScrubbableEvent = {
  readonly message?: string | undefined;
  readonly exception?: { readonly values?: readonly ScrubbableException[] | undefined } | undefined;
  readonly breadcrumbs?: readonly ScrubbableBreadcrumb[] | undefined;
  readonly user?: unknown;
  readonly request?: { readonly url?: string | undefined } | undefined;
  readonly extra?: Readonly<Record<string, unknown>> | undefined;
  readonly contexts?: Readonly<Record<string, unknown>> | undefined;
  readonly tags?: Readonly<Record<string, unknown>> | undefined;
  readonly transaction?: string | undefined;
  readonly spans?: readonly ScrubbableSpan[] | undefined;
};

function scrubBreadcrumbs(
  breadcrumbs: readonly ScrubbableBreadcrumb[] | undefined,
): ScrubbableBreadcrumb[] | undefined {
  if (breadcrumbs === undefined) return undefined;
  return breadcrumbs
    .map((breadcrumb) => filterBreadcrumb(breadcrumb))
    .filter((breadcrumb): breadcrumb is ScrubbableBreadcrumb => breadcrumb !== null);
}

/** Transaction spans: their description and data carry request URLs (queries) and labels. */
function scrubSpans(spans: readonly ScrubbableSpan[] | undefined): ScrubbableSpan[] | undefined {
  if (spans === undefined) return undefined;
  return spans.map((span) => ({
    ...span,
    ...(span.description === undefined ? {} : { description: scrubText(span.description) }),
    ...(span.data === undefined ? {} : { data: scrubRecord(span.data) }),
  }));
}

/**
 * A scrubbed copy of the event: no user, a request with its URL stripped of the query and nothing
 * else (no cookies, headers, body or query string), scrubbed texts, filtered breadcrumbs, scrubbed
 * transaction spans, and contexts scrubbed by scrubContexts.
 */
export function scrubEvent<TEvent extends ScrubbableEvent>(event: TEvent): TEvent {
  const exception =
    event.exception?.values === undefined
      ? event.exception
      : {
          ...event.exception,
          values: event.exception.values.map((item) => ({
            ...item,
            value: item.value === undefined ? undefined : scrubText(item.value),
          })),
        };
  return {
    ...event,
    user: undefined,
    message: event.message === undefined ? undefined : scrubText(event.message),
    transaction: event.transaction === undefined ? undefined : scrubText(event.transaction),
    exception,
    breadcrumbs: scrubBreadcrumbs(event.breadcrumbs),
    request: event.request?.url === undefined ? undefined : { url: scrubText(event.request.url) },
    extra: scrubRecord(event.extra),
    contexts: scrubContexts(event.contexts),
    tags: scrubRecord(event.tags),
    ...(event.spans === undefined ? {} : { spans: scrubSpans(event.spans) }),
  };
}
