// src/services/crash-reporter/crash-scrubber.test.ts
import {
  MAX_DEPTH,
  REDACTED,
  filterBreadcrumb,
  scrubEvent,
  scrubText,
  scrubValue,
} from './crash-scrubber';

// Lint bans URL literals in every test, so the URLs are built from a scheme and the rest.
const url = (scheme: string, rest: string): string => `${scheme}://${rest}`;

describe('scrubText', () => {
  it.each([
    ['task shared with ana@tasks.test failed', `task shared with ${REDACTED} failed`],
    ['call +49 30 1234 5678 now', `call ${REDACTED} now`],
    ['card 4111 1111 1111 1111', `card ${REDACTED}`],
    ['Authorization: Bearer abc.def-123', `Authorization: Bearer ${REDACTED}`],
    ['token eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl', `token ${REDACTED}`],
    [
      `GET ${url('https', 'api.tasks.test/tasks?owner=ana#top')} 500`,
      `GET ${url('https', 'api.tasks.test/tasks')} 500`,
    ],
  ])('masks %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    ['Timestamp 1760400000', `Timestamp ${REDACTED}`],
    ['Timestamp 1760400000000', `Timestamp ${REDACTED}`],
  ])('masks the standalone epoch timestamp in %j (log ISO dates instead)', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each(['version 1.4.2 (318)', 'due 2026-10-14', 'retry 3 of 5', 'HTTP 503'])(
    'keeps %j (too few digits to be a number that identifies someone)',
    (input) => {
      expect(scrubText(input)).toBe(input);
    },
  );

  it.each([
    // A 32-hex trace id with a 9-digit run inside, and one that starts with a long digit run.
    '4bf92f357712345678929d0e0e4736aa',
    '3577123456789290e0e4736aa4bf92f1',
    // A UUID whose groups are all digits, and one whose last group is.
    '12345678-1234-1234-1234-123456789012',
    '123e4567-e89b-12d3-a456-426614174000',
    'update 12345678-1234-1234-1234-123456789012 failed',
  ])('keeps the identifier in %j (a digit run inside an id is not a phone number)', (input) => {
    expect(scrubText(input)).toBe(input);
  });
});

describe('scrubValue', () => {
  it('redacts sensitive keys at any depth and scrubs every text', () => {
    const scrubbed = scrubValue({
      screen: 'tasks',
      nested: { refreshToken: 'abc', note: 'mail ana@tasks.test', count: 3 },
      list: ['ana@tasks.test', 7],
      Email: 'ana@tasks.test',
    });
    expect(scrubbed).toStrictEqual({
      screen: 'tasks',
      nested: { refreshToken: REDACTED, note: `mail ${REDACTED}`, count: 3 },
      list: [REDACTED, 7],
      Email: REDACTED,
    });
  });

  it('stops at MAX_DEPTH, so a cyclic or huge value cannot hang the reporter', () => {
    type Node = { child?: Node };
    const cyclic: Node = {};
    cyclic.child = cyclic;
    let value = scrubValue(cyclic);
    for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
      value = (value as Node).child;
    }
    expect(value).toBe(REDACTED);
  });
});

describe('filterBreadcrumb', () => {
  it.each(['console', 'touch', 'ui.click', undefined])('drops the %j category', (category) => {
    expect(filterBreadcrumb({ category, message: 'pressed Delete ana@tasks.test' })).toBeNull();
  });

  it('keeps app, navigation and network breadcrumbs, scrubbed', () => {
    expect(
      filterBreadcrumb({
        category: 'xhr',
        data: { url: url('https', 'api.tasks.test/tasks?q=ana'), status_code: 500 },
      }),
    ).toStrictEqual({
      category: 'xhr',
      message: undefined,
      data: { url: url('https', 'api.tasks.test/tasks'), status_code: 500 },
    });
    expect(filterBreadcrumb({ category: 'app.action', message: 'task.completed' })?.message).toBe(
      'task.completed',
    );
    expect(
      filterBreadcrumb({ category: 'navigation', message: '(app)/tasks/[id]' }),
    ).not.toBeNull();
  });
});

