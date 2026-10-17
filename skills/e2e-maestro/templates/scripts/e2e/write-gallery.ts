// scripts/e2e/write-gallery.ts
// One static HTML page the reviewer opens locally: baseline | this run | diff for every screenshot,
// failed combinations first (in red, with their Maestro log folder), then changed rows. Paths are
// relative to the page, so the folder can be zipped and shared.
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { PngComparison } from './screenshot-compare.ts';

export const NEW_BASELINE = 'baseline-written';
/** A device x locale x theme combination that captured nothing usable (no boot, a failed flow). */
export type CaptureFailed = {
  readonly kind: 'capture-failed';
  readonly message: string;
  /** The Maestro output folder of that combination (its log and screenshots). */
  readonly outDir: string;
};
export type RowResult = PngComparison | CaptureFailed | typeof NEW_BASELINE;
export type GalleryRow = {
  /** <platform>/<device>/<locale>-<theme>[-largest]/<screen>, or the set alone for a failed one */
  readonly label: string;
  readonly actual: string | null;
  readonly baseline: string | null;
  readonly result: RowResult;
};

export function isFailed(result: RowResult): result is CaptureFailed {
  return result !== NEW_BASELINE && result.kind === 'capture-failed';
}

export function isChanged(result: RowResult): boolean {
  return result !== NEW_BASELINE && result.kind !== 'match' && result.kind !== 'capture-failed';
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);

function cell(outDir: string, path: string | null): string {
  if (path === null) return '<td></td>';
  return `<td><img loading="lazy" src="${escapeHtml(relative(outDir, path))}"></td>`;
}

function row(outDir: string, { label, actual, baseline, result }: GalleryRow): string {
  if (isFailed(result)) {
    const log = escapeHtml(relative(outDir, result.outDir));
    const detail = `${escapeHtml(result.message)}<br>log: <a href="${log}">${log}</a>`;
    return `<tr class="capture-failed"><th>${escapeHtml(label)}<br>capture failed</th><td colspan="3">${detail}</td></tr>`;
  }
  const status = result === NEW_BASELINE ? 'new baseline' : result.kind;
  const diff = result !== NEW_BASELINE && result.kind === 'mismatch' ? result.diffPath : null;
  const cells = [cell(outDir, baseline), cell(outDir, actual), cell(outDir, diff)].join('');
  return `<tr class="${status}"><th>${escapeHtml(label)}<br>${status}</th>${cells}</tr>`;
}

const rank = ({ result }: GalleryRow): number => (isFailed(result) ? 2 : Number(isChanged(result)));

/** The page's HTML: failed combinations first, then changed rows, then the rest in capture order. */
export function galleryHtml(outDir: string, rows: readonly GalleryRow[]): string {
  const sorted = [...rows].sort((a, b) => rank(b) - rank(a));
  return [
    '<!doctype html><meta charset="utf-8"><title>Screenshot matrix</title>',
    '<style>body{font:14px system-ui;margin:16px}img{width:220px}th{text-align:start;vertical-align:top}',
    'tr.mismatch th,tr.size-changed th,tr.missing-baseline th,tr.capture-failed{color:#b00020}</style>',
    '<h1>Screenshot matrix</h1><p>Columns: baseline | this run | diff (red = changed pixels). Failed and changed rows first.</p>',
    `<table>${sorted.map((item) => row(outDir, item)).join('\n')}</table>`,
  ].join('\n');
}

/** Writes <outDir>/index.html and returns its path. */
export function writeGallery(outDir: string, rows: readonly GalleryRow[]): string {
  const file = join(outDir, 'index.html');
  writeFileSync(file, galleryHtml(outDir, rows));
  return file;
}
