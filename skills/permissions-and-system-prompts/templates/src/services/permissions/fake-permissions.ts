// src/services/permissions/fake-permissions.ts
// A scripted PermissionsPort for tests that follows the platforms' dialog rules, so a model test
// proves what a person on each OS sees: iOS shows its dialog once (a refusal is final), Android shows
// it twice (the first refusal leaves 'denied', the second 'blocked'), no dialog ever appears for an
// allowed, blocked or unavailable permission, and a change in Settings is setState().
import type { PermissionState } from '@/core/permissions/permission-state';
import type {
  PermissionAccess,
  PermissionKind,
  PermissionsPort,
} from '@/services/permissions/permissions-port';

/**
 * What the person does in one system dialog. 'dismiss' (Android only) closes it without a choice:
 * Expo then reports what Android's rationale flag says, which is 'blocked' after dismissing the very
 * first dialog (the flag is still false) and 'denied' again after a dismissal from 'denied'.
 */
export type FakeDialogAnswer = 'allow' | 'allow-limited' | 'deny' | 'dismiss';

export type FakePermissionScript = {
  /** Whose dialog rules apply. */
  readonly platform: 'ios' | 'android';
  /** The state before the test acts (default 'undetermined'). */
  readonly state?: PermissionState;
  /** The answers to the dialogs, in order; once used up, every further dialog is refused. */
  readonly answers?: readonly FakeDialogAnswer[];
};

export type FakePermissionAccess = PermissionAccess & {
  /** How many system dialogs the fake showed. */
  readonly dialogs: () => number;
  /** The person changed the switch in Settings, or the OS reset an unused app's permissions. */
  readonly setState: (state: PermissionState) => void;
};

const ASKABLE: ReadonlySet<PermissionState> = new Set(['undetermined', 'denied']);

function afterRefusal(platform: 'ios' | 'android', before: PermissionState): PermissionState {
  return platform === 'android' && before === 'undetermined' ? 'denied' : 'blocked';
}

function afterDialog(
  script: FakePermissionScript,
  before: PermissionState,
  answer: FakeDialogAnswer,
): PermissionState {
  if (answer === 'allow') return 'granted';
  if (answer === 'allow-limited') return 'limited';
  if (answer === 'dismiss') return before === 'undetermined' ? 'blocked' : before;
  return afterRefusal(script.platform, before);
}

/** One scripted permission. */
export function createFakePermissionAccess(script: FakePermissionScript): FakePermissionAccess {
  let state = script.state ?? 'undetermined';
  const answers = [...(script.answers ?? [])];
  let dialogs = 0;
  return {
    permission: () => Promise.resolve(state),
    requestPermission: () => {
      if (ASKABLE.has(state)) {
        dialogs += 1;
        state = afterDialog(script, state, answers.shift() ?? 'deny');
      }
      return Promise.resolve(state);
    },
    dialogs: () => dialogs,
    setState: (next) => {
      state = next;
    },
  };
}

export type FakePermissions = PermissionsPort & {
  readonly access: Readonly<Record<PermissionKind, FakePermissionAccess>>;
  /** How often the app opened the system Settings app. */
  readonly settingsOpened: () => number;
};

/** A PermissionsPort over scripted permissions. */
export function createFakePermissions(
  access: Readonly<Record<PermissionKind, FakePermissionAccess>>,
): FakePermissions {
  let opened = 0;
  return {
    access,
    openSettings: () => {
      opened += 1;
      return Promise.resolve();
    },
    settingsOpened: () => opened,
  };
}
