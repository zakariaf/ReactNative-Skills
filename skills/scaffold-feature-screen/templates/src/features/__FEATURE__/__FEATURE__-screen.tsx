// src/features/__FEATURE__/__FEATURE__-screen.tsx
// The screen: a pure view of the model its route hands it. It imports no store, service, router or
// catalog, so its test renders it with plain values.
// Frame: a plain View root, because the app has no src/ui/screen-frame.tsx yet. scaffold-feature.mjs
// writes react-components-and-hooks' <ScreenFrame testID edges={BELOW_HEADER_EDGES}> instead in an app
// that has it (the Stack header pads the top inset, the frame the sides and the bottom).
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, SPACING } from '@/theme/tokens';
import { AppText } from '@/ui/app-text';

import type { __FEATURE_PASCAL__Model } from './use-__FEATURE__-model';

export type __FEATURE_PASCAL__ScreenProps = {
  readonly model: __FEATURE_PASCAL__Model;
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

export function __FEATURE_PASCAL__Screen({ model }: __FEATURE_PASCAL__ScreenProps): React.JSX.Element {
  const styles = useStyles();
  return (
    <View testID="__FEATURE__.screen" style={styles.screen}>
      <View style={styles.content}>
        <AppText testID="__FEATURE__.body" tone="muted">
          {model.body}
        </AppText>
      </View>
    </View>
  );
}
