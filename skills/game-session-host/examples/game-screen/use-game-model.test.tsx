// src/features/game/use-game-model.test.tsx
// The Game screen's model through the real router (Expo Router's in-memory router): Back pauses in
// play, resumes in Pause, finishes a pending loss and leaves a recorded run; Pause -> Home leaves a
// live run, and a pending loss, in one tap; a stack reset on a live run is guarded. A stand-in Home
// and a stand-in Game route that shows the run's status and hands its model to the test, so no board
// or button is needed. The monetization hook is the one module mocked: every perk is free here.
import { act, screen } from '@testing-library/react-native';
import { Stack, router } from 'expo-router';
import { useEffect } from 'react';

import { createFullscreenAdGate } from '@/services/ads/fullscreen-ad';
import { createGameHost } from '@/services/game-host/game-host';
import { GameHostsProvider } from '@/services/game-host/game-host-context';
import { AppText } from '@/ui/app-text';
import { createGameHostTestDeps } from '@test/games/game-host-test-deps';
import { TALLY_HOSTED } from '@test/games/tally-hosted';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { useGameModel } from './use-game-model';

import type { GameModel } from './use-game-model';
import type { GameHost } from '@/services/game-host/game-host';
import type { SessionOpen } from '@/services/game-host/open-session';
import type { GameHostTestDeps } from '@test/games/game-host-test-deps';
import type { Href } from 'expo-router';
import type { JSX } from 'react';

jest.mock('@/features/game/use-rescue-offer', () => ({
  useRescueOffer: () => ({
    offer: 'free',
    pay: (then: () => void) => {
      then();
    },
  }),
}));

const OPEN: SessionOpen = { start: 'new', ref: { kind: 'level', level: 1 } };
/** The stand-in Game route's href (the app's typed routes know the real one; app code never casts). */
const GAME = '/game/tally' as Href;

/** The model the stand-in Game route rendered last; the test presses its commands. */
const latest: { current: GameModel | null } = { current: null };

function HomeStandIn(): JSX.Element {
  return <AppText>Home</AppText>;
}

function GameStandIn(): JSX.Element {
  const model = useGameModel('tally', OPEN);
  useEffect(() => {
    latest.current = model;
  });
  return <AppText testID="game.status">{model.view?.status ?? 'none'}</AppText>;
}

/** Presses one of the model's commands, as the screen's button would. */
async function press(command: (model: GameModel) => () => void): Promise<void> {
  const model = latest.current;
  if (model === null) throw new Error('the Game route has not rendered');
  await act(() => {
    command(model)();
  });
}

type Opened = { readonly deps: GameHostTestDeps; readonly host: GameHost };

/** Mounts Home, then pushes the Game route over it, as the app does. */
async function openGame(): Promise<Opened & { readonly pathname: () => string }> {
  const deps = createGameHostTestDeps();
  const host = createGameHost(TALLY_HOSTED, deps);
  function Layout(): JSX.Element {
    return (
      <GameHostsProvider hosts={[host]}>
        <Stack />
      </GameHostsProvider>
    );
  }
  const view = await renderRouterWithProviders(
    { _layout: Layout, index: HomeStandIn, 'game/[gameId]': GameStandIn },
    { services: { fullscreenAd: createFullscreenAdGate() } },
  );
  await act(() => {
    router.push(GAME);
  });
  return { deps, host, pathname: view.getPathname };
}

const status = (): string => {
  const text: unknown = screen.getByTestId('game.status').props['children'];
  return typeof text === 'string' ? text : '';
};

describe('useGameModel, Back and Home', () => {
  it('pauses on Back in play, and resumes on Back in Pause', async () => {
    const { pathname } = await openGame();

    await act(() => {
      router.back();
    });

    expect([pathname(), status()]).toStrictEqual(['/game/tally', 'paused']);

    await act(() => {
      router.back();
    });

    expect([pathname(), status()]).toStrictEqual(['/game/tally', 'playing']);
  });

  it('leaves a live run from Pause -> Home in one tap, saved but not reopened at launch', async () => {
    const { deps, pathname } = await openGame();
    await press((model) => model.onPause);
    await press((model) => model.onHome);

    expect(pathname()).toBe('/');
    expect(deps.runs.data().runs.get('tally')?.shouldResumeOnLaunch).toBe(false);
    expect(deps.runs.data().runEnds).toHaveLength(0);
  });

  it('records a pending loss and leaves on one Home tap', async () => {
    const { deps, host, pathname } = await openGame();
    await act(() => {
      host.debugControls().endActiveRun('lose');
    });

    expect(deps.runs.data().runEnds).toHaveLength(0);

    await press((model) => model.onHome);

    expect(pathname()).toBe('/');
    expect(deps.runs.data().runEnds).toHaveLength(1);
  });

  it('finishes a pending loss on Back, and leaves on the next Back', async () => {
    const { deps, host, pathname } = await openGame();
    await act(() => {
      host.debugControls().endActiveRun('lose');
    });
    await act(() => {
      router.back();
    });

    expect([pathname(), deps.runs.data().runEnds.length]).toStrictEqual(['/game/tally', 1]);

    await act(() => {
      router.back();
    });

    expect(pathname()).toBe('/');
  });

  it('lets Back leave a recorded run', async () => {
    const { deps, host, pathname } = await openGame();
    await act(() => {
      host.debugControls().endActiveRun('win');
    });
    await act(() => {
      router.back();
    });

    expect([pathname(), deps.runs.data().runEnds.length]).toStrictEqual(['/', 1]);
  });

  it('guards a stack reset on a live run: it pauses instead of leaving', async () => {
    const { pathname } = await openGame();

    await act(() => {
      router.dismissTo('/');
    });

    expect([pathname(), status()]).toStrictEqual(['/game/tally', 'paused']);
  });
});
