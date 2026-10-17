// src/services/push/read-eas-project-id.ts
// The EAS project id the Expo push service issues tokens for. EAS Build writes it into the build
// (Constants.easConfig); app.config.ts sets it as extra.eas.projectId for every other build. The
// adapter passes it to getExpoPushTokenAsync explicitly: without it the call throws
// ERR_NOTIFICATIONS_NO_EXPERIENCE_ID, and a guessed or copied id issues tokens for another project.
import Constants from 'expo-constants';

/** The part of expo-constants this reader looks at. */
export type ProjectIdSource = {
  readonly easConfig?: { readonly projectId?: string | null } | null;
  readonly expoConfig?: { readonly extra?: Readonly<Record<string, unknown>> } | null;
};

function extraProjectId(extra: Readonly<Record<string, unknown>> | undefined): string | null {
  const eas: unknown = extra?.['eas'];
  if (typeof eas !== 'object' || eas === null) return null;
  const projectId: unknown = Reflect.get(eas, 'projectId');
  return typeof projectId === 'string' ? projectId : null;
}

/** The project id from the build, or null when the build has none (then no Expo token exists). */
export function readEasProjectId(source: ProjectIdSource = Constants): string | null {
  const fromBuild = source.easConfig?.projectId;
  const projectId =
    typeof fromBuild === 'string' ? fromBuild : extraProjectId(source.expoConfig?.extra);
  return projectId !== null && projectId.trim() !== '' ? projectId : null;
}
