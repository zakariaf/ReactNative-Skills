// src/app/index.tsx: the first route of a new app. Route files stay thin: they render a screen from
// src/features/. The first real feature (scaffold-feature-screen) replaces this route and its screen.
import { HomeScreen } from '@/features/home/home-screen';

export default function HomeRoute(): React.JSX.Element {
  return <HomeScreen />;
}
