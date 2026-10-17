// src/theme/shadow-styles.ts
// Static shadows, rings and focus indicators through the New Architecture's boxShadow and outline
// props, which draw the same on iOS and Android (Android 9+ for boxShadow). Never the legacy keys:
// shadowOffset, shadowOpacity and shadowRadius draw on iOS only, elevation draws Android's own
// shadow, and shadowColor tints that shadow only on Android 9+ (API 28), so one token renders
// differently on each platform (check-raw-values: no-legacy-shadow).
import type { ViewStyle } from 'react-native';

/** box-shadow: 0 <offset>px <blur>px <color>; offset straight down. For parts that never move. */
export function shadow(offset: number, color: string, blur = 0): ViewStyle {
  return {
    boxShadow: [{ offsetX: 0, offsetY: offset, blurRadius: blur, spreadDistance: 0, color }],
  };
}

/** box-shadow: 0 0 0 <width>px <color>: a ring that is not a border (it takes no layout space). */
export function ring(width: number, color: string): ViewStyle {
  return { boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: width, color }] };
}

/** Focus indicator geometry: 3 pt wide, 2 pt outside the control's border. */
export const FOCUS_RING = { width: 3, gap: 2 } as const;

/** outline: 3px solid <focus>; outline-offset: 2px. Follows the border radius. */
export function focusRing(color: string): ViewStyle {
  return {
    outlineWidth: FOCUS_RING.width,
    outlineStyle: 'solid',
    outlineOffset: FOCUS_RING.gap,
    outlineColor: color,
  };
}
