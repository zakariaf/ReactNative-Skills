// src/ui/callout.tsx
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { Card } from './card';
import { COMPONENT_SPECS } from './component-specs';

import type { IconSlot } from './icon-slot';
import type { ReactNode } from 'react';

const CALLOUT = COMPONENT_SPECS.callout;

export type CalloutProps = {
  readonly icon: IconSlot;
  /** Translated note. */
  readonly text: string;
  readonly testID: string;
  /** An error note: danger edge and tint, danger icon. */
  readonly isError?: boolean;
  /** Bold text (a pending or blocking state). */
  readonly isStrong?: boolean;
};

const styles = StyleSheet.create({
  // The icon sits at the top, nudged to line up with the first line of text, not centred on a
  // paragraph (a centred icon drifts down as the note wraps).
  icon: { alignSelf: 'flex-start', marginTop: CALLOUT.iconNudge },
  wrapped: { flex: 1 },
  // A note that fits on one line is as wide as its text, so a right-to-left line starts at its
  // first word, not at the far end of the card.
  oneLine: { flexShrink: 1 },
});

/** A card laid out as a row: an icon at the top start and a note beside it. */
export function Callout(props: CalloutProps): ReactNode {
  const theme = useTheme();
  const isError = props.isError === true;
  const [oneLineText, setOneLineText] = useState<string | null>(null);
  const handleLineCount = (lines: number): void => {
    setOneLineText(lines === 1 ? props.text : null);
  };
  return (
    <Card testID={props.testID} tone={isError ? 'danger' : 'default'} isRow>
      <View style={styles.icon} testID={`${props.testID}.icon`}>
        {props.icon({
          size: CALLOUT.icon,
          color: isError ? theme.colors.danger : theme.colors.text,
        })}
      </View>
      <View style={oneLineText === props.text ? styles.oneLine : styles.wrapped}>
        <AppText
          variant={props.isStrong === true ? 'rowLabelStrong' : 'body'}
          onLineCount={handleLineCount}
          testID={`${props.testID}.label`}
        >
          {props.text}
        </AppText>
      </View>
    </Card>
  );
}
