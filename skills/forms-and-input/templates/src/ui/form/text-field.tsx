// src/ui/form/text-field.tsx
// The one text field (forms-and-input): a visible label, the input, then the error, a progress
// note or a hint below it. Presentational: every string arrives translated, the model hook binds
// value, handlers, ref and error (useTextField), and the kind sets keyboard, autofill,
// capitalization and secure entry (field-kinds.ts). Screens render this, never a raw TextInput.
// The input's accessible name is the visible label, given the way each screen reader reads it:
// on iOS the input carries accessibilityLabel and the label view is hidden from VoiceOver (one
// element: "<label>, text field, <error or hint>"); on Android an EditText's contentDescription
// loses to its own text once something is typed, so the input points at the label view with
// accessibilityLabelledBy (AccessibilityNodeInfo.setLabeledBy) and the label stays visible to
// TalkBack. The error sits in a polite live region so TalkBack speaks it when it appears (iOS has
// no live regions: the model announces a refused submit). An error is never colour alone: a bold
// edge and a sentence carry it too. The typed text grows with the system setting up to 200 %,
// like AppText, and the box grows with it.
import { useId } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { MIN_TOUCH, RADII, SPACING, STROKE, TYPE_SCALE } from '@/theme/tokens';
import { MAX_FONT_SCALE, useTextStyle } from '@/theme/use-text-style';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';

import { FIELD_KINDS, inputPropsOf } from './field-kinds';
import { FieldNote, isShown } from './field-note';

import type { FieldKind } from './field-kinds';
import type { ComponentRef, Ref } from 'react';
import type {
  EnterKeyHintTypeOptions,
  SubmitBehavior,
  TextInputProps,
  TextStyle,
} from 'react-native';

/** What `ref` reaches: focus() for the focus chain and react-hook-form's setFocus. */
export type TextFieldRef = ComponentRef<typeof TextInput>;

export type TextFieldProps = {
  /** Parts: `.label`, `.input`, `.error`, `.status`, `.hint`. */
  readonly testID: string;
  /** Translated; always visible above the input and its accessible name. Never a placeholder. */
  readonly label: string;
  readonly kind: FieldKind;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly onBlur: () => void;
  /** Translated; replaces the hint while set. */
  readonly error?: string | null | undefined;
  /** Translated progress of an async check ("Checking…"); shown while there is no error. */
  readonly status?: string | null | undefined;
  /** Translated help that stays until an error replaces it. */
  readonly hint?: string | undefined;
  readonly enterKeyHint?: EnterKeyHintTypeOptions | undefined;
  readonly submitBehavior?: SubmitBehavior | undefined;
  readonly onSubmitEditing?: (() => void) | undefined;
  /** The schema's own bound, so typing stops where validation would refuse. */
  readonly maxLength?: number | undefined;
  readonly isDisabled?: boolean | undefined;
  readonly ref?: Ref<TextFieldRef> | undefined;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    field: { gap: SPACING.xs },
    input: {
      minHeight: MIN_TOUCH,
      paddingInline: SPACING.md,
      paddingBlock: SPACING.sm,
      borderRadius: RADII.md,
      borderWidth: STROKE.regular,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
    },
    lines: { minHeight: MIN_TOUCH * 3, textAlignVertical: 'top' },
    invalid: { borderWidth: STROKE.bold, borderColor: theme.colors.danger },
    disabled: { backgroundColor: theme.colors.sunken, color: theme.colors.textMuted },
  });
  return styles;
});

/** A single-line input with a line height sits off centre on iOS: only lines keep theirs. */
function withoutLineHeight(style: TextStyle): TextStyle {
  const { lineHeight, ...rest } = style;
  return rest;
}

/** The optional input props that are set (TextInput's optional props take no explicit undefined). */
function optionalInputProps(props: Omit<TextFieldProps, 'ref'>): Partial<TextInputProps> {
  const hint = isShown(props.error) ? props.error : props.hint;
  return {
    ...(hint === undefined ? {} : { accessibilityHint: hint }),
    ...(props.enterKeyHint === undefined ? {} : { enterKeyHint: props.enterKeyHint }),
    ...(props.submitBehavior === undefined ? {} : { submitBehavior: props.submitBehavior }),
    ...(props.onSubmitEditing === undefined ? {} : { onSubmitEditing: props.onSubmitEditing }),
    ...(props.maxLength === undefined ? {} : { maxLength: props.maxLength }),
  };
}

export function TextField({ ref, ...props }: TextFieldProps): React.JSX.Element {
  const styles = useStyles();
  const theme = useTheme();
  const textStyle = useTextStyle({ style: TYPE_SCALE.body, align: 'start' });
  const isMultiline = FIELD_KINDS[props.kind].isMultiline;
  const isInvalid = isShown(props.error);
  const isDisabled = props.isDisabled === true;
  const labelId = useId();
  return (
    <View style={styles.field} testID={props.testID}>
      {/* Hidden from VoiceOver only (an iOS prop): TalkBack reads the label the input points at. */}
      <View
        nativeID={labelId}
        accessible
        accessibilityLabel={props.label}
        accessibilityElementsHidden
      >
        <AppText testID={`${props.testID}.label`} variant="label">
          {props.label}
        </AppText>
      </View>
      <TextInput
        ref={ref ?? null}
        testID={`${props.testID}.input`}
        {...inputPropsOf(props.kind)}
        {...optionalInputProps(props)}
        accessibilityLabel={Platform.OS === 'android' ? undefined : props.label}
        accessibilityLabelledBy={labelId}
        accessibilityState={{ disabled: isDisabled }}
        value={props.value}
        onChangeText={props.onChangeText}
        onBlur={props.onBlur}
        editable={!isDisabled}
        selectionColor={theme.colors.primary}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[
          isMultiline ? textStyle : withoutLineHeight(textStyle),
          styles.input,
          isMultiline && styles.lines,
          isInvalid && styles.invalid,
          isDisabled && styles.disabled,
        ]}
      />
      <FieldNote
        testID={props.testID}
        error={props.error}
        status={props.status}
        hint={props.hint}
      />
    </View>
  );
}
