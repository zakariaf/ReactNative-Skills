// src/ui/feedback/offline-banner.tsx
import { useEffect, useEffectEvent, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { SPACING } from '@/theme/tokens';
import { useAnnounce } from '@/ui/a11y/use-announce';
import { AppText } from '@/ui/app-text';

import type { Reachability } from '@/services/connectivity/connectivity-port';
import type { ReactNode } from 'react';

export type OfflineBannerProps = {
  /** From useReachability(services.connectivity) in the model hook. */
  readonly reachability: Reachability;
  /** Translated: "You're offline. Changes sync when you're back online." */
  readonly offlineText: string;
  /** Translated, softer: connected, but Android has not validated the internet (a portal, a firewall). */
  readonly unvalidatedText: string;
  /** '<screen>.offline-banner'. */
  readonly testID: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    banner: {
      paddingBlock: SPACING.sm,
      paddingInline: SPACING.lg,
      backgroundColor: theme.colors.sunken,
    },
  });
  return styles;
});

/**
 * The banner rung: a condition that lasts (no network) stays on screen, above the content, until it
 * ends; it is never a notice that times out. Requests still run on an unvalidated network, so that
 * text only warns. A change while the screen is open is spoken: TalkBack through the live region,
 * iOS through an announcement. A banner already up when the screen mounts is not announced: it is
 * the first thing VoiceOver and TalkBack read on the screen, and every screen opened while offline
 * would otherwise say it again.
 */
export function OfflineBanner(props: OfflineBannerProps): ReactNode {
  const styles = useStyles();
  const announce = useAnnounce();
  const text = props.reachability === 'none' ? props.offlineText : props.unvalidatedText;
  const isShown = props.reachability !== 'reachable';
  const shownText = isShown ? text : null;
  const lastShown = useRef(shownText);
  const onChange = useEffectEvent((spoken: string) => {
    if (Platform.OS === 'ios') announce(spoken);
  });
  useEffect(() => {
    if (shownText === lastShown.current) return;
    lastShown.current = shownText;
    if (shownText !== null) onChange(shownText);
  }, [shownText]);
  if (!isShown) return null;
  return (
    <View
      testID={props.testID}
      style={styles.banner}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <AppText testID={`${props.testID}.text`}>{text}</AppText>
    </View>
  );
}
