// scripts/quality/check-worklet-boundary.ts
// Pure checker, run by check-worklet-boundary.test.ts inside `npm test` (no CLI entry: modules
// that Jest transforms must not use import.meta).
// UI-thread modules (file-level 'worklet' directive) may import VALUES only from other UI-thread
// modules or from ALLOWED_PACKAGES. Type-only imports are erased and always fine. A plain function
// called on the UI thread throws at runtime, never at build time, so this test is the guard.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ALLOWED_PACKAGES = new Set(['react-native-worklets']);
/**
 * Modules that run on the UI thread and must carry the directive (tests excluded): the kit's
 * UI-thread modules, and the draw and layout files of every surface folder (features and game
 * boards). Add a pattern here when the app keeps surfaces in another folder.
 */
export const REQUIRED: readonly RegExp[] = [
  /^src\/canvas\/timeline\/[^/]+\.ts$/,
  /^src\/canvas\/(canvas-layout|scene|scene-clock-state|run-scene-frame|record-picture|describe-error|draw-text)\.ts$/,
  /^src\/features\/[^/]+\/canvas\/(draw|layout)[^/]*\.ts$/,
  /^src\/games\/[^/]+\/canvas\/(draw|layout)[^/]*\.ts$/,
];
/** tsconfig.json "paths": the @/ alias of the canonical layout. */
const ALIAS = { prefix: '@/', target: 'src/' };
const CANDIDATES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
const DIRECTIVE = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*['"]worklet['"];/;
const VALUE_IMPORT = /^\s*(?:import|export)\s+(?!type\b)([^'";]*?)from\s+['"]([^'"]+)['"]/gm;

export type Violation = { readonly file: string; readonly problem: string };
/** Reads a repo-relative file; null when it does not exist. */
export type ReadFile = (file: string) => string | null;

function isWorkletSource(source: string): boolean {
  return DIRECTIVE.test(source);
}

/** `import { type A, type B } from` imports no value. */
function isTypeOnlyClause(clause: string): boolean {
  const names = /\{([^}]*)\}/.exec(clause)?.[1] ?? '';
  const outside = clause.replace(/\{[^}]*\}/, '').replace(/[\s,]/g, '');
  const list = names
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return outside === '' && list.length > 0 && list.every((name) => name.startsWith('type '));
}

/** The repo-relative file a specifier names (relative or @/), or null for a package. */
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  read: ReadFile,
): string | null {
  let base: string | null = null;
  if (specifier.startsWith('.')) base = path.posix.join(path.posix.dirname(fromFile), specifier);
  else if (specifier.startsWith(ALIAS.prefix)) base = ALIAS.target + specifier.slice(2);
  if (base === null) return null;
  const found = CANDIDATES.map((suffix) => base + suffix).find((file) => read(file) !== null);
  return found ?? base;
}

function importViolation(file: string, specifier: string, read: ReadFile): Violation | null {
  const target = resolveSpecifier(file, specifier, read);
  if (target === null) {
    return ALLOWED_PACKAGES.has(specifier)
      ? null
      : { file, problem: `value import from package ${specifier}` };
  }
  return isWorkletSource(read(target) ?? '')
    ? null
    : { file, problem: `value import from non-worklet module ${target}` };
}

export function checkFile(file: string, read: ReadFile): readonly Violation[] {
  const source = read(file) ?? '';
  const isWorklet = isWorkletSource(source);
  const violations: Violation[] = [];
  if (!isWorklet && REQUIRED.some((pattern) => pattern.test(file))) {
    violations.push({ file, problem: "missing file-level 'worklet'; directive" });
  }
  if (!isWorklet) return violations;
  for (const [, clause = '', specifier = ''] of source.matchAll(VALUE_IMPORT)) {
    if (isTypeOnlyClause(clause)) continue;
    const violation = importViolation(file, specifier, read);
    if (violation !== null) violations.push(violation);
  }
  return violations;
}

/** Every non-test TypeScript file under src/, repo-relative with forward slashes. */
export function sourceFiles(): string[] {
  return readdirSync(path.join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
    .map((file) => `src/${file.split(path.sep).join('/')}`)
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$|\.d\.ts$/.test(file));
}

export function checkRepo(): readonly Violation[] {
  const read: ReadFile = (file) => {
    try {
      return readFileSync(path.join(ROOT, file), 'utf8');
    } catch {
      return null;
    }
  };
  return sourceFiles().flatMap((file) => checkFile(file, read));
}
