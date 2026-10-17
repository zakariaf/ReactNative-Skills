// src/games/ricochet-volley/canvas/volley-timeline.ts
import type { Track } from '@/canvas/timeline/track';
import type { VolleyEvent } from '@/games/ricochet-volley/rules/simulate-volley';

/**
 * Between two events a ball moves in a straight line (no gravity), so linear 'ball' tracks from
 * one event point to the next replay the simulated path exactly. With gravity or curves, emit a
 * position event every few ticks instead and chain those.
 */
export function volleyTracks(events: readonly VolleyEvent[]): readonly Track[] {
  const last = new Map<number, VolleyEvent>();
  const tracks: Track[] = [];
  for (const event of events) {
    const previous = last.get(event.ballId);
    if (previous !== undefined && event.atMs > previous.atMs) {
      tracks.push({
        channel: 'ball',
        entityId: event.ballId,
        startMs: previous.atMs,
        durationMs: event.atMs - previous.atMs,
        easing: 'linear',
        from: [previous.x, previous.y],
        to: [event.x, event.y],
        ...(event.kind === 'ball-bounced' ? { cue: { sound: 'bounce' } } : {}),
      });
    }
    last.set(event.ballId, event);
  }
  return tracks;
}
