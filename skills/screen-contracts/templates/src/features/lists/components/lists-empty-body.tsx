// src/features/lists/components/lists-empty-body.tsx
// The Lists screen's empty state (not drawn by the design: Chosen, see contracts/screens.json): a
// bounded page in the shared ScreenBody, a title that is a header for screen readers, and one line.
import { AppText } from '@/ui/app-text';
import { ScreenBody } from '@/ui/screen-body';

export type ListsEmptyBodyProps = {
  /** Translated. */
  readonly title: string;
  /** Translated. */
  readonly body: string;
};

export function ListsEmptyBody({ title, body }: ListsEmptyBodyProps): React.JSX.Element {
  return (
    <ScreenBody isUnderHomeIndicator>
      <AppText testID="lists.empty-title" variant="title" isHeader>
        {title}
      </AppText>
      <AppText testID="lists.empty-body" tone="muted">
        {body}
      </AppText>
    </ScreenBody>
  );
}
