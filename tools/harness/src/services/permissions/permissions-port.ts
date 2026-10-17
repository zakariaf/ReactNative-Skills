// src/services/permissions/permissions-port.ts
// The PermissionsPort: what the app needs from the OS permission system and nothing more. One
// PermissionAccess per permission the app asks for (contracts/permissions.json lists each), plus the
// way to the app's page in the system Settings. Owned by the permissions-and-system-prompts skill.
// Adapters: one per permission (camera-permission-adapter.ts binds a module's get/request pair
// through expo-permission-access.ts, which maps any Expo answer), and system-settings-adapter.ts
// opens Settings. Fake: fake-permissions.ts. Nothing here ever rejects.
import type { PermissionState } from '@/core/permissions/permission-state';

/**
 * One permission. The member names match the notification ports of the push-notifications and
 * local-notifications skills, so their ports satisfy this type and share the same ask flow.
 */
export type PermissionAccess = {
  /** Reads the current state; never shows a dialog. Never rejects ('unavailable' on failure). */
  readonly permission: () => Promise<PermissionState>;
  /**
   * Shows the system dialog when the OS still allows one and resolves with the outcome (at once
   * when it does not). Called only from a person's action, through usePermissionGate.
   */
  readonly requestPermission: () => Promise<PermissionState>;
};

/** The permissions this app asks for: one member per kind in contracts/permissions.json. */
export type PermissionKind = 'camera';

/**
 * The app's permissions: one PermissionAccess per kind and the way to the Settings app. Created once
 * by the composition root; no member ever rejects, and only requestPermission shows a dialog.
 */
export type PermissionsPort = {
  readonly access: Readonly<Record<PermissionKind, PermissionAccess>>;
  /** Opens this app's page in the system Settings app. Never rejects. */
  readonly openSettings: () => Promise<void>;
};
