// src/features/root-navigator/root-kits.test.tsx
// no-providers: RootKits only composes the kits it is given; the cases render it with stand-in kits
// whose provider and effect components are plain React, so no app provider is involved.
import { render, screen } from '@testing-library/react-native';
import { createContext, use, useEffect } from 'react';
import { View } from 'react-native';

import { RootKits } from './root-kits';

import type { RootKit } from '@/services/root-kits/root-kit';
import type { ReactNode } from 'react';

const Trail = createContext<readonly string[]>([]);

/** A kit whose provider adds its name to the trail and whose effect reports the trail it sees. */
function tracingKit(name: string, seen: Map<string, readonly string[]>): RootKit {
  function Effect(): null {
    const trail = use(Trail);
    useEffect(() => {
      seen.set(name, trail);
    }, [trail]);
    return null;
  }
  return {
    name,
    provide: (children: ReactNode) => <TrailStep name={name}>{children}</TrailStep>,
    effects: <Effect />,
  };
}

function TrailStep({ name, children }: { readonly name: string; readonly children: ReactNode }) {
  const outer = use(Trail);
  return <Trail value={[...outer, name]}>{children}</Trail>;
}

describe('RootKits', () => {
  it('renders the Stack alone when the app has no kits', async () => {
    await render(
      <RootKits kits={[]}>
        <View testID="root.stack" />
      </RootKits>,
    );
    expect(screen.getByTestId('root.stack')).toBeOnTheScreen();
  });

  it('nests the providers in registry order, around the Stack and every effect', async () => {
    const seen = new Map<string, readonly string[]>();
    const kits = [tracingKit('crash', seen), { name: 'quiet' }, tracingKit('push', seen)];
    await render(
      <RootKits kits={kits}>
        <View testID="root.stack" />
      </RootKits>,
    );
    expect(screen.getByTestId('root.stack')).toBeOnTheScreen();
    expect(seen.get('crash')).toStrictEqual(['crash', 'push']);
    expect(seen.get('push')).toStrictEqual(['crash', 'push']);
  });

  it('mounts each kit effect once', async () => {
    const mounts: string[] = [];
    function Once(): null {
      useEffect(() => {
        mounts.push('mounted');
      }, []);
      return null;
    }
    await render(
      <RootKits kits={[{ name: 'analytics', effects: <Once /> }]}>
        <View testID="root.stack" />
      </RootKits>,
    );
    expect(mounts).toStrictEqual(['mounted']);
  });
});
