// src/features/onboarding/onboarding-screen.tsx: a short list that can never grow keeps its
// ScrollView and says why. No header and no tab bar around it, so every edge.
import { ScrollView } from 'react-native';

import { AppText } from '@/ui/app-text';
import { ALL_EDGES, ScreenFrame } from '@/ui/screen-frame';

import type { ReactNode } from 'react';

export type OnboardingStep = { readonly id: string; readonly text: string };

export type OnboardingScreenProps = { readonly steps: readonly OnboardingStep[] };

export function OnboardingScreen({ steps }: OnboardingScreenProps): ReactNode {
  return (
    <ScreenFrame testID="onboarding.screen" edges={ALL_EDGES}>
      {/* bounded-list: the onboarding has three to five steps, fixed at build time */}
      <ScrollView testID="onboarding.steps">
        {steps.map((step) => (
          <AppText key={step.id} testID={`onboarding.step.${step.id}`}>
            {step.text}
          </AppText>
        ))}
      </ScrollView>
    </ScreenFrame>
  );
}
