// src/games/ricochet-volley/canvas/volley-timeline.test.ts
import { simulateVolley } from '@/games/ricochet-volley/rules/simulate-volley';

import { volleyTracks } from './volley-timeline';

import type { Arena } from '@/games/ricochet-volley/rules/simulate-volley';

const ARENA: Arena = {
  walls: [
    { a: { x: 0, y: 640 }, b: { x: 0, y: 0 } },
    { a: { x: 0, y: 0 }, b: { x: 400, y: 0 } },
    { a: { x: 400, y: 0 }, b: { x: 400, y: 640 } },
  ],
  radius: 8,
  floorY: 620,
  maxTicks: 2400,
};

describe('volleyTracks', () => {
  it('replays the path as straight tracks from event to event', () => {
    const events = simulateVolley(
      [{ id: 1, pos: { x: 200, y: 560 }, vel: { x: 3, y: -5 } }],
      ARENA,
    );
    const tracks = volleyTracks(events);
    expect(tracks).toHaveLength(events.length - 1);
    expect(tracks[0]?.from).toStrictEqual([200, 560]);
    tracks.forEach((track, i) => {
      expect(track.to).toStrictEqual([events[i + 1]?.x, events[i + 1]?.y]);
      expect(track.startMs + track.durationMs).toBe(events[i + 1]?.atMs);
    });
  });
});
