// src/ui/icon-slot.ts
import type { ReactNode } from 'react';

/** The size and colour a component draws an icon at (its paint follows the component's state). */
export type IconLook = { readonly size: number; readonly color: string };

/**
 * An icon from the app's icon set, drawn at the look the component chooses:
 * `icon={(look) => <Icon name="plus" {...look} />}`. The library draws no icons of its own, so it
 * works with any icon set; the component wraps the icon and hides it from screen readers.
 */
export type IconSlot = (look: IconLook) => ReactNode;
