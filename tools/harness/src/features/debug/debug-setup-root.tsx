// src/features/debug/debug-setup-root.tsx: the debug-link route's content. The route cannot call a
// test-only model hook itself (only the entry may import this folder), so this component joins the
// model and the view, and the route renders it as TEST_ONLY?.DebugSetupRoot.
import { DebugSetupScreen } from './debug-setup-screen';
import { useDebugSetupModel } from './use-debug-setup-model';

import type { DebugLinkParams } from './debug-links';

export type DebugSetupRootProps = {
  /** The link's search params, as useLocalSearchParams() returns them. */
  readonly params: DebugLinkParams;
};

export function DebugSetupRoot({ params }: DebugSetupRootProps): React.JSX.Element {
  const model = useDebugSetupModel(params);
  return <DebugSetupScreen label={model.label} isFailed={model.isFailed} />;
}
