// src/features/root-navigator/root-kits.tsx
// The root stack's kit slot (app-startup-and-bootstrap): the innermost wrapper around AppStack. Each
// kit's provider wraps the Stack and every kit's effects, the first kit of the registry outermost,
// and each kit's effect components are mounted once beside the Stack. It renders below the held
// splash's release and inside every app provider, so an effect may read the theme, the language, the
// settings and the router, and a tap router navigates only once the navigator exists. With no kits it
// renders its children and nothing else.
import { Fragment } from 'react';

import type { RootKit } from '@/services/root-kits/root-kit';
import type { JSX, ReactNode } from 'react';

export type RootKitsProps = {
  /** The kits startApp created, in registry order. */
  readonly kits: readonly RootKit[];
  /** The root Stack. */
  readonly children: ReactNode;
};

/** Mounts every kit's provider and effects around the root Stack. */
export function RootKits({ kits, children }: RootKitsProps): JSX.Element {
  const withEffects = (
    <>
      {children}
      {kits.map((kit) => (
        <Fragment key={kit.name}>{kit.effects}</Fragment>
      ))}
    </>
  );
  const tree = kits.reduceRight<ReactNode>(
    (inner, kit) => (kit.provide ? kit.provide(inner) : inner),
    withEffects,
  );
  return <>{tree}</>;
}
