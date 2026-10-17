// src/i18n/t-bridge.tsx
import { useIntl } from 'react-intl';

import { createT } from './create-t';
import { TContext } from './t-context';

import type { ReactNode } from 'react';

export type TBridgeProps = {
  readonly onError: (error: Error) => void;
  readonly children: ReactNode;
};

/** Turns react-intl's IntlShape into the app's t() (the React Compiler memoizes it). */
export function TBridge({ onError, children }: TBridgeProps): React.JSX.Element {
  const intl = useIntl();
  return <TContext value={createT({ intl, onError })}>{children}</TContext>;
}
