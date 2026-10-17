// src/ui/list-row.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { Chevron } from './chevron';
import { COMPONENT_SPECS } from './component-specs';
import { IconTile } from './icon-tile';
import { PressableSurface } from './pressable-surface';
import { RadioMark } from './radio-mark';
import { Toggle } from './toggle';

import type { IconSlot } from './icon-slot';
import type { ReactNode } from 'react';
import type { AccessibilityRole, StyleProp, ViewStyle } from 'react-native';

const ROW = COMPONENT_SPECS.row;

/** What the row does: opens a page, switches a setting, picks one of several, or only shows. */
export type ListRowKind = 'navigate' | 'switch' | 'radio' | 'static';

export type ListRowProps = {
  /** Translated. */
  readonly label: string;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  /** Default 'static' (no press). Any other kind needs onPress. */
  readonly kind?: ListRowKind;
  readonly onPress?: () => void;
  readonly description?: string;
  /** A muted value at the end ("System", "3 lists"). */
  readonly value?: string;
  /** An icon on a tile at the start (`<testID>.icon`). */
  readonly icon?: IconSlot;
  /** kind 'switch'. */
  readonly isOn?: boolean;
  /** kind 'radio'. */
  readonly isSelected?: boolean;
  /** A destructive row (Delete all tasks): danger label and icon tile. */
  readonly isDanger?: boolean;
  /** The first row of a list draws no separator. */
  readonly isFirst?: boolean;
  /** A full-width line under the label (a segmented control). */
  readonly below?: ReactNode;
  /** The label's own language when it is not the UI's (an autonym). */
  readonly labelLanguage?: string;
  /** Translated sentence when the row must be heard as more than its label (label and value). */
  readonly a11yLabel?: string;
  readonly hint?: string;
};

const ROLE: Readonly<Record<Exclude<ListRowKind, 'static'>, AccessibilityRole>> = {
  navigate: 'button',
  switch: 'switch',
  radio: 'radio',
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    row: {
      minHeight: ROW.minHeight,
      paddingBlock: ROW.paddingBlock,
      paddingInline: ROW.paddingInline,
      gap: ROW.gap,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      // A wrapping row centres a single line of parts only with alignContent: Yoga's default
      // (flex-start) puts it at the top of the row, where CSS would centre it.
      alignContent: 'center',
      justifyContent: 'flex-start',
    },
    separated: { borderTopWidth: ROW.separator, borderTopColor: theme.colors.separator },
    text: { flex: 1, gap: ROW.labelGap },
    below: { flexBasis: '100%' },
    block: { alignSelf: 'stretch' },
  });
  return styles;
});

type Styles = ReturnType<typeof useStyles>;

function endSlot(props: ListRowProps, color: string): ReactNode {
  switch (props.kind ?? 'static') {
    case 'navigate':
      return <Chevron color={color} />;
    case 'switch':
      return (
        <Toggle
          isOn={props.isOn === true}
          isReducedMotion={props.isReducedMotion}
          testID={`${props.testID}.toggle`}
        />
      );
    case 'radio':
      return <RadioMark isSelected={props.isSelected === true} testID={`${props.testID}.radio`} />;
    case 'static':
      return null;
  }
}

function textColumn(props: ListRowProps, styles: Styles): ReactNode {
  return (
    <View style={styles.text}>
      <AppText
        variant={props.isDanger === true ? 'rowLabelStrong' : 'rowLabel'}
        tone={props.isDanger === true ? 'danger' : 'default'}
        testID={`${props.testID}.label`}
        {...(props.labelLanguage === undefined ? {} : { language: props.labelLanguage })}
      >
        {props.label}
      </AppText>
      {props.description === undefined ? null : (
        <AppText variant="rowDescription" tone="muted" testID={`${props.testID}.description`}>
          {props.description}
        </AppText>
      )}
    </View>
  );
}

function rowContent(props: ListRowProps, styles: Styles, muted: string): ReactNode {
  const { icon } = props;
  return (
    <>
      {icon === undefined ? null : (
        <IconTile
          icon={icon}
          paint={props.isDanger === true ? 'danger' : 'neutral'}
          testID={`${props.testID}.icon`}
        />
      )}
      {textColumn(props, styles)}
      {props.value === undefined ? null : (
        <AppText variant="rowLabel" tone="muted" align="end" testID={`${props.testID}.value`}>
          {props.value}
        </AppText>
      )}
      {endSlot(props, muted)}
      {props.below === undefined ? null : <View style={styles.below}>{props.below}</View>}
    </>
  );
}

/**
 * One row of a list; the whole row is the target (button, switch or radio), its parts derive their
 * ids from the row's. A static row is a plain View with the same layout.
 */
export function ListRow(props: ListRowProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const face: StyleProp<ViewStyle> = [styles.row, props.isFirst !== true && styles.separated];
  const content = rowContent(props, styles, theme.colors.textMuted);
  const { onPress } = props;
  const kind = props.kind ?? 'static';
  if (kind === 'static' || onPress === undefined) {
    return (
      <View style={face} testID={props.testID}>
        {content}
      </View>
    );
  }
  return (
    <PressableSurface
      label={props.a11yLabel ?? props.label}
      onPress={onPress}
      testID={props.testID}
      accessibilityRole={ROLE[kind]}
      {...(kind === 'switch' ? { isChecked: props.isOn === true } : {})}
      {...(kind === 'radio' ? { isSelected: props.isSelected === true } : {})}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      radius={0}
      fill={theme.colors.surface}
      edgeWidth={0}
      isReducedMotion={props.isReducedMotion}
      faceStyle={face}
      layoutStyle={styles.block}
    >
      {content}
    </PressableSurface>
  );
}