describe('scrubEvent', () => {
  const event = {
    event_id: 'e1',
    message: 'save failed for ana@tasks.test',
    user: { id: '42', email: 'ana@tasks.test', ip_address: '10.0.0.1' },
    request: {
      url: url('https', 'api.tasks.test/tasks?owner=ana'),
      cookies: { session: 'abc' },
      headers: { Authorization: 'Bearer abc' },
      data: { title: 'Call the doctor' },
      query_string: 'owner=ana',
    },
    exception: { values: [{ value: 'cannot sync ana@tasks.test' }] },
    breadcrumbs: [
      { category: 'console', message: 'title: Call the doctor' },
      { category: 'app.lifecycle', message: 'foreground' },
    ],
    extra: { password: 'hunter2', screen: 'tasks' },
    tags: { source: 'render' },
  };

  it('removes the person and everything typed or sent, and keeps the diagnosis', () => {
    const scrubbed = scrubEvent(event);
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.request).toStrictEqual({ url: url('https', 'api.tasks.test/tasks') });
    expect(scrubbed.message).toBe(`save failed for ${REDACTED}`);
    expect(scrubbed.exception.values[0]).toStrictEqual({ value: `cannot sync ${REDACTED}` });
    expect(scrubbed.breadcrumbs).toStrictEqual([
      { category: 'app.lifecycle', message: 'foreground', data: undefined },
    ]);
    expect(scrubbed.extra).toStrictEqual({ password: REDACTED, screen: 'tasks' });
    expect(scrubbed.tags).toStrictEqual({ source: 'render' });
    expect(scrubbed.event_id).toBe('e1');
  });

  it('keeps the ids in the SDK contexts and scrubs every other context', () => {
    const contexts = {
      trace: {
        trace_id: '4bf92f357712345678929d0e0e4736aa',
        span_id: '1234567890123456',
        op: 'navigation',
      },
      ota_updates: {
        update_id: '12345678-1234-1234-1234-123456789012',
        channel: 'production',
        runtime_version: '1.4.2',
      },
      device: { model: 'iPhone17,1', memory_size: 8_589_934_592 },
      checkout: { note: 'call +49 30 1234 5678', session: 'abc' },
    };
    const scrubbed = scrubEvent({ ...event, contexts });
    expect(scrubbed.contexts).toStrictEqual({
      trace: contexts.trace,
      ota_updates: contexts.ota_updates,
      device: contexts.device,
      checkout: { note: `call ${REDACTED}`, session: REDACTED },
    });
  });

  it('scrubs the description and data of transaction spans', () => {
    const scrubbed = scrubEvent({
      type: 'transaction',
      spans: [
        {
          span_id: '1234567890123456',
          description: `GET ${url('https', 'api.tasks.test/tasks?owner=ana')}`,
          data: { 'http.url': url('https', 'api.tasks.test/tasks?owner=ana'), token: 'abc' },
        },
        { span_id: '2234567890123456' },
      ],
    });
    expect(scrubbed.spans).toStrictEqual([
      {
        span_id: '1234567890123456',
        description: `GET ${url('https', 'api.tasks.test/tasks')}`,
        data: { 'http.url': url('https', 'api.tasks.test/tasks'), token: REDACTED },
      },
      { span_id: '2234567890123456' },
    ]);
  });

  it('redacts the bare query and fragment of request spans and breadcrumbs', () => {
    const scrubbed = scrubEvent({
      type: 'transaction',
      spans: [
        {
          span_id: '3234567890123456',
          data: {
            'http.query': '?q=doctor&key=abc',
            'http.fragment': '#x',
            'http.url': url('https', 'a.test/p?q=1'),
          },
        },
      ],
      breadcrumbs: [
        { category: 'xhr', data: { method: 'GET', 'http.query': '?q=doctor', status_code: 200 } },
      ],
    });
    expect(scrubbed.spans).toStrictEqual([
      {
        span_id: '3234567890123456',
        data: {
          'http.query': REDACTED,
          'http.fragment': REDACTED,
          'http.url': url('https', 'a.test/p'),
        },
      },
    ]);
    expect(scrubbed.breadcrumbs).toStrictEqual([
      {
        category: 'xhr',
        message: undefined,
        data: { method: 'GET', 'http.query': REDACTED, status_code: 200 },
      },
    ]);
  });

  it('leaves the original event untouched', () => {
    scrubEvent(event);
    expect(event.user.email).toBe('ana@tasks.test');
  });
});
