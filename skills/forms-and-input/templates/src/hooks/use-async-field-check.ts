// src/hooks/use-async-field-check.ts
// An async check of one field (forms-and-input): "is this name free?", asked of a port or the
// server, never inside the form schema (a schema check runs on every validation, without a pause,
// a cancel or a deadline). A value starts a check only when its shape is valid; the check waits
// for typing to pause (debounce), the newest value wins (a newer value aborts the older check),
// each check has a deadline, and leaving the screen cancels it. The state says which value it
// answers, so submit can require a pass for exactly the value being sent; the server stays the
// judge at write time (a conflict there becomes setError on the field).
import { useEffect, useState } from 'react';

import { createLatestRequest } from '@/core/async/latest-request';
import { delayOrAbort } from '@/services/async/delay-or-abort';
import { withTimeout } from '@/services/async/with-timeout';
import { useServices } from '@/services/services-context';

import type { Result } from '@/core/result';
import type { MessageKey } from '@/i18n/messages';

/** A finished check: the value may be used, or why not (a catalog key). */
export type FieldCheckVerdict =
  { readonly kind: 'passed' } | { readonly kind: 'refused'; readonly messageKey: MessageKey };

/** Why a check gave no verdict (offline, a server error, the deadline): the field cannot pass. */
export type FieldCheckFailure = { readonly kind: string };

/** Asks whether a value may be used; honours the signal; never rejects for an expected failure. */
export type FieldCheck = (
  value: string,
  signal: AbortSignal,
) => Promise<Result<FieldCheckVerdict, FieldCheckFailure>>;

export type AsyncFieldState =
  | { readonly status: 'idle' }
  | { readonly status: 'checking'; readonly value: string }
  | { readonly status: 'passed'; readonly value: string }
  | { readonly status: 'refused'; readonly value: string; readonly messageKey: MessageKey }
  /** The check failed or timed out: submit stays blocked and the field says so. */
  | { readonly status: 'unavailable'; readonly value: string };

export type AsyncFieldTiming = { readonly debounceMs: number; readonly deadlineMs: number };

export const DEFAULT_FIELD_CHECK_TIMING: AsyncFieldTiming = { debounceMs: 400, deadlineMs: 8000 };

export type AsyncFieldCheck = {
  readonly state: AsyncFieldState;
  /** Call from the field's change handler with the new text and whether its shape is valid. */
  readonly onValueChange: (value: string, isShapeValid: boolean) => void;
  /** True only when the newest check passed for exactly this value. */
  readonly hasPassed: (value: string) => boolean;
};

function stateOf(
  value: string,
  result: Result<FieldCheckVerdict, FieldCheckFailure>,
): AsyncFieldState {
  if (!result.ok) return { status: 'unavailable', value };
  if (result.value.kind === 'passed') return { status: 'passed', value };
  return { status: 'refused', value, messageKey: result.value.messageKey };
}

/** Debounced, latest-wins, deadline-bound async validation of one field. */
export function useAsyncFieldCheck(
  check: FieldCheck,
  timing: AsyncFieldTiming = DEFAULT_FIELD_CHECK_TIMING,
): AsyncFieldCheck {
  const { errorLog } = useServices();
  const [latest] = useState(createLatestRequest);
  const [state, setState] = useState<AsyncFieldState>({ status: 'idle' });
  useEffect(() => {
    return () => {
      latest.cancel();
    };
  }, [latest]);
  const run = async (value: string): Promise<void> => {
    const signal = latest.start();
    setState({ status: 'checking', value });
    if ((await delayOrAbort(timing.debounceMs, signal)) === 'aborted') return;
    const result = await withTimeout((inner) => check(value, inner), timing.deadlineMs, signal);
    if (signal.aborted) return;
    setState(stateOf(value, result));
  };
  const onValueChange = (value: string, isShapeValid: boolean): void => {
    if (!isShapeValid) {
      latest.cancel();
      setState({ status: 'idle' });
      return;
    }
    run(value).catch((error: unknown) => {
      errorLog.record('service', error);
    });
  };
  const hasPassed = (value: string): boolean => state.status === 'passed' && state.value === value;
  return { state, onValueChange, hasPassed };
}
