// src/features/debug/parity-launch-screen.tsx
import { ParityLaunchRoot } from '@/features/parity/parity-launch-root';

import type { ParityAppliers } from '@/features/parity/parity-launch';
import type { ParityLaunchParams } from '@/features/parity/parity-request';
import type { ReactNode } from 'react';

const APPLIERS: ParityAppliers = {
  consent: () => Promise.resolve(),
  overrides: () => Promise.resolve(),
  data: () => Promise.resolve(),
  settings: () => Promise.resolve('applied'),
};

export function ParityLaunchScreen(props: {
  readonly params: ParityLaunchParams;
  readonly navigate: (href: string) => void;
}): ReactNode {
  return <ParityLaunchRoot params={props.params} appliers={APPLIERS} navigate={props.navigate} />;
}
