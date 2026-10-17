// src/app/_layout.tsx: the root layout (fixture): AppRoot creates the session and renders RootStack.
import { AppRoot } from '@/features/root-navigator/app-root';

export default function RootLayout(): React.JSX.Element {
  return <AppRoot />;
}
