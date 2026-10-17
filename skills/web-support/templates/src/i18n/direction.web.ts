// src/i18n/direction.web.ts
// The layout direction in the web build (web-support), in place of direction.ts (rtl-and-direction
// owns that file and the restart rules). react-native-web's I18nManager has no isRTL, answers
// getConstants().isRTL false for every language and ignores forceRTL (react-native-web 0.21.3), so
// direction.ts reads every visitor as left to right: DirectionGate reloads an Arabic visitor's page,
// reads left to right again and gives up (flip-did-not-take), on every load, and the page stays
// left to right. In a browser the layout direction is the dir attribute of <html>: react-native-web
// writes the logical style keys as CSS logical properties, which follow it. The static HTML of each
// page carries the source language's dir (+html.tsx), so the direction the app forced is kept in
// localStorage (a preference, not a secret), the way a phone keeps the forceRTL flag in its own
// preferences across a reload, and put back on <html> when it is read. Like direction.ts on a phone,
// this file is the direction module of the web build: the only place that stores the forced
// direction and reloads for it.
import { reloadAppAsync } from 'expo';

import { attempt, err, ok } from '@/core/result';

import type * as Native from './direction';
import type { Direction } from './languages';

/** Where the direction the app forced survives a reload of the page. */
const LAYOUT_DIRECTION_KEY = 'app.layout-direction';

/**
 * The saved direction, or null: none saved, or storage blocked by the browser's site settings (the
 * throw is the answer there, so it is converted: the page's own dir attribute decides, as on a first
 * visit).
 */
function savedDirection(): Direction | null {
  const saved = attempt(
    () => localStorage.getItem(LAYOUT_DIRECTION_KEY),
    () => ({ kind: 'layout-direction-unreadable' }) as const,
  );
  if (!saved.ok) return null;
  return saved.value === 'rtl' || saved.value === 'ltr' ? saved.value : null;
}

/** The layout direction of this page: the saved one (put back on <html>), else <html dir>. */
export const readLayoutDirection: typeof Native.readLayoutDirection = () => {
  // Static rendering runs in Node, where there is no page; the storage gate renders nothing there.
  if (typeof document === 'undefined') return 'ltr';
  const root = document.documentElement;
  const direction = savedDirection() ?? (root.dir === 'rtl' ? 'rtl' : 'ltr');
  root.dir = direction;
  return direction;
};

/** Saves the direction for the next load of the page; false when the browser blocks site data. */
function saveDirection(direction: Direction): boolean {
  const saved = attempt(
    () => {
      localStorage.setItem(LAYOUT_DIRECTION_KEY, direction);
    },
    () => ({ kind: 'layout-direction-not-saved' }) as const,
  );
  return saved.ok;
}

/**
 * Sets <html dir> now and saves it for the next load of the page. When the save fails (blocked site
 * data) this page still flips; the next load starts from the static dir again, and the direction
 * guard turns that into one reported give-up, never a reload loop.
 */
export const forceLayoutDirection: typeof Native.forceLayoutDirection = (direction) => {
  if (typeof document !== 'undefined') document.documentElement.dir = direction;
  saveDirection(direction);
};

/**
 * The same contract as on a phone: record the pending direction (without the record it does not
 * reload), force it, run beforeReload, then reload the page (expo's reloadAppAsync is
 * location.reload() in a browser). The reload follows the flip even when beforeReload rejects.
 */
export const restartForDirection: typeof Native.restartForDirection = async (
  direction,
  guard,
  beforeReload,
) => {
  const recorded = guard.writePending(direction);
  if (!recorded.ok) return err(recorded.error);
  forceLayoutDirection(direction);
  try {
    await beforeReload?.();
  } finally {
    await reloadAppAsync(`layout direction -> ${direction}`);
  }
  return ok(undefined);
};
