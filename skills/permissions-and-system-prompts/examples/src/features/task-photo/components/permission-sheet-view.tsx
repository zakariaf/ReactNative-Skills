// src/features/task-photo/components/permission-sheet-view.tsx
// The app's own permission sheets, as a pure view of the gate's sheet. Render it inside the app's
// dialog or bottom-sheet component (ui-component-library). The explain sheet has exactly one button,
// "Continue", which opens the system dialog: no "Allow" wording, no close or cancel (Apple's Human
// Interface Guidelines for pre-alert screens). Android's rationale adds "No thanks" (Android's
// guidance: never block the person). The settings sheet says the feature is off and opens the
// Settings app. The unavailable sheet says the device cannot do it (no camera, or the state could
// not be read) and only closes. No incentive, no picture of the system alert, no arrow pointing at
// its buttons.
import { StyleSheet, View } from 'react-native';

import { T } from '@/i18n/t';
import { useT } from '@/i18n/t-context';
import { makeStyles } from '@/theme/make-styles';
import { RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { PressableSurface } from '@/ui/pressable-surface';

import type { PermissionSheet } from '@/hooks/use-permission-gate';
import type { MessageKey } from '@/i18n/messages';

/** The catalog keys of one permission's sheets (the same keys contracts/permissions.json names). */
export type PermissionSheetCopy = {
  readonly explain: {
    readonly title: MessageKey;
    readonly body: MessageKey;
    readonly continue: MessageKey;
    readonly dismiss: MessageKey;
  };
  readonly settings: {
    readonly title: MessageKey;
    readonly body: MessageKey;
    readonly open: MessageKey;
    readonly dismiss: MessageKey;
  };
  readonly unavailable: {
    readonly title: MessageKey;
    readonly body: MessageKey;
    readonly dismiss: MessageKey;
  };
};

export type PermissionSheetViewProps = {
  readonly sheet: PermissionSheet;
  readonly copy: PermissionSheetCopy;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  readonly onContinue: () => void;
  readonly onDismiss: () => void;
  readonly onOpenSettings: () => void;
};

type SheetButton = {
  readonly label: MessageKey;
  readonly onPress: () => void;
  readonly id: string;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    sheet: { gap: SPACING.md, padding: SPACING.lg },
    face: { paddingBlock: SPACING.md, paddingInline: SPACING.lg },
  });
  return styles;
});

function buttonsOf(props: PermissionSheetViewProps): readonly SheetButton[] {
  const { copy } = props;
  const dismiss = (label: MessageKey): SheetButton => ({
    label,
    onPress: props.onDismiss,
    id: 'dismiss',
  });
  if (props.sheet === 'explain')
    return [{ label: copy.explain.continue, onPress: props.onContinue, id: 'continue' }];
  if (props.sheet === 'rationale') {
    return [
      { label: copy.explain.continue, onPress: props.onContinue, id: 'continue' },
      dismiss(copy.explain.dismiss),
    ];
  }
  if (props.sheet === 'settings') {
    return [
      { label: copy.settings.open, onPress: props.onOpenSettings, id: 'open-settings' },
      dismiss(copy.settings.dismiss),
    ];
  }
  return [dismiss(copy.unavailable.dismiss)];
}

type SheetText = { readonly title: MessageKey; readonly body: MessageKey };

function textOf(props: PermissionSheetViewProps): SheetText {
  if (props.sheet === 'settings') return props.copy.settings;
  if (props.sheet === 'unavailable') return props.copy.unavailable;
  return props.copy.explain;
}

export function PermissionSheetView(props: PermissionSheetViewProps): React.JSX.Element | null {
  const styles = useStyles();
  const theme = useTheme();
  const t = useT();
  if (props.sheet === null) return null;
  const text = textOf(props);
  return (
    <View testID={props.testID} style={styles.sheet}>
      <T id={text.title} variant="heading" isHeader />
      <T id={text.body} />
      {buttonsOf(props).map((button) => (
        <PressableSurface
          key={button.id}
          label={t(button.label)}
          onPress={button.onPress}
          testID={`${props.testID}.${button.id}`}
          radius={RADII.md}
          fill={theme.colors.surface}
          isReducedMotion={props.isReducedMotion}
          faceStyle={styles.face}
        >
          <T id={button.label} />
        </PressableSurface>
      ))}
    </View>
  );
}
