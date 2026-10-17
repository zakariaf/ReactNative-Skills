// src/features/settings/settings-screen.tsx (shape only): a pure view of the model. The row
// components are the app's thin wrappers in one feature file, ./settings-row-parts.tsx, over
// ui-component-library's parts (its component-catalogue 'Settings rows'): SwitchRow = ListRow
// kind='switch' (isOn), LinkRow = ListRow kind='navigate' (value, mirrored chevron), DangerRow =
// ListRow isDanger, ListSectionHeader = SectionHeader, SegmentedRow = SegmentedControl and SliderRow =
// Slider inside a ListGroup, ConfirmDialog = Scrim + DialogCard + DialogButtonRow (safe choice first).
// Each takes a testID, a label and its state, and sets its own accessibility role. Visibility is
// already decided: the view renders what it gets.
import { useEffect } from 'react';
import { Platform, SectionList } from 'react-native';

import { useAnnounce } from '@/ui/a11y/use-announce';
import { AppText } from '@/ui/app-text';

import {
  ConfirmDialog,
  DangerRow,
  LinkRow,
  ListSectionHeader,
  SegmentedRow,
  SliderRow,
  SwitchRow,
} from './settings-row-parts';

import type { SettingsModel, SettingsRowView } from './use-settings-model';
import type { SettingsRowId } from './settings-rows';

type DialogState = { readonly isOpen: boolean; readonly onCancel: () => void; readonly onConfirm: () => void };

export type SettingsScreenProps = {
  readonly model: SettingsModel;
  /** Navigation and hand-offs for link rows; a danger row opens its dialog (the route hook owns them). */
  readonly onOpenRow: (id: SettingsRowId) => void;
  readonly restartDialog: DialogState;
  readonly resetSettingsDialog: DialogState;
  readonly deleteAllDataDialog: DialogState;
};

type RowProps = { readonly row: SettingsRowView } & Pick<SettingsScreenProps, 'model' | 'onOpenRow'>;

function Row({ row, model, onOpenRow }: RowProps): React.JSX.Element {
  const { settings, actions } = model;
  switch (row.id) {
    case 'sound':
      return <SwitchRow testID={row.testID} label={row.label} isOn={settings.soundEnabled} onToggle={actions.onToggleSound} />;
    case 'haptics':
      return <SwitchRow testID={row.testID} label={row.label} isOn={settings.hapticsEnabled} onToggle={actions.onToggleHaptics} />;
    case 'reduce-motion':
      return <SwitchRow testID={row.testID} label={row.label} isOn={model.isReduceMotionOn} onToggle={actions.onToggleReduceMotion} />;
    case 'sound-volume':
      // The slider works in 0..1; the handler dispatches only when the whole percent changes.
      return <SliderRow testID={row.testID} label={row.label} value={settings.soundVolume / 100} valueText={model.volumeText} onChange={actions.onChangeSoundVolume} />;
    case 'theme':
      return <SegmentedRow testID={row.testID} label={row.label} value={settings.theme} onSelect={actions.onSelectTheme} />;
    case 'numbers':
      return <SegmentedRow testID={row.testID} label={row.label} value={settings.digits} onSelect={actions.onSelectDigits} />;
    case 'language':
      return <LinkRow testID={row.testID} label={row.label} value={model.languageValue} onPress={() => onOpenRow(row.id)} />;
    case 'reset-settings':
    case 'delete-all-data':
    case 'delete-account':
      // A danger row opens its confirmation; it never acts on the first tap.
      return <DangerRow testID={row.testID} label={row.label} onPress={() => onOpenRow(row.id)} />;
    default:
      return <LinkRow testID={row.testID} label={row.label} onPress={() => onOpenRow(row.id)} />;
  }
}

/**
 * A failure note that both screen readers hear: accessibilityLiveRegion speaks it on Android
 * (TalkBack) only, so on iOS it is also announced once through accessibility-as-code's useAnnounce
 * (VoiceOver). Not on Android: TalkBack speaks announcements too, so the note would be read twice.
 */
function FailureNote({ testID, text }: { readonly testID: string; readonly text: string | null }): React.JSX.Element | null {
  const announce = useAnnounce();
  useEffect(() => {
    if (text !== null && Platform.OS === 'ios') announce(text);
  }, [announce, text]);
  if (text === null) return null;
  return (
    <AppText testID={testID} tone="danger" accessibilityLiveRegion="polite">
      {text}
    </AppText>
  );
}

export function SettingsScreen({ model, onOpenRow, restartDialog, resetSettingsDialog, deleteAllDataDialog }: SettingsScreenProps): React.JSX.Element {
  return (
    <>
      <SectionList
        testID="settings.list"
        sections={model.groups.map((group) => ({ key: group.id, title: group.title, data: group.rows }))}
        keyExtractor={(row) => row.id}
        renderSectionHeader={({ section }) => <ListSectionHeader title={section.title} />}
        renderItem={({ item }) => <Row row={item} model={model} onOpenRow={onOpenRow} />}
        ListFooterComponent={
          <>
            <FailureNote testID="settings.save-failed" text={model.saveFailedText} />
            <FailureNote testID="settings.delete-failed" text={model.deleteFailedText} />
          </>
        }
      />
      <ConfirmDialog
        testID="settings.restart-dialog"
        isOpen={restartDialog.isOpen}
        titleKey="settings.language.restart.title"
        bodyKey="settings.language.restart.body"
        cancelKey="settings.language.restart.later"
        confirmKey="settings.language.restart.confirm"
        onCancel={restartDialog.onCancel}
        onConfirm={restartDialog.onConfirm}
      />
      <ConfirmDialog
        testID="settings.reset-settings-dialog"
        isOpen={resetSettingsDialog.isOpen}
        tone="danger"
        titleKey="settings.reset-settings.confirm-title"
        bodyKey="settings.reset-settings.confirm-body"
        cancelKey="common.cancel"
        confirmKey="settings.reset-settings.confirm"
        onCancel={resetSettingsDialog.onCancel}
        onConfirm={resetSettingsDialog.onConfirm}
      />
      <ConfirmDialog
        testID="settings.delete-all-data-dialog"
        isOpen={deleteAllDataDialog.isOpen}
        tone="danger"
        titleKey="settings.delete-all-data.confirm-title"
        bodyKey="settings.delete-all-data.confirm-body"
        cancelKey="common.cancel"
        confirmKey="settings.delete-all-data.confirm"
        onCancel={deleteAllDataDialog.onCancel}
        onConfirm={deleteAllDataDialog.onConfirm}
      />
    </>
  );
}
