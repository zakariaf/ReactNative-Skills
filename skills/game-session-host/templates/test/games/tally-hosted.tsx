// test/games/tally-hosted.tsx
// The tally game as the app hosts it: TALLY_GAME plus a Surface that renders one button per board
// column and tray slot, so component tests can tap them and read what the board was given.
import { Pressable, View } from 'react-native';

import { TALLY_GAME, TALLY_TUTORIAL } from './tally-game';

import type { TallyEvent, TallyIntent, TallyMove, TallyState } from './tally-game';
import type { CanvasTarget } from '@/canvas/canvas-layout';
import type { GameSurfaceProps, HostedGame } from '@/services/game-host/hosted-game';
import type { JSX } from 'react';

export type TallySurfaceProps = GameSurfaceProps<TallyState, TallyMove, TallyEvent, TallyIntent>;

const CELLS: readonly CanvasTarget[] = [
  { regionId: 'board', col: 0, row: 0 },
  { regionId: 'board', col: 1, row: 0 },
  { regionId: 'tray', col: 0, row: 0 },
  { regionId: 'tray', col: 1, row: 0 },
];

function TallySurface({
  testID,
  state,
  isInputEnabled,
  selected,
  hintedMove,
  onIntent,
}: TallySurfaceProps): JSX.Element {
  return (
    <View
      testID={testID}
      accessibilityValue={{ now: state.count, max: state.target }}
      accessibilityState={{ disabled: !isInputEnabled }}
    >
      {CELLS.map((target) => (
        <Pressable
          key={`${target.regionId}-${String(target.col)}`}
          testID={`${testID}.${target.regionId}.${String(target.col)}`}
          accessibilityRole="button"
          accessibilityState={{
            selected: selected?.regionId === target.regionId && selected.col === target.col,
            // The hinted cell reads as expanded (a test-only signal; a real board outlines it).
            expanded:
              hintedMove !== null &&
              target.regionId === 'board' &&
              hintedMove.amount === target.col + 1,
          }}
          onPress={() => {
            onIntent({ kind: 'tap', target, selected: null });
          }}
        />
      ))}
    </View>
  );
}

export const TALLY_HOSTED: HostedGame<TallyState, TallyMove, TallyEvent, TallyIntent> = {
  ...TALLY_GAME,
  Surface: TallySurface,
  tutorial: TALLY_TUTORIAL,
};
