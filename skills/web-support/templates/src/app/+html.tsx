// src/app/+html.tsx
// The root HTML around every page Expo renders ahead of time (web.output "static" or "server"; a
// "single" export ignores this file). It runs only in Node, at export time: no browser globals, no
// app providers, no global CSS (web-support). It names the source language and its direction, lets
// the safe-area insets of a notched phone reach the page (viewport-fit=cover, which
// react-native-safe-area-context reads through env(safe-area-inset-*)), resets body scrolling the way
// a root ScrollView expects, and paints the theme's ground before any JavaScript runs, in light and
// dark, so a dark-mode visitor never sees a white flash.
import { ScrollViewStyleReset } from 'expo-router/html';

import { SOURCE_LANGUAGE, directionOf } from '@/i18n/languages';
import { PALETTE } from '@/theme/palette';

import type { PropsWithChildren, ReactNode } from 'react';

/** The page ground in both schemes, from the palette (the same colours the app paints). */
export const GROUND_CSS = [
  `body{background-color:${PALETTE.light.background};}`,
  `@media (prefers-color-scheme: dark){body{background-color:${PALETTE.dark.background};}}`,
].join('');

export default function RootHtml({ children }: PropsWithChildren): ReactNode {
  return (
    <html lang={SOURCE_LANGUAGE} dir={directionOf(SOURCE_LANGUAGE)}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <ScrollViewStyleReset />
        <style id="app-ground" dangerouslySetInnerHTML={{ __html: GROUND_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
