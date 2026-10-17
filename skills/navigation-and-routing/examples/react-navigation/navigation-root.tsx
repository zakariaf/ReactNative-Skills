// src/features/root-navigator/navigation-root.tsx (React Navigation static API): the only container.
// .with() wraps the static navigator in a component, so its screenOptions can call hooks (merged over
// the static ones): a cross-fade replaces the slide while motion is reduced. Direction: pass nothing
// (React Navigation reads I18nManager, the layout's own source; rtl-and-direction). The theme comes
// from the app theme (design-system-structure's toNavigationTheme), so pushes never flash white in dark.
import { createStaticNavigation } from '@react-navigation/native';

import { toNavigationTheme } from '@/theme/navigation-theme';
import { useTheme } from '@/theme/use-theme';
import { useScreenAnimation } from '@/ui/motion/use-screen-animation';

import { rootStack } from './root-stack';

import type { ReactNode } from 'react';

const motionAwareStack = rootStack.with(function MotionAwareStack({ Navigator }) {
  const animation = useScreenAnimation();
  return <Navigator screenOptions={{ animation }} />;
});

const Navigation = createStaticNavigation(motionAwareStack);

export function NavigationRoot(): ReactNode {
  const theme = useTheme();
  return <Navigation theme={toNavigationTheme(theme)} />;
}
