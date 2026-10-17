// src/services/__CONCERN__/fake-__CONCERN__.ts
// The in-memory stand-in every test uses instead of the SDK (createTestServices takes it).
import { err, ok } from '@/core/result';

import type { __PORT_NAME__Failure, __PORT_NAME__Port } from './__CONCERN__-port';

export type Fake__PORT_NAME__Options = {
  readonly value: __VALUE_TYPE__;
  readonly failure?: __PORT_NAME__Failure;
};

export type Fake__PORT_NAME__ = __PORT_NAME__Port & {
  /** How many times the query ran, for assertions. */
  readonly callCount: () => number;
};

/** In-memory __PORT_NAME__Port: answers `value`, or `failure` when one is given. */
export function createFake__PORT_NAME__(options: Fake__PORT_NAME__Options): Fake__PORT_NAME__ {
  let count = 0;
  return {
    __QUERY__: () => {
      count += 1;
      return Promise.resolve(
        options.failure === undefined ? ok(options.value) : err(options.failure),
      );
    },
    callCount: () => count,
  };
}
