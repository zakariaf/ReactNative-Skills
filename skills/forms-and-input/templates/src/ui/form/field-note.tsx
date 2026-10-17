// src/ui/form/field-note.tsx
// The line below a text field (forms-and-input): the error first, then the progress note of an
// async check, then the hint. The error and the progress note sit in a polite live region for
// TalkBack (a region that appears with its text is spoken on most versions; the device check in
// fields-and-autofill.md is owed); VoiceOver reads them as the input's hint (TextField).
import { View } from 'react-native';

import { AppText } from '@/ui/app-text';

export type FieldNoteProps = {
  /** The field's testID; the note's part is `.error`, `.status` or `.hint`. */
  readonly testID: string;
  readonly error?: string | null | undefined;
  readonly status?: string | null | undefined;
  readonly hint?: string | undefined;
};

/** True for a note that has text (null, undefined and '' show nothing). */
export function isShown(text: string | null | undefined): text is string {
  return typeof text === 'string' && text !== '';
}

export function FieldNote(props: FieldNoteProps): React.JSX.Element | null {
  if (isShown(props.error)) {
    return (
      <View accessibilityLiveRegion="polite">
        <AppText testID={`${props.testID}.error`} tone="danger" variant="caption">
          {props.error}
        </AppText>
      </View>
    );
  }
  if (isShown(props.status)) {
    return (
      <View accessibilityLiveRegion="polite">
        <AppText testID={`${props.testID}.status`} tone="muted" variant="caption">
          {props.status}
        </AppText>
      </View>
    );
  }
  if (!isShown(props.hint)) return null;
  return (
    <AppText testID={`${props.testID}.hint`} tone="muted" variant="caption">
      {props.hint}
    </AppText>
  );
}
