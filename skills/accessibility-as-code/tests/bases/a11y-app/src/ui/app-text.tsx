// src/ui/app-text.tsx
import { Text } from 'react-native';

import type { ReactNode } from 'react';

export type AppTextProps = {
  /** Always the output of t() or a formatter, never a literal. */
  readonly text: string;
  /** BCP 47 tag, only for text in another language than the UI (a language picker). */
  readonly language?: string;
  readonly isHeader?: boolean;
};

/** The only component that renders Text: it caps growth at 2x and never turns scaling off. */
export function AppText(props: AppTextProps): ReactNode {
  return (
    <Text
      maxFontSizeMultiplier={2}
      {...(props.language === undefined ? {} : { accessibilityLanguage: props.language })}
      {...(props.isHeader === true ? { accessibilityRole: 'header' as const } : {})}
    >
      {props.text}
    </Text>
  );
}
