// src/ui/stat-grid.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const GRID = COMPONENT_SPECS.statGrid;
/** Keys of the empty cells that keep a short last row's column widths (at most two). */
const FILLERS = ['filler-a', 'filler-b'] as const;

export type Stat = {
  /** A stable key: the cell is `<testID>.<id>`. */
  readonly id: string;
  /** Formatted by the screen model in the app's digits ("1,284"). */
  readonly value: string;
  /** Translated ("Tasks done"). */
  readonly label: string;
};

export type StatGridProps = {
  readonly stats: readonly Stat[];
  readonly testID: string;
  /** Default 2. */
  readonly columns?: 2 | 3;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    grid: { alignSelf: 'stretch', gap: GRID.gap },
    row: { flexDirection: 'row', gap: GRID.gap },
    // Equal widths along the row's own axis; an empty cell keeps the column width.
    cell: {
      flex: 1,
      gap: GRID.cellGap,
      padding: GRID.cellPadding,
      borderRadius: GRID.radius,
      backgroundColor: theme.colors.sunken,
    },
    empty: { flex: 1 },
  });
  return styles;
});

type Styles = ReturnType<typeof useStyles>;

function rowsOf(stats: readonly Stat[], columns: number): readonly (readonly Stat[])[] {
  const rows: Stat[][] = [];
  for (const stat of stats) {
    const last = rows.at(-1);
    if (last === undefined || last.length === columns) rows.push([stat]);
    else last.push(stat);
  }
  return rows;
}

function cell(stat: Stat, testID: string, styles: Styles): ReactNode {
  const id = `${testID}.${stat.id}`;
  // One accessible element per cell: a screen reader hears "1,284, Tasks done" together.
  return (
    <View key={stat.id} style={styles.cell} accessible testID={id}>
      <AppText variant="statValue" testID={`${id}.value`}>
        {stat.value}
      </AppText>
      <AppText variant="statLabel" tone="muted" testID={`${id}.label`}>
        {stat.label}
      </AppText>
    </View>
  );
}

/** A grid of summary numbers with their labels. */
export function StatGrid({ stats, testID, columns = 2 }: StatGridProps): ReactNode {
  const styles = useStyles();
  return (
    <View style={styles.grid} testID={testID}>
      {rowsOf(stats, columns).map((row) => (
        <View key={row.map((stat) => stat.id).join('+')} style={styles.row}>
          {row.map((stat) => cell(stat, testID, styles))}
          {FILLERS.slice(0, columns - row.length).map((key) => (
            <View key={key} style={styles.empty} />
          ))}
        </View>
      ))}
    </View>
  );
}
