// src/hooks/use-permission-gate.ts
// The one way a feature asks for a permission: from a person's press, never at launch or from an
// effect. requestAccess(onAllowed) reads the state fresh and then either runs onAllowed, shows the
// system dialog, or opens one of the app's sheets: 'explain' (before the first dialog, one button
// that opens it), 'rationale' (Android, before asking again: "Continue" and "No thanks"),
// 'settings' (blocked: only the Settings app can turn it on) or 'unavailable'. A refusal in the
// system dialog is respected: no sheet follows it. The state the view shows ('blocked' -> "Camera
// access is off") comes from an OS-mirror store that re-reads whenever the app returns to the
// foreground. Owned by the permissions-and-system-prompts skill.
import { useState, useSyncExternalStore } from 'react';

import { isPermissionAllowed, nextAskStep } from '@/core/permissions/permission-state';
import { createPermissionStatusMirror } from '@/services/permissions/permission-status-mirror';

import type { AskStep } from '@/core/permissions/permission-state';
import type {
  PermissionSnapshot,
  PermissionStatusMirror,
} from '@/services/permissions/permission-status-mirror';
import type { PermissionAccess } from '@/services/permissions/permissions-port';

/** The app's own sheet on screen, or null. */
export type PermissionSheet = Exclude<AskStep, 'proceed' | 'ask'> | null;

export type PermissionGateOptions = {
  /** The permission (services.permissions.access.<kind>, or a notification port). */
  readonly access: PermissionAccess;
  /** services.permissions.openSettings. */
  readonly openSettings: () => Promise<void>;
  /** From contracts/permissions.json: explain on the app's own screen before the first dialog. */
  readonly shouldExplainFirst: boolean;
  readonly onError: (error: unknown) => void;
};

export type PermissionGate = {
  /** The state for the view ('unknown' until the first read). */
  readonly state: PermissionSnapshot;
  readonly sheet: PermissionSheet;
  /** True while a read or the system dialog is in progress: disable the control. */
  readonly isAsking: boolean;
  /** From a press: runs onAllowed once the permission allows it. */
  readonly requestAccess: (onAllowed: () => void) => void;
  /** The sheet's "Continue": closes it and shows the system dialog. */
  readonly confirm: () => void;
  /** "No thanks" or close: the feature stays off, nothing is asked. */
  readonly dismiss: () => void;
  /** The settings sheet's button: opens the app's page in the Settings app. */
  readonly openSettings: () => void;
};

/**
 * The ask in progress: the action waiting behind a sheet, and a lock that lets one ask run at a time
 * (Android throws "Another permissions request is in progress" on a second request). A plain object
 * made once per mount, so handlers share it without refs.
 */
type GateSession = {
  readonly hold: (onAllowed: () => void) => void;
  readonly take: () => (() => void) | null;
  readonly lock: () => boolean;
  readonly unlock: () => void;
};

function createGateSession(): GateSession {
  let held: (() => void) | null = null;
  let isLocked = false;
  return {
    hold: (onAllowed) => {
      held = onAllowed;
    },
    take: () => {
      const onAllowed = held;
      held = null;
      return onAllowed;
    },
    lock: () => {
      if (isLocked) return false;
      isLocked = true;
      return true;
    },
    unlock: () => {
      isLocked = false;
    },
  };
}

type GateParts = {
  readonly options: PermissionGateOptions;
  readonly mirror: PermissionStatusMirror;
  readonly session: GateSession;
  readonly setSheet: (sheet: PermissionSheet) => void;
  readonly setIsAsking: (isAsking: boolean) => void;
};

async function showSystemDialog(parts: GateParts, onAllowed: () => void): Promise<void> {
  const state = await parts.options.access.requestPermission();
  parts.mirror.set(state);
  if (isPermissionAllowed(state)) onAllowed();
}

async function startAsk(parts: GateParts, onAllowed: () => void): Promise<void> {
  const state = await parts.options.access.permission();
  parts.mirror.set(state);
  const step = nextAskStep(state, parts.options);
  if (step === 'proceed') {
    onAllowed();
  } else if (step === 'ask') {
    await showSystemDialog(parts, onAllowed);
  } else {
    parts.session.hold(onAllowed);
    parts.setSheet(step);
  }
}

/** Runs one ask at a time; a press while one runs is ignored. */
function runExclusive(parts: GateParts, task: () => Promise<void>): void {
  if (!parts.session.lock()) return;
  parts.setIsAsking(true);
  const finish = (): void => {
    parts.session.unlock();
    parts.setIsAsking(false);
  };
  task().then(finish, (error: unknown) => {
    parts.options.onError(error);
    finish();
  });
}

/** Closes the sheet and hands back the action that waited behind it. */
function closeSheet(parts: GateParts): (() => void) | null {
  parts.setSheet(null);
  return parts.session.take();
}

/** The ask flow for one permission, for a feature's model hook. */
export function usePermissionGate(options: PermissionGateOptions): PermissionGate {
  const [mirror] = useState(() =>
    createPermissionStatusMirror({ access: options.access, onError: options.onError }),
  );
  const [session] = useState(createGateSession);
  const state = useSyncExternalStore(mirror.subscribe, mirror.snapshot, mirror.snapshot);
  const [sheet, setSheet] = useState<PermissionSheet>(null);
  const [isAsking, setIsAsking] = useState(false);
  const parts: GateParts = { options, mirror, session, setSheet, setIsAsking };
  return {
    state,
    sheet,
    isAsking,
    requestAccess: (onAllowed) => {
      runExclusive(parts, () => startAsk(parts, onAllowed));
    },
    confirm: () => {
      const onAllowed = closeSheet(parts);
      if (onAllowed !== null) runExclusive(parts, () => showSystemDialog(parts, onAllowed));
    },
    dismiss: () => {
      closeSheet(parts);
    },
    openSettings: () => {
      closeSheet(parts);
      options.openSettings().catch(options.onError);
    },
  };
}
