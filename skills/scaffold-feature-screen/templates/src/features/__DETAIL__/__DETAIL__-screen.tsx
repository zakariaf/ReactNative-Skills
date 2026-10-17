// src/features/__DETAIL__/__DETAIL__-screen.tsx
// The screen: a pure view of the model its route hands it, one layout per state. It imports no store,
// service, router or catalog, so its test renders every state with plain values.
// Frame: a plain View root, because the app has no src/ui/screen-frame.tsx yet. scaffold-feature.mjs
// writes react-components-and-hooks' <ScreenFrame testID edges={BELOW_HEADER_EDGES}> instead in an app
// that has it (the Stack header pads the top inset, the frame the sides and the bottom).
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, SPACING } from '@/theme/tokens';
import { AppText } from '@/ui/app-text';

import { __DETAIL_PASCAL__InvalidLink } from './components/__DETAIL__-invalid-link';

import type { __DETAIL_PASCAL__Model } from './use-__DETAIL__-model';

export type __DETAIL_PASCAL__ScreenProps = {
  readonly model: __DETAIL_PASCAL__Model;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    // A wide window (a tablet, a foldable) centres the column instead of stretching it.
    content: {
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: 'center',
      gap: SPACING.md,
      paddingBlock: SPACING.lg,
      paddingInline: SPACING.lg,
    },
  });
  return styles;
});

export function __DETAIL_PASCAL__Screen({ model }: __DETAIL_PASCAL__ScreenProps): React.JSX.Element {
  const styles = useStyles();
  return (
    <View testID="__DETAIL__.screen" style={styles.screen}>
      <View style={styles.content}>
        {model.state.kind === 'ready' ? (
          <AppText testID="__DETAIL__.body" tone="muted">
            {model.body}
          </AppText>
        ) : (
          <__DETAIL_PASCAL__InvalidLink
            text={model.invalidLinkText}
            goHomeLabel={model.goHomeLabel}
            onGoHome={model.onGoHome}
            isReducedMotion={model.isReducedMotion}
            textTestID="__DETAIL__.invalid-link-text"
            buttonTestID="__DETAIL__.go-home-button"
          />
        )}
      </View>
    </View>
  );
}
