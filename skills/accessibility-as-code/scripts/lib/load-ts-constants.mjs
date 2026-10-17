// load-ts-constants.mjs: evaluates the top-level constants of a data-only TypeScript module
// (a palette, a chart colour table) without any package: Node's built-in type stripping, then a
// sandboxed vm run with no require, no imports and a 1 s timeout. Not an entry point.

import * as nodeModule from 'node:module';
import vm from 'node:vm';

export class ConstantsError extends Error {}

export function loadTsConstants(source, file) {
  const strip = nodeModule.stripTypeScriptTypes;
  if (typeof strip !== 'function') {
    throw new ConstantsError('this Node has no module.stripTypeScriptTypes (needs Node 22.13 or newer)');
  }
  const originalEmit = process.emitWarning;
  process.emitWarning = () => {};
  let js;
  try {
    js = strip(source, { mode: 'strip' });
  } catch (error) {
    throw new ConstantsError(`${file}: cannot strip TypeScript types (${error.message.split('\n')[0]})`);
  } finally {
    process.emitWarning = originalEmit;
  }
  if (/^\s*import\s+(?!type\b)[^;]*?['"][^'"]+['"]/m.test(js)) {
    throw new ConstantsError(`${file} imports runtime values; keep palettes and colour tables as literal #RRGGBB data`);
  }
  js = js.replace(/^\s*export\s+(const|let|var)\s/gm, '$1 ').replace(/^\s*export\s*\{[^}]*\};?/gm, '');
  const names = [...js.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  if (names.length === 0) throw new ConstantsError(`${file} declares no top-level constants`);
  try {
    return vm.runInNewContext(`${js}\n;({ ${names.join(', ')} })`, Object.create(null), { timeout: 1000 });
  } catch (error) {
    throw new ConstantsError(`${file}: evaluating its constants failed (${String(error.message ?? error).split('\n')[0]})`);
  }
}
