// src/features/settings/language/language-row.tsx: a nested feature folder may prefix its parent.
import { ListRow } from '@/ui/list-row';

export type SettingsLanguageRowProps = {
  readonly locale: string;
  readonly isSelected: boolean;
  readonly onSelect: (locale: string) => void;
};

export function SettingsLanguageRow({ locale, isSelected, onSelect }: SettingsLanguageRowProps): React.JSX.Element {
  const handlePress = (): void => {
    onSelect(locale);
  };
  return <ListRow title={locale} isChecked={isSelected} testID={`settings.language-row.${locale}`} onPress={handlePress} />;
}
