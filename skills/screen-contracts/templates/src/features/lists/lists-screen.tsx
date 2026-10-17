// src/features/lists/lists-screen.tsx
// The Lists screen: a pure view of its model, one layout per contract state (contracts/screens.json,
// screen "lists": default, empty, error). Together with its components it sets exactly the
// contract's testIDs, renders only translated text from the model and reads no store, service or
// navigation. The lists can grow, so they are a FlatList keyed by id; the empty and error states are
// bounded pages. The delete dialog is its own contract screen, rendered here while the model holds a
// pending delete.
// Frame: every screen sits in react-components-and-hooks' ScreenFrame. This route has a Stack header
// above (it pads the top inset) and its bodies run on under the home indicator and Android's
// navigation bar (they pad the bottom inset), so in an app the root below is
//   <ScreenFrame testID="lists.screen" edges={BELOW_HEADER_SCROLLING_EDGES}>  (right and left only)
// The template draws a plain View root instead only because it must compile in a reference app that
// does not carry ScreenFrame yet; replace it when you copy the screen.
import { FlatList, StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, SPACING } from '@/theme/tokens';
import { usePageBottomPadding } from '@/ui/use-page-bottom-padding';

import { ListSummaryRow } from './components/list-summary-row';
import { ListsEmptyBody } from './components/lists-empty-body';
import { ListsErrorBody } from './components/lists-error-body';
import { DeleteListDialog } from './delete-list-dialog/delete-list-dialog';

import type { ListsModel } from './use-lists-model';

export type ListsScreenProps = {
  readonly model: ListsModel;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: {
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: 'center',
      gap: SPACING.sm,
      paddingBlockStart: SPACING.lg,
      paddingInline: SPACING.lg,
    },
  });
  return styles;
});

export function ListsScreen({ model }: ListsScreenProps): React.JSX.Element {
  const styles = useStyles();
  const bottom = usePageBottomPadding(true);
  const { state, deleteDialog } = model;
  return (
    <View testID="lists.screen" style={styles.screen}>
      {state.kind === 'default' && (
        <FlatList
          testID="lists.list"
          data={state.lists}
          keyExtractor={(list) => String(list.id)}
          contentContainerStyle={[styles.content, { paddingBlockEnd: bottom }]}
          renderItem={({ item }) => (
            <ListSummaryRow
              list={item}
              deleteText={model.deleteText}
              deleteLabel={model.deleteLabelOf(item.name)}
              onDelete={model.onAskDelete}
              isReducedMotion={model.isReducedMotion}
            />
          )}
        />
      )}
      {state.kind === 'empty' && <ListsEmptyBody title={model.emptyTitle} body={model.emptyBody} />}
      {state.kind === 'error' && (
        <ListsErrorBody
          text={model.errorText}
          retryLabel={model.retryLabel}
          onRetry={model.onRetry}
          isReducedMotion={model.isReducedMotion}
        />
      )}
      {deleteDialog !== null && (
        <DeleteListDialog
          title={deleteDialog.title}
          body={deleteDialog.body}
          confirmLabel={deleteDialog.confirmLabel}
          cancelLabel={deleteDialog.cancelLabel}
          onConfirm={model.onConfirmDelete}
          onCancel={model.onCancelDelete}
          isReducedMotion={model.isReducedMotion}
        />
      )}
    </View>
  );
}
