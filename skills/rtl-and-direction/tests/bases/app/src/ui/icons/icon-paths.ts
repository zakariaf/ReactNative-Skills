// src/ui/icons/icon-paths.ts
export const ICON_PATHS = {
  back: 'M10.5 5 3.8 12l6.7 7M4.6 12h15.6',
  chevron: 'm9.2 5.2 6.8 6.8-6.8 6.8',
  check: 'm5 12 5 5 9-10',
  play: 'M8 5v14l11-7z',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Icons that point along the reading direction flip in a right-to-left layout. */
export const DIRECTIONAL_ICONS: ReadonlySet<IconName> = new Set<IconName>(['back', 'chevron']);
