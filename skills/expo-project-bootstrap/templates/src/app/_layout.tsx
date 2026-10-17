// src/app/_layout.tsx: the starter root layout of a new app. Expo Router reads its default export.
// device-only: covered by the app launch on a simulator or emulator (it only renders the router's Stack)
// The bootstrap writes this one Stack and nothing else, so every gate is green on day one. Screens do
// not animate yet: the screen transition arrives with motion-and-animation's moment catalog, which
// answers Reduce Motion. app-startup-and-bootstrap replaces the whole file with the canonical root
// skeleton (error net, splash hold, providers, startup gate) when the app gains its first service,
// store or catalog; grow it there, never here.
import { Stack } from 'expo-router';

export default function RootLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false, animation: 'none' }} />;
}
