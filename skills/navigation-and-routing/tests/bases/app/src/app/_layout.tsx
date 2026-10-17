// src/app/_layout.tsx: the root layout. The navigator is rendered two components down (AppRoot -> RootStack -> AppStack).
import { AppRoot } from '@/features/root-navigator/app-root';

export default function RootLayout(): React.JSX.Element {
  return <AppRoot />;
}
