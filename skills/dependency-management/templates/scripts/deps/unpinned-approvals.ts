// scripts/deps/unpinned-approvals.ts
// Pure: the root package.json "allowScripts" approves install scripts by pinned keys only. npm 11.17
// reads a bare name ("fsevents": true) or "name@*" as an approval of every version, so the install
// script of every future release would run without a review, and `npm approve-scripts
// --allow-scripts-pending` (which lists only uncovered packages) stays silent about it. `npm
// approve-scripts <name>` replaces such a key with "<name>@<installed version>": true. A name-only
// false (a denial of every version) is a reviewed decision and passes, and so does every pinned key.
const NPM_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/u;
const NAME_ONLY = /^(@[^@/\s]+\/[^@\s]+|[^@\s]+)(?:@\s*\*?\s*)?$/u;

export type AllowScripts = Readonly<Record<string, unknown>>;

/** The package a key approves for every version ("fsevents", "@sentry/cli@*"), else null. */
export function nameOnlyPackage(key: string): string | null {
  const name = NAME_ONLY.exec(key.trim())?.[1];
  return name !== undefined && NPM_NAME.test(name) ? name : null;
}

/** One problem per allowScripts key that approves every version of a package. */
export function unpinnedApprovals(allowScripts: AllowScripts | undefined): readonly string[] {
  return Object.entries(allowScripts ?? {}).flatMap(([key, value]) => {
    const name = value === true ? nameOnlyPackage(key) : null;
    return name === null
      ? []
      : [
          `allowScripts "${key}": true approves the install script of every ${name} version ` +
            `without a review: read the installed version's script, then npm approve-scripts ` +
            `${name} (it writes "${name}@<version>": true in its place), or "${name}": false`,
        ];
  });
}
