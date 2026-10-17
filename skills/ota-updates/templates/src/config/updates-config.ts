// src/config/updates-config.ts
// The over-the-air update settings app.config.ts spreads into every variant (the ota-updates skill).
// Pure and neutral: app.config.ts runs this file in Node with type stripping, so it imports nothing,
// reads no `process` and uses erasable syntax only. One policy for the whole app: the runtime version
// is the fingerprint of the native layer, launch never waits for the network, and the native startup
// check stays on so the anti-brick recovery can still fetch a fix.

/** EAS Update serves every project from this host; the path is the EAS project id. */
export const EAS_UPDATE_HOST = 'https://u.expo.dev';

/** An EAS project id: a lowercase UUID (`eas init` writes it to extra.eas.projectId). */
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The part of the Expo config this module owns. Spread it into the config object. */
export type UpdatesConfig = {
  readonly runtimeVersion: { readonly policy: 'fingerprint' };
  readonly updates: {
    readonly enabled: true;
    readonly url: string;
    /** The native check at every cold start; also what error recovery uses to fetch a fix. */
    readonly checkAutomatically: 'ON_LOAD';
    /** Launch runs what is on the device at once; a download applies at the next cold start. */
    readonly fallbackToCacheTimeout: 0;
  };
};

/** True for a well-formed EAS project id. */
export function isEasProjectId(value: string): boolean {
  return PROJECT_ID.test(value);
}

/**
 * The manifest URL of an EAS project. Throws on anything that is not a project id (a placeholder, a
 * typo, an uppercase copy), so a build never ships asking another project, or no project, for updates.
 */
export function easUpdateUrl(projectId: string): string {
  if (!isEasProjectId(projectId)) {
    throw new Error(
      `"${projectId}" is not an EAS project id (a lowercase UUID): run eas init and copy extra.eas.projectId`,
    );
  }
  return `${EAS_UPDATE_HOST}/${projectId}`;
}

/** runtimeVersion and updates for app.config.ts, the same for every variant. */
export function updatesConfig(projectId: string): UpdatesConfig {
  return {
    runtimeVersion: { policy: 'fingerprint' },
    updates: {
      enabled: true,
      url: easUpdateUrl(projectId),
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    },
  };
}
