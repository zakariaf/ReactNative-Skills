// src/ui/bar-chart.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const CHART = COMPONENT_SPECS.barChart;
const PERCENT = 100;

export type ChartBar = {
  /** A stable key (a date key, a weekday id): the column is `<testID>.<key>`. */
  readonly key: string;
  readonly value: number;
  /** Formatted in the app's digits ("12"). */
  readonly valueText: string;
  /** Translated axis label ("Mon"). */
  readonly label: string;
  /** Translated sentence a screen reader hears ("Monday: 12 tasks done"). */
  readonly a11yLabel: string;
};

export type BarChartProps = {
  readonly bars: readonly ChartBar[];
  /** The value of a full-height bar (at least the largest value). */
  readonly max: number;
  readonly testID: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    chart: { flexDirection: 'row', alignItems: 'flex-end', gap: CHART.gap, alignSelf: 'stretch' },
    column: { flex: 1, alignItems: 'center', gap: CHART.labelGap },
    plot: {
      height: CHART.height,
      alignSelf: 'stretch',
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    bar: {
      width: CHART.bar,
      minHeight: CHART.minBar,
      borderRadius: CHART.radius,
      backgroundColor: theme.colors.primary,
    },
  });
  return styles;
});

/**
 * Simple vertical bars. Each column is one labelled image (a chart stands in for text), so a screen
 * reader hears the sentence, never "12, Mon" in pieces.
 */
export function BarChart({ bars, max, testID }: BarChartProps): ReactNode {
  const styles = useStyles();
  const top = Math.max(max, ...bars.map((bar) => bar.value), 1);
  return (
    <View style={styles.chart} testID={testID}>
      {bars.map((bar) => {
        const id = `${testID}.${bar.key}`;
        return (
          <View
            key={bar.key}
            style={styles.column}
            accessible
            accessibilityRole="image"
            accessibilityLabel={bar.a11yLabel}
            testID={id}
          >
            <AppText variant="statLabel" tone="muted" testID={`${id}.value`}>
              {bar.valueText}
            </AppText>
            <View style={styles.plot}>
              <View
                style={[styles.bar, { height: `${String((bar.value / top) * PERCENT)}%` }]}
                testID={`${id}.bar`}
              />
            </View>
            <AppText variant="statLabel" tone="muted" testID={`${id}.label`}>
              {bar.label}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}
