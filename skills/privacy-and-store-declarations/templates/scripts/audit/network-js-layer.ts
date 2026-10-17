// scripts/audit/network-js-layer.ts
// Which shipped JS modules can open a connection. A first-party module (no node_modules in its
// path) may do so only inside the network seams of contracts/privacy.json (src/api/** and
// networkModules under the api-port profile, nothing under offline-only), and may hold a remote URL
// only in the URL seams (src/config and linkFiles); any other first-party finding fails at once and
// is never baselined. Comments in first-party modules are masked first (a JSDoc line that names
// fetch() is not a request). Third-party findings are compared with the js section of
// contracts/network-baseline.json, after the SDKs the contract declares.
import { isVirtualModule, packageOf, repoPathOf } from './bundle-modules.ts';
import { addFinding } from './network-baseline.ts';
import { matchesAnyGlob } from './privacy-contract.ts';

import type { BundleModule } from './bundle-modules.ts';
import type { Findings } from './network-baseline.ts';

export const JS_PATTERNS: Readonly<Record<string, RegExp>> = {
  fetch: /\bfetch\(/u,
  xhr: /new XMLHttpRequest\b/u,
  webSocket: /new WebSocket\(/u,
  eventSource: /new EventSource\(/u,
  beacon: /\bsendBeacon\(/u,
  // expo-file-system's transfers (and the legacy API); a no-argument downloadAsync() is expo-asset's local copy.
  fileTransfer:
    /\b(?:downloadFileAsync|uploadAsync|createDownloadResumable|createUploadTask)\s*\(|\bdownloadAsync\s*\(\s*[^\s)]/u,
  // XML namespace and schema identifiers (svg xmlns, JSON Schema) name no request.
  remoteUrl:
    /['"`](?:https?|wss?):\/\/(?!localhost\b|127\.0\.0\.1\b|10\.0\.2\.2\b|www\.w3\.org\/|json-schema\.org\/)[^'"`\s]+/u,
};

export type Seams = { readonly network: readonly string[]; readonly urls: readonly string[] };

// A string or template literal (kept) or a comment (masked). Regex literals are not tokenized: a
// quote inside one can shift the masking, which only ever keeps more text, never hides code.
const TOKENS = /(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1|\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu;

/** The source with every comment blanked (newlines kept), so a doc comment that names fetch() is no finding. */
export function maskComments(source: string): string {
  return source.replace(TOKENS, (token) =>
    token.startsWith('/') ? token.replace(/[^\n]/gu, ' ') : token,
  );
}

function isAllowedFirstParty(source: string, category: string, seams: Seams): boolean {
  const file = repoPathOf(source);
  return matchesAnyGlob(file, category === 'remoteUrl' ? seams.urls : seams.network);
}

/** Third-party findings per package, and the first-party modules that break the profile. */
export function jsNetworkFindings(
  modules: readonly BundleModule[],
  seams: Seams,
): { readonly findings: Findings; readonly firstParty: readonly string[] } {
  const findings = new Map<string, Set<string>>();
  const firstParty: string[] = [];
  for (const { platform, source, content } of modules) {
    const owner = packageOf(source);
    if (isVirtualModule(source)) {
      continue;
    }
    const code = owner === null ? maskComments(content) : content;
    for (const [category, pattern] of Object.entries(JS_PATTERNS)) {
      if (!pattern.test(code)) {
        continue;
      }
      if (owner !== null) {
        addFinding(findings, owner, category);
      } else if (!isAllowedFirstParty(source, category, seams)) {
        firstParty.push(`${platform}: ${repoPathOf(source)}: ${category}`);
      }
    }
  }
  return { findings, firstParty };
}

/** Shipped modules that contain one of the needles, outside the package allowed to hold it. */
export function modulesContaining(
  modules: readonly BundleModule[],
  needle: RegExp,
  allowedPackage: string | null = null,
): string[] {
  return modules
    .filter((module) => needle.test(module.content) && packageOf(module.source) !== allowedPackage)
    .map((module) => `${module.platform}: ${repoPathOf(module.source)}`);
}
