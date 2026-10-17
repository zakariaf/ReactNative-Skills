// src/services/__CONCERN__/__VENDOR__-__CONCERN__-adapter.ts
// The only file that imports __VENDOR_SDK__ (the lint config's ADAPTERS exemption matches
// src/services/<concern>/*-adapter.ts). It maps every SDK answer and error to the port's
// vendor-neutral types; an SDK call that can hang gets a timeout here (a Result, never a throw).
import { __VENDOR_CALL__ } from '__VENDOR_SDK__';

import { attemptAsync } from '@/core/result';

import type { __PORT_NAME__Port } from './__CONCERN__-port';

/** Maps the SDK's answer to the port's vendor-neutral value. */
function toValue(answer: Awaited<ReturnType<typeof __VENDOR_CALL__>>): __VALUE_TYPE__ {
  return __MAPPING_EXPRESSION__;
}

/** Creates the device __PORT_NAME__Port. Called once, by the composition root. */
export function create__ADAPTER_PASCAL__Adapter(): __PORT_NAME__Port {
  return {
    __QUERY__: () =>
      attemptAsync(
        async () => toValue(await Promise.resolve(__VENDOR_CALL__())),
        (thrown) => ({
          kind: 'unavailable',
          reason: thrown instanceof Error ? thrown.message : 'unknown',
        }),
      ),
  };
}
