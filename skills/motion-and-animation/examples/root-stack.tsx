// src/features/root-navigator/root-stack.tsx
// Example (a shape to imitate): the providers above the root Stack. MotionConfig (accessibility-as-
// code) gives useReduceMotion() the in-app preference and sets Reanimated's global reduce-motion
// mode; pass the saved preference from settings-and-preferences, or "system" until the app has the
// setting. This component only mounts providers and reads nothing: React context flows down only,
// so a useScreenAnimation() or useReduceMotion() call here would read the context from ABOVE
// MotionConfig (the 'system' default) and ignore the preference passed to it. The Stack that reads
// the answer is AppStack (examples/app-stack.tsx), rendered below; check-motion's
// reduce-motion-root flags a component that both mounts MotionConfig and calls either hook.
import { AppStack } from '@/features/root-navigator/app-stack';
import { NavigationThemeProvider } from '@/theme/navigation-theme';
import { MotionConfig } from '@/ui/a11y/motion-config';

import type { ReduceMotionPreference } from '@/ui/a11y/use-reduce-motion';

type RootStackProps = {
  /** The saved "Reduce motion" choice (settings-and-preferences), or 'system'. */
  readonly reduceMotion: ReduceMotionPreference;
};

export function RootStack({ reduceMotion }: RootStackProps): React.JSX.Element {
  return (
    <MotionConfig preference={reduceMotion}>
      <NavigationThemeProvider>
        <AppStack />
      </NavigationThemeProvider>
    </MotionConfig>
  );
}
