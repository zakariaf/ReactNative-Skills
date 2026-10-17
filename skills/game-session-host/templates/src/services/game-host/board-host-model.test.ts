// src/services/game-host/board-host-model.test.ts
import { tallyTap } from '@test/games/tally-game';

import { isSameTarget, routeIntent, selectedAt } from './board-host-model';

const TRAY = ['tray'];

describe('routeIntent', () => {
  it('lets a tap in a select region pick a target, never a move', () => {
    const route = routeIntent({
      intent: tallyTap(1, 'tray'),
      selected: null,
      seq: 3,
      selectRegions: TRAY,
    });

    expect(route).toStrictEqual({
      selection: { target: { regionId: 'tray', col: 1, row: 0 }, seq: 3 },
      intent: null,
    });
  });

  it('drops the selection when the same target is tapped again', () => {
    const selected = { regionId: 'tray', col: 1, row: 0 };

    expect(
      routeIntent({ intent: tallyTap(1, 'tray'), selected, seq: 3, selectRegions: TRAY }).selection,
    ).toBeNull();
  });

  it('carries the selection to the next tap and keeps it until a move lands', () => {
    const selected = { regionId: 'tray', col: 1, row: 0 };
    const route = routeIntent({ intent: tallyTap(0), selected, seq: 3, selectRegions: TRAY });

    expect(route.intent).toStrictEqual({ ...tallyTap(0), selected });
    expect(route.selection).toStrictEqual({ target: selected, seq: 3 });
  });

  it('clears the selection on a drag', () => {
    const from = { regionId: 'board', col: 0, row: 0 };
    const route = routeIntent({
      intent: { kind: 'drag-end', from, to: null },
      selected: from,
      seq: 1,
      selectRegions: TRAY,
    });

    expect(route.selection).toBeNull();
  });
});

describe('selectedAt and isSameTarget', () => {
  it('shows a selection only at the eventSeq it was made at', () => {
    const target = { regionId: 'tray', col: 0, row: 0 };

    expect(selectedAt({ target, seq: 2 }, 2)).toBe(target);
    expect(selectedAt({ target, seq: 2 }, 3)).toBeNull();
    expect(isSameTarget(target, { ...target })).toBe(true);
    expect(isSameTarget(target, null)).toBe(false);
  });
});
