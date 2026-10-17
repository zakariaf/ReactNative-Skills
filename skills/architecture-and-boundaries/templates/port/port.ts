// src/services/__CONCERN__/__CONCERN__-port.ts
// A port: the app's vendor-neutral view of one outside service. No SDK type appears here; only
// __VENDOR__-__CONCERN__-adapter.ts imports the SDK.
import type { Result } from '@/core/result';

/** An expected failure of the service: a kebab-case kind union, never a thrown error. */
export type __PORT_NAME__Failure = {
  readonly kind: 'unavailable';
  readonly reason: string;
};

/** __PORT_SUMMARY__ */
export type __PORT_NAME__Port = {
  /** __QUERY_SUMMARY__ Resolves with a Result; never rejects. */
  readonly __QUERY__: () => Promise<Result<__VALUE_TYPE__, __PORT_NAME__Failure>>;
};
