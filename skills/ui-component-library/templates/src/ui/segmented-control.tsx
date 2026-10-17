// src/ui/segmented-control.tsx
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { CheckMark } from './check-mark';
import { COMPONENT_SPECS } from './component-specs';
import { PressableSurface } from './pressable-surface';

import type { Theme } from '@/theme/theme-types';
import type { ReactNode } from 'react';

const SEGMENTED = COMPONENT_SPECS.segmentedControl;

export type Segment<TValue extends string> = {
  /** Also the segment's id segment: `<testID>.<value>`, a stable key, never a position. */
  readonly value: TValue;
  /** Translated ("System", "Light", "Dark"). */
  readonly label: string;
};

export type SegmentedControlProps<TValue extends string> = {
  readonly segments: readonly Segment<TValue>[];
  readonly selected: TValue;
  readonly onSelect: (value: TValue) => void;
  /** Translated name of the group ("Theme"). */
  readonly label: string;
  /**
   * The group's id (`settings.theme-control`); segments are `<testID>.<value>`, each with
   * `<testID>.<value>.label` and, on the chosen one, `<testID>.<value>.check`.
   */
  readonly testID: string;
  readonly isReducedMotion: boolean;
};

const styles = StyleSheet.create({
  group: { flexDirection: 'row', gap: SEGMENTED.gap, alignSelf: 'stretch' },
  // Equal widths along the row's own axis, which has a definite size here.
  cell: { flex: 1 },
  face: {
    minHeight: SEGMENTED.minHeight,
    minWidth: 0,
    paddingBlock: SEGMENTED.paddingBlock,
    paddingInline: SEGMENTED.paddingInline,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: SEGMENTED.labelGap,
  },
});

type SegmentPaint = { readonly fill: string; readonly edge: string; readonly ink: string };

function paintOf(theme: Theme, isSelected: boolean): SegmentPaint {
  const { colors } = theme;
  return isSelected
    ? { fill: colors.primary, edge: colors.primary, ink: colors.onPrimary }
    : { fill: colors.surface, edge: colors.border, ink: colors.text };
}

/** Equal segments, one always chosen; the chosen one is filled and carries a check. */
export function SegmentedControl<TValue extends string>(
  props: SegmentedControlProps<TValue>,
): ReactNode {
  const theme = useTheme();
  return (
    <View
      style={styles.group}
      accessibilityRole="radiogroup"
      accessibilityLabel={props.label}
      testID={props.testID}
    >
      {props.segments.map((segment) => {
        const id = `${props.testID}.${segment.value}`;
        const isSelected = segment.value === props.selected;
        const paint = paintOf(theme, isSelected);
        return (
          <PressableSurface
            key={segment.value}
            label={segment.label}
            onPress={() => {
              props.onSelect(segment.value);
            }}
            testID={id}
            accessibilityRole="radio"
            isSelected={isSelected}
            radius={SEGMENTED.radius}
            fill={paint.fill}
            edgeColor={paint.edge}
            edgeWidth={SEGMENTED.border}
            isReducedMotion={props.isReducedMotion}
            faceStyle={styles.face}
            layoutStyle={styles.cell}
          >
            {isSelected ? <CheckMark color={paint.ink} testID={`${id}.check`} /> : null}
            <AppText
              variant="buttonLabel"
              tone={isSelected ? 'onPrimary' : 'default'}
              align="center"
              testID={`${id}.label`}
            >
              {segment.label}
            </AppText>
          </PressableSurface>
        );
      })}
    </View>
  );
}
