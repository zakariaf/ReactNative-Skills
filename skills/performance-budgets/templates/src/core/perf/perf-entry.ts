// src/core/perf/perf-entry.ts
// The perf log's entries: what a test build records on the device and what check-perf-report.mjs
// judges. Pure: the log's storage is the PerfLogPort (src/services/perf-log/).
import { attempt } from '@/core/result';

/**
 * - 'frames': a FrameReport while something animated (label: what was measured, e.g. tasks/list-scroll);
 * - 'cold-start': { nativeMs, jsMs, totalMs, prewarmed } of one launch (label: the first screen);
 * - 'storage-benchmark': { p50, p95, max, writes } of the per-change write;
 * - 'trace': a free diagnostic entry; kept in its own ring so traces never push evidence out.
 */
export const PERF_ENTRY_KINDS = ['frames', 'cold-start', 'storage-benchmark', 'trace'] as const;
export type PerfEntryKind = (typeof PERF_ENTRY_KINDS)[number];

export type PerfValue = number | boolean | null | readonly number[];

export type PerfEntry = {
  readonly kind: PerfEntryKind;
  readonly label: string;
  readonly atEpochMs: number;
  /**
   * The native build number (PerfReportHeader.buildNumber) of the binary that recorded the entry.
   * The log survives app updates, so check-perf-report.mjs judges only this build's entries; null
   * marks an entry written before entries were stamped (judged with a note).
   */
  readonly build: string | null;
  readonly data: Readonly<Record<string, PerfValue>>;
};

/** The newest 200 evidence entries survive... */
export const MAX_EVIDENCE_ENTRIES = 200;
/** ...and, beside them, the newest 400 traces. */
export const MAX_TRACE_ENTRIES = 400;

/** Appends and trims: a trace never evicts evidence, and evidence never evicts traces. */
export function appendPerfEntry(
  entries: readonly PerfEntry[],
  entry: PerfEntry,
): readonly PerfEntry[] {
  const next = [...entries, entry];
  const traces = next.filter((item) => item.kind === 'trace');
  const evidence = next.filter((item) => item.kind !== 'trace');
  const kept = new Set([
    ...traces.slice(-MAX_TRACE_ENTRIES),
    ...evidence.slice(-MAX_EVIDENCE_ENTRIES),
  ]);
  return next.filter((item) => kept.has(item));
}

function isPerfValue(value: unknown): value is PerfValue {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return true;
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

/** A stored entry; `build` may be missing in a log written before entries were stamped. */
type StoredPerfEntry = Omit<PerfEntry, 'build'> & { readonly build?: string | null };

function isBuildStamp(build: unknown): boolean {
  return build === undefined || build === null || typeof build === 'string';
}

function isStoredPerfEntry(value: unknown): value is StoredPerfEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  const { data } = entry;
  return (
    PERF_ENTRY_KINDS.some((kind) => kind === entry['kind']) &&
    typeof entry['label'] === 'string' &&
    typeof entry['atEpochMs'] === 'number' &&
    isBuildStamp(entry['build']) &&
    typeof data === 'object' &&
    data !== null &&
    Object.values(data).every(isPerfValue)
  );
}

/** Reads a stored payload; anything that is not a list of entries reads as an empty log. */
export function parsePerfEntries(payload: string): readonly PerfEntry[] {
  const parsed = attempt(
    (): unknown => JSON.parse(payload),
    () => ({ kind: 'perf-log-unreadable' }) as const,
  );
  if (!parsed.ok || !Array.isArray(parsed.value)) return [];
  return parsed.value
    .filter(isStoredPerfEntry)
    .map((entry) => ({ ...entry, build: entry.build ?? null }));
}

/** How many entries of each kind the log holds (the debug menu's summary line). */
export function countByKind(
  entries: readonly PerfEntry[],
): Readonly<Record<PerfEntryKind, number>> {
  const counts: Record<PerfEntryKind, number> = {
    frames: 0,
    'cold-start': 0,
    'storage-benchmark': 0,
    trace: 0,
  };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}

/** Who measured: the header of a shared report. */
export type PerfReportHeader = {
  readonly appId: string;
  readonly appVersion: string;
  /** The native build number (CFBundleVersion / versionCode) the installed binary carries. */
  readonly buildNumber: string;
  readonly platform: string;
  /** The OS version, e.g. "26.5" or "36". */
  readonly osVersion: string;
  /** The hardware, e.g. "iPhone17,1" or "Google Pixel 9" (a simulator says so). */
  readonly deviceModel: string;
};

/** The JSON a test build shares and check-perf-report.mjs reads: { ...header, entries }. */
export function perfReportJson(header: PerfReportHeader, entries: readonly PerfEntry[]): string {
  return JSON.stringify({ ...header, entries }, null, 1);
}
