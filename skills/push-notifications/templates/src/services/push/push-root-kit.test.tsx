// src/services/push/push-root-kit.test.tsx
import { act, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { AppState, View } from 'react-native';

import { TContext } from '@/i18n/t-context';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { createFakePush } from './fake-push';
import { usePushServices } from './push-context';
import { createPushKit, NO_PUSH_ACCOUNT } from './push-root-kit';

import type { PushRegistrationService } from './push-registration';
import type { PushAccountSource } from './push-root-kit';
import type { PushDestination } from '@/core/push/push-destination';
import type { TFunction } from '@/i18n/create-t';
import type { RootKit } from '@/services/root-kits/root-kit';

/** A registration that records its calls; the service's own logic has its own tests. */
function recordingRegistration(): PushRegistrationService & {
  readonly synced: readonly (string | null)[];
  readonly starts: () => number;
  readonly stops: () => number;
} {
  const synced: (string | null)[] = [];
  let starts = 0;
  let stops = 0;
  return {
    synced,
    starts: () => starts,
    stops: () => stops,
    sync: (accountId) => {
      synced.push(accountId);
      return Promise.resolve('none');
    },
    start: () => {
      starts += 1;
      return () => {
        stops += 1;
      };
    },
    unregister: () => Promise.resolve(),
  };
}

/** An account the test signs in, like the session store. */
function switchableAccount(): PushAccountSource & { readonly signIn: (id: string) => void } {
  let current: string | null = null;
  const listeners = new Set<() => void>();
  return {
    accountId: () => current,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    signIn: (id) => {
      current = id;
      for (const listener of listeners) listener();
    },
  };
}

/** The shown t(): each key as its own text (the kit only passes t on). */
const echoT: TFunction = (key) => key;

/** The root layout's part that matters here: t(), then the kit's provider around its effects. */
function layoutWith(kit: RootKit): () => React.JSX.Element {
  return function KitLayout(): React.JSX.Element {
    const tree = (
      <>
        <Slot />
        {kit.effects}
      </>
    );
    return <TContext value={echoT}>{kit.provide ? kit.provide(tree) : tree}</TContext>;
  };
}

function Home(): React.JSX.Element {
  return <View testID="tasks.screen" />;
}

function ListScreen(): React.JSX.Element {
  return <View testID="list.screen" />;
}

const hrefForDestination = (destination: PushDestination) =>
  destination.screen === 'list'
    ? ({ pathname: '/lists/[listId]', params: { listId: destination.listId } } as const)
    : ('/' as const);

describe('createPushKit', () => {
  // The app is in the foreground, so the syncs run on mount (useIsAppActive reads AppState).
  beforeEach(() => {
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  });

  it('names the channels, syncs the registration and watches token rotation once mounted', async () => {
    const push = createFakePush();
    const registration = recordingRegistration();
    const kit = createPushKit({
      push,
      registration,
      errorLog: createFakeErrorLog(),
      account: NO_PUSH_ACCOUNT,
      openSettings: () => Promise.resolve(),
      hrefForDestination,
    });
    await renderRouterWithProviders({ _layout: layoutWith(kit), index: Home });
    await waitFor(() => {
      expect(registration.synced).toStrictEqual([null]);
    });
    expect(push.channels().length).toBeGreaterThan(0);
    expect(registration.starts()).toBe(1);
    await screen.unmount();
    expect(registration.stops()).toBe(1);
  });

  it('opens the screen of the push whose tap launched the app', async () => {
    const push = createFakePush({
      lastResponse: { id: 'n1', action: 'open', data: { kind: 'list-shared', listId: 'l1' } },
    });
    const kit = createPushKit({
      push,
      registration: recordingRegistration(),
      errorLog: createFakeErrorLog(),
      account: NO_PUSH_ACCOUNT,
      openSettings: () => Promise.resolve(),
      hrefForDestination,
    });
    const view = await renderRouterWithProviders({
      _layout: layoutWith(kit),
      index: Home,
      'lists/[listId]': ListScreen,
    });
    expect(view.getPathname()).toBe('/lists/l1');
  });

  it('registers again for a newly signed-in account', async () => {
    const registration = recordingRegistration();
    const account = switchableAccount();
    const kit = createPushKit({
      push: createFakePush(),
      registration,
      errorLog: createFakeErrorLog(),
      account,
      openSettings: () => Promise.resolve(),
      hrefForDestination,
    });
    await renderRouterWithProviders({ _layout: layoutWith(kit), index: Home });
    await act(() => {
      account.signIn('account-1');
    });
    await waitFor(() => {
      expect(registration.synced).toStrictEqual([null, 'account-1']);
    });
  });

  it('hands the in-context ask the port, the registration and the way to Settings', async () => {
    const push = createFakePush();
    const registration = recordingRegistration();
    const openSettings = (): Promise<void> => Promise.resolve();
    const kit = createPushKit({
      push,
      registration,
      errorLog: createFakeErrorLog(),
      account: NO_PUSH_ACCOUNT,
      openSettings,
      hrefForDestination,
    });
    function Screen(): React.JSX.Element {
      const provided = usePushServices();
      const isKits =
        provided.push === push &&
        provided.registration === registration &&
        provided.openSettings === openSettings;
      return <View testID={isKits ? 'tasks.kit-services' : 'tasks.other-services'} />;
    }
    await renderRouterWithProviders({ _layout: layoutWith(kit), index: Screen });
    expect(screen.getByTestId('tasks.kit-services')).toBeOnTheScreen();
  });
});
