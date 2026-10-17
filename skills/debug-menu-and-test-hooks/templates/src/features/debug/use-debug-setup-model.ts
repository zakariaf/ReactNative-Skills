// src/features/debug/use-debug-setup-model.ts
// The debug-link screen's model: parses the link once (the screen mounts once per link), applies the
// planned steps in order, then replaces itself with the requested screen, so Back never returns to
// the link. A refused link shows why (debug.setup-error) and goes to the error log; nothing of it is
// applied. React's development double effect applies a link twice, which the plan makes harmless.
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { err, ok } from '@/core/result';
import { useT } from '@/i18n/t-context';
import { useServices } from '@/services/services-context';

import { parseDebugLink } from './debug-links';
import { planDebugSetup } from './debug-setup-plan';
import { useTestHooks } from './test-hooks-context';

import type { DebugLinkError, DebugLinkParams } from './debug-links';
import type { DebugStep } from './debug-setup-plan';
import type { Result } from '@/core/result';
import type { TestHooks } from '@/services/test-hooks/create-test-hooks';

export type DebugSetupFailure =
  | DebugLinkError
  | { readonly kind: 'debug-link-settings-not-wired' }
  | { readonly kind: 'debug-link-settings-failed' }
  | { readonly kind: 'debug-link-overrides-not-saved' };

export type DebugSetupModel = {
  /** Translated: what the screen is doing, or why the link was refused. */
  readonly label: string;
  readonly isFailed: boolean;
};

type Navigate = (href: string) => void;

/** Applies one switch patch; dispatch sets a new failure only when this write failed. */
function applyOverrides(
  hooks: TestHooks,
  patch: Extract<DebugStep, { kind: 'overrides' }>['patch'],
): Result<void, DebugSetupFailure> {
  const failedBefore = hooks.overrides.getState().lastWriteFailure;
  hooks.overrides.getState().dispatch({ type: 'apply-overrides', patch });
  const failedNow = hooks.overrides.getState().lastWriteFailure;
  return failedNow !== null && failedNow !== failedBefore
    ? err({ kind: 'debug-link-overrides-not-saved' })
    : ok(undefined);
}

/**
 * Runs the steps in order; a settings change that restarts the app ends the run there. A link the app
 * cannot carry out in full is refused before any step runs, and a switch that was not saved stops the
 * run before it navigates, so a flow never tests a state the link did not set.
 */
async function applySteps(
  steps: readonly DebugStep[],
  hooks: TestHooks,
  navigate: Navigate,
): Promise<Result<void, DebugSetupFailure>> {
  if (hooks.settings === null && steps.some((step) => step.kind === 'settings')) {
    return err({ kind: 'debug-link-settings-not-wired' });
  }
  for (const step of steps) {
    if (step.kind === 'overrides') {
      const saved = applyOverrides(hooks, step.patch);
      if (!saved.ok) return saved;
    } else if (step.kind === 'settings') {
      // Never null here: a settings step without a target was refused above.
      const outcome = await hooks.settings?.apply(step.patch);
      if (outcome === 'restarting') return ok(undefined);
    } else {
      navigate(step.href);
    }
  }
  return ok(undefined);
}

function reasonOf(failure: DebugSetupFailure): string {
  if (!('param' in failure)) return failure.kind;
  return 'value' in failure
    ? `${failure.kind} ${failure.param}=${failure.value}`
    : `${failure.kind} ${failure.param}`;
}

export function useDebugSetupModel(params: DebugLinkParams): DebugSetupModel {
  const t = useT();
  const router = useRouter();
  const { errorLog } = useServices();
  const hooks = useTestHooks();
  const [parsed] = useState(() => parseDebugLink(params));
  const [failure, setFailure] = useState<DebugSetupFailure | null>(null);
  useEffect(() => {
    let isCurrent = true;
    const refuse = (refused: DebugSetupFailure): void => {
      errorLog.record('service', new Error(`debug link refused: ${reasonOf(refused)}`));
      if (isCurrent) setFailure(refused);
    };
    if (!parsed.ok) {
      errorLog.record('service', new Error(`debug link refused: ${reasonOf(parsed.error)}`));
    } else {
      applySteps(planDebugSetup(parsed.value), hooks, (href) => {
        router.replace(href);
      })
        .then((applied) => {
          if (!applied.ok) refuse(applied.error);
        })
        .catch((error: unknown) => {
          errorLog.record('service', error);
          refuse({ kind: 'debug-link-settings-failed' });
        });
    }
    return () => {
      isCurrent = false;
    };
  }, [parsed, hooks, router, errorLog]);
  const shown = parsed.ok ? failure : parsed.error;
  return shown === null
    ? { label: t('debug.setup.applying'), isFailed: false }
    : { label: t('debug.setup.failed', { reasonText: reasonOf(shown) }), isFailed: true };
}
