// scripts/build/derived-data.ts
// DerivedData that was built in another folder (a copied or moved repo, a second checkout) keeps
// precompiled modules that name the old path: the next build fails with "was compiled with module
// cache path ..." and "missing required module 'SwiftShims'". The build deletes such a folder first.

/** /private/tmp and /tmp (and /private/var, /var) are one folder on macOS; either may be recorded. */
export function normalizedPath(path: string): string {
  return path.replace(/^\/private(?=\/)/, '').replace(/\/+$/, '');
}

/**
 * True when `recordedPath` (DerivedData's info.plist WorkspacePath, or a .pcm's module cache path)
 * lies outside `expectedDir` (the app's ios/ folder or its DerivedData folder). Unknown: keep it.
 */
export function isStaleDerivedData(recordedPath: string | null, expectedDir: string): boolean {
  if (recordedPath === null) return false;
  const recorded = normalizedPath(recordedPath);
  const expected = normalizedPath(expectedDir);
  return recorded !== expected && !recorded.startsWith(`${expected}/`);
}

/** The module cache path a precompiled module (.pcm, read as latin1) embeds, or null. */
export function moduleCachePathIn(pcmText: string): string | null {
  return /\/[^\s\0"]*?\/build\/ios-sim\/dd\/ModuleCache\.noindex\//.exec(pcmText)?.[0] ?? null;
}
