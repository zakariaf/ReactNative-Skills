// src/features/debug/debug-menu-root.tsx: the debug menu route's content (rendered as
// TEST_ONLY?.DebugMenuRoot): joins the model and the view, because the route cannot import this
// test-only folder.
import { DebugMenuScreen } from './debug-menu-screen';
import { useDebugMenuModel } from './use-debug-menu-model';

export function DebugMenuRoot(): React.JSX.Element {
  const model = useDebugMenuModel();
  return (
    <DebugMenuScreen
      buildText={model.buildText}
      dayText={model.dayText}
      errorsText={model.errorsText}
      switches={model.switches}
      actions={model.actions}
      isReducedMotion={model.isReducedMotion}
    />
  );
}
