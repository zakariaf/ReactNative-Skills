// src/features/parity/parity-plans.ts
// One plan per design frame: what a parity launch must show for it. The frames, their roots, their
// states and which are tall come from the contracts (contracts/screens.json states with a
// "reference", contracts/visual-parity.json frames); check-harness.mjs proves this table agrees with
// them, so a frame can never be planned with the wrong root or without its state. Empty in this
// harness: no screen state has an approved design reference yet, so there is no frame to plan (the
// harness tests use a plan table of their own, so they keep passing). Plain data only (the checker reads it). href is a typed Expo Router
// href, so a renamed route fails tsc here instead of opening the wrong screen.

import type { Href } from 'expo-router';

export type ParityPlan = {
  /** The testID on the frame's outer view (the contract's root). */
  readonly root: string;
  /** The route the launch opens, as an Expo Router href. */
  readonly href: Href;
  /** The frame state the owning model opens with useFrameStateOpener, or null. */
  readonly state: string | null;
  /** The design's sample data ("design"), or none at all ("empty": a first launch). */
  readonly data: 'design' | 'empty';
  /** A tall frame: its body opens at the launch's scrollY. */
  readonly tall: boolean;
  /** The region a probe launch reports (contract frames.<key>.probe.region), or null. */
  readonly probe: string | null;
};

/** Frame key -> plan. The harness reads PARITY_PLANS; its tests pass a table of their own. */
export type ParityPlanTable = Readonly<Record<string, ParityPlan>>;

export const PARITY_PLANS = {} as const satisfies ParityPlanTable;
