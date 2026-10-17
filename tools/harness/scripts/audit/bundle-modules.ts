// scripts/audit/bundle-modules.ts
// Reads the source maps of a release export (npm run export:audit, which runs `expo export
// --platform ios --platform android --source-maps --output-dir dist-audit` as the production
// variant) and answers "which shipped module contains X". The map's sourcesContent names the owner
// of every module, so findings are attributed per npm package, never by grepping the raw bundle.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type BundleModule = {
  readonly platform: string;
  readonly source: string;
  readonly content: string;
};

type SourceMap = {
  readonly sources?: readonly string[];
  readonly sourcesContent?: readonly (string | null)[];
};

/** The platforms an export holds (ios, android), each with its source maps. */
export function exportMaps(exportDir: string): { platform: string; file: string }[] {
  const jsDir = path.join(exportDir, '_expo', 'static', 'js');
  if (!existsSync(jsDir)) {
    return [];
  }
  return readdirSync(jsDir).flatMap((platform) =>
    readdirSync(path.join(jsDir, platform))
      .filter((file) => file.endsWith('.map'))
      .map((file) => ({ platform, file: path.join(jsDir, platform, file) })),
  );
}

/** Every shipped module of every map; a map without sourcesContent throws (nothing to attribute). */
export function readBundleModules(exportDir: string): BundleModule[] {
  const maps = exportMaps(exportDir);
  if (maps.length === 0) {
    throw new Error(`no source maps under ${exportDir}/_expo/static/js: run npm run export:audit`);
  }
  return maps.flatMap(({ platform, file }) => {
    const map = JSON.parse(readFileSync(file, 'utf8')) as SourceMap;
    if (map.sources === undefined || map.sourcesContent === undefined) {
      throw new Error(`${file} embeds no sources: export with --source-maps`);
    }
    const contents = map.sourcesContent;
    return map.sources.map((source, index) => ({
      platform,
      source,
      content: contents[index] ?? '',
    }));
  });
}

/** 'node_modules/@scope/name/...' -> '@scope/name'; first-party files -> null. */
export function packageOf(source: string): string | null {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//u.exec(source.replaceAll('\\', '/'));
  return match?.[1] ?? null;
}

/**
 * A first-party source as a repo-relative path. Expo roots first-party sources at the project
 * ('/src/api/fetch-api-client.ts'); older maps use '../../src/...'. Both become 'src/...'.
 */
export function repoPathOf(source: string): string {
  return source.replaceAll('\\', '/').replace(/^(?:\.\.?\/)+|^\/+/u, '');
}

/** Metro's virtual modules ('\0polyfill:...') belong to no file and no package. */
export function isVirtualModule(source: string): boolean {
  return source.startsWith('\0');
}
