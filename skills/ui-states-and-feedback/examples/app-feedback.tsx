// src/features/root-navigator/app-feedback.tsx (example: mounting the one feedback host)
// Rendered by root-stack.tsx around <AppStack />, inside MotionConfig and the navigation theme:
//   <NavigationThemeProvider>
//     <AppFeedback>
//       <AppStack />
//     </AppFeedback>
//   </NavigationThemeProvider>
// Below MotionConfig, so useReduceMotion() reads the app's answer; below the i18n provider, so t()
// works; Expo Router's root already provides the safe-area insets. One host for the whole app: a
// notice survives a navigation, and two screens can never show two notices at once.
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n/t-context';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';
import { feedbackCopyOf } from '@/ui/feedback/feedback-copy';
import { FeedbackProvider } from '@/ui/feedback/feedback-provider';

import type { ReactNode } from 'react';

export function AppFeedback({ children }: { readonly children: ReactNode }): ReactNode {
  const t = useT();
  const insets = useSafeAreaInsets();
  const isReducedMotion = useReduceMotion();
  return (
    <FeedbackProvider
      dismissLabel={feedbackCopyOf(t).dismissLabel}
      bottomInset={insets.bottom}
      isReducedMotion={isReducedMotion}
    >
      {children}
    </FeedbackProvider>
  );
}
