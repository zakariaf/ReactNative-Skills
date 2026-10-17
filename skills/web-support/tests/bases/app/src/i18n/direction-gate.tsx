// src/i18n/direction-gate.tsx
// Stand-in for rtl-and-direction's gate: it reads the guard on its first render, then renders the app.
import { useState } from 'react';

import { readLayoutDirection } from './direction';

import type { DirectionGuardPort } from '@/services/direction-guard/direction-guard-port';
import type { ReactNode } from 'react';

export function DirectionGate(props: { readonly guard: DirectionGuardPort; readonly children: ReactNode }): ReactNode {
  const [pending] = useState(() => props.guard.readPending());
  return pending === readLayoutDirection() || pending === null ? props.children : null;
}
