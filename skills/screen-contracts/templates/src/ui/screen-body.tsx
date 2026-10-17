// src/ui/screen-body.tsx
// The scrolling body of a bounded page (a detail page, settings, an empty or error state): one
// column with one gap between blocks, the page padding, and three device lessons built in.
// - Under the home indicator: a page that scrolls on under the system bar sets
//   isUnderHomeIndicator (and its frame leaves the bottom edge off), so the content ends with the
//   larger of the page padding and the bottom inset (usePageBottomPadding).
// - Opening at an offset: scrollToY scrolls from onContentSizeChange and again from onLayout. The
//   first layout can come before the safe-area insets, iOS clamps the offset to that too-tall
//   frame, and a body that scrolled only once stopped short. Once the person drags, the offset is
//   theirs: later size changes (data, an expanding block, text size, rotation) never jump back.
// - A tilted or shadowed first block: the scroll view clips at its top edge, so hasTopOverhang
//   moves that edge up and pads the content by the same amount; nothing else moves.
// The content grows (flexGrow 1), so a spacer with flexGrow pushes the last block (the screen's one
// primary action) to the bottom, and the same column scrolls instead of clipping at 200 % text.
import { useRef } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, SPACING } from '@/theme/tokens';

import { usePageBottomPadding } from './use-page-bottom-padding';

import type { ComponentRef, ReactNode } from 'react';

export type ScreenBodyGap = 'sm' | 'md' | 'lg' | 'xl';

export type ScreenBodyProps = {
  readonly children: ReactNode;
  /** One gap between all blocks (a spacing token). Default 'lg'. */
  readonly gap?: ScreenBodyGap;
  readonly testID?: string;
  /** The page scrolls on under the home indicator or Android's navigation bar. */
  readonly isUnderHomeIndicator?: boolean;
  /** The first block rises above its box (a tilt, a ring, a shadow): keep it from being clipped. */
  readonly hasTopOverhang?: boolean;
  /** Open scrolled to this offset (pt from the top of the content). */
  readonly scrollToY?: number;
};

/** Clip room above a tilted or shadowed first block. */
export const TOP_OVERHANG = SPACING.md;

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    body: { flex: 1 },
    overhang: { marginBlockStart: -TOP_OVERHANG },
    content: {
      flexGrow: 1,
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: 'center',
      paddingInline: SPACING.lg,
    },
  });
  return styles;
});

export function ScreenBody(props: ScreenBodyProps): ReactNode {
  const styles = useStyles();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const hasDragged = useRef(false);
  const bottom = usePageBottomPadding(props.isUnderHomeIndicator === true);
  const top = SPACING.sm + (props.hasTopOverhang === true ? TOP_OVERHANG : 0);
  const handleLayoutChange = (): void => {
    if (props.scrollToY === undefined || hasDragged.current) return;
    scrollRef.current?.scrollTo({ y: props.scrollToY, animated: false });
  };
  const handleDrag = (): void => {
    hasDragged.current = true;
  };
  return (
    <ScrollView
      ref={scrollRef}
      testID={props.testID}
      style={[styles.body, props.hasTopOverhang === true && styles.overhang]}
      contentContainerStyle={[
        styles.content,
        { gap: SPACING[props.gap ?? 'lg'], paddingBlockStart: top, paddingBlockEnd: bottom },
      ]}
      onContentSizeChange={handleLayoutChange}
      onLayout={handleLayoutChange}
      onScrollBeginDrag={handleDrag}
    >
      {props.children}
    </ScrollView>
  );
}
