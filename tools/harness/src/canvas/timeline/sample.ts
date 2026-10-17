// src/canvas/timeline/sample.ts
'worklet';

import { ease } from './track';

import type { Track } from './track';

/** The sampled state of one (channel, entity) pair at a moment of the timeline. */
export type FxEntry = {
  readonly values: readonly number[];
  /** Eased progress 0…1 of the active track. */
  readonly progress: number;
  /** Milliseconds since the active track started, clamped to 0…durationMs. */
  readonly ageMs: number;
};

/** Every animated key of a scene at one elapsed time. */
export type FxSample = {
  readonly elapsedMs: number;
  readonly entries: Readonly<Partial<Record<string, FxEntry>>>;
};

/** No animation: draw() shows the view's final state. */
export const EMPTY_FX: FxSample = { elapsedMs: 0, entries: {} };

/** Stable key for a (channel, entity) pair, e.g. 'glow:0'. */
export function trackKey(channel: string, entityId: number): string {
  return `${channel}:${String(entityId)}`;
}

/** Interpolates one track at an elapsed time (clamped to its start and end). */
export function sampleTrack(track: Track, elapsedMs: number): FxEntry {
  const ageMs = Math.min(Math.max(elapsedMs - track.startMs, 0), track.durationMs);
  const linear = track.durationMs > 0 ? ageMs / track.durationMs : 1;
  const progress = ease(track.easing, linear);
  const values: number[] = [];
  for (let i = 0; i < track.from.length; i += 1) {
    const from = track.from[i] ?? 0;
    const to = track.to[i] ?? from;
    values.push(from + (to - from) * progress);
  }
  return { values, progress, ageMs };
}

/** Started tracks beat unstarted ones; the latest started wins; else the earliest unstarted. */
function isBetterTrack(
  candidateStart: number,
  currentStart: number | undefined,
  t: number,
): boolean {
  if (currentStart === undefined) return true;
  const isCandidateStarted = candidateStart <= t;
  const isCurrentStarted = currentStart <= t;
  if (isCandidateStarted !== isCurrentStarted) return isCandidateStarted;
  return isCandidateStarted ? candidateStart >= currentStart : candidateStart < currentStart;
}

/**
 * Samples every key once. Before any track of a key starts, the key holds that track's `from`
 * (so a bar keeps its old height until its tween begins).
 */
export function sampleTimeline(tracks: readonly Track[], elapsedMs: number): FxSample {
  const entries: Partial<Record<string, FxEntry>> = {};
  const activeStart: Partial<Record<string, number>> = {};
  for (const track of tracks) {
    const key = trackKey(track.channel, track.entityId);
    if (isBetterTrack(track.startMs, activeStart[key], elapsedMs)) {
      activeStart[key] = track.startMs;
      entries[key] = sampleTrack(track, elapsedMs);
    }
  }
  return { elapsedMs, entries };
}

/** Reads one sampled entry; `undefined` means "no track: draw the view's final state". */
export function fxEntry(fx: FxSample, channel: string, entityId: number): FxEntry | undefined {
  return fx.entries[trackKey(channel, entityId)];
}

/**
 * True while the entry's track plays (started and not finished). An effect layer that is not a
 * tween of something visible (flash, glow, burst, shake) draws only while this holds: a sample
 * exists, holding `from`, long before its track starts.
 */
export function isPlaying(entry: FxEntry | undefined): entry is FxEntry {
  return entry !== undefined && entry.ageMs > 0 && entry.progress < 1;
}
