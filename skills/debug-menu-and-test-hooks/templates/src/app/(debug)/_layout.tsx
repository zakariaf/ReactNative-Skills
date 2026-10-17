// src/app/(debug)/_layout.tsx: the test-build group (the debug menu and the debug link). Production
// never reaches it: the root Stack lists the group inside Stack.Protected guard={TEST_ONLY !== null}
// (navigation-and-routing), and each leaf route redirects home when TEST_ONLY is null, so this layout
// switches no flow and holds no Redirect of its own (navigation-and-routing's flow-by-guard). A Slot,
// not a Stack: the link screen replaces itself, so the group needs no history of its own.
import { Slot } from 'expo-router';

export default function DebugLayout(): React.JSX.Element {
  return <Slot />;
}
