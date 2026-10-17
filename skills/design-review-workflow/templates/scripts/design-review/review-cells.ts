// scripts/design-review/review-cells.ts
// The design-review matrix as data for the app's capture runner: every cell of
// contracts/design-review.json (screen x state x theme x locale x text size x device), grouped into
// capture combinations in the order that changes device settings least (device, theme, text size,
// locale), each cell with the link that opens it and the file it is written to. The cell names are
// the ones design-review-workflow's checkers expect: <screen>.<state>--<theme>--<locale>--<text>--<device>.
// Pure: the runner reads the JSON files and passes them in.

/** The parts of contracts/design-review.json the matrix needs. */
export type ReviewPlan = {
  readonly capturesDir?: string;
  readonly screens: { readonly open: Readonly<Record<string, string>> };
  readonly themes: readonly ('light' | 'dark')[];
  readonly locales: readonly { readonly tag: string; readonly direction: 'ltr' | 'rtl' }[];
  readonly textSizes: readonly ReviewTextSize[];
  readonly devices: readonly ReviewDevice[];
  readonly motion?: { readonly record?: readonly string[] };
};

export type ReviewTextSize = {
  readonly id: string;
  readonly ios?: string;
  readonly android?: number;
  readonly devices?: readonly string[];
};

export type ReviewDevice = {
  readonly id: string;
  readonly platform: 'ios' | 'android' | 'web';
  readonly role: string;
  readonly model: string;
  readonly name?: string;
  readonly orientation?: 'portrait' | 'landscape';
};

/** One swept screen and its states (the default first), from contracts/screens.json. */
export type SweptScreen = { readonly id: string; readonly states: readonly string[] };

export type CellAxes = {
  readonly screen: string;
  readonly state: string;
  readonly theme: 'light' | 'dark';
  readonly locale: string;
  readonly text: string;
  readonly device: string;
};

export type ReviewCell = CellAxes & { readonly name: string };

/** One device setting (appearance, text size, language) and the cells it captures. */
export type CaptureCombination = {
  readonly device: ReviewDevice;
  readonly theme: 'light' | 'dark';
  readonly textSize: ReviewTextSize;
  readonly locale: string;
  readonly cells: readonly {
    readonly cell: ReviewCell;
    readonly open: string;
    readonly file: string;
  }[];
};

export const DEFAULT_CAPTURES_DIR = 'reports/design-review';

/** <screen>.<state>--<theme>--<locale>--<text>--<device> */
export function cellName(axes: CellAxes): string {
  return `${axes.screen}.${axes.state}--${axes.theme}--${axes.locale}--${axes.text}--${axes.device}`;
}

/** The device ids a text size is swept on: its `devices` list, or every device. */
export function textSizeDevices(plan: ReviewPlan, size: ReviewTextSize): readonly string[] {
  const all = plan.devices.map((device) => device.id);
  const only = size.devices;
  return only === undefined ? all : all.filter((id) => only.includes(id));
}

/** Every [text size, device] pair of the plan, in plan order. */
function sizeDevicePairs(plan: ReviewPlan): readonly (readonly [ReviewTextSize, string])[] {
  return plan.textSizes.flatMap((size) =>
    textSizeDevices(plan, size).map((device) => [size, device] as const),
  );
}

function compareNames(a: ReviewCell, b: ReviewCell): number {
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

/** Every [theme, locale] look of the plan, in plan order. */
function looksOf(
  plan: ReviewPlan,
): readonly { readonly theme: 'light' | 'dark'; readonly locale: string }[] {
  return plan.themes.flatMap((theme) => plan.locales.map(({ tag }) => ({ theme, locale: tag })));
}

/** Every cell, sorted by name (the order of a contact sheet: screen by screen). */
export function reviewCells(plan: ReviewPlan, screens: readonly SweptScreen[]): ReviewCell[] {
  const states = screens.flatMap((screen) =>
    screen.states.map((state) => ({ screen: screen.id, state })),
  );
  const looks = looksOf(plan);
  const pairs = sizeDevicePairs(plan);
  const cells: ReviewCell[] = [];
  for (const { screen, state } of states) {
    for (const { theme, locale } of looks) {
      for (const [size, device] of pairs) {
        const axes = { screen, state, theme, locale, text: size.id, device };
        cells.push({ ...axes, name: cellName(axes) });
      }
    }
  }
  return cells.sort(compareNames);
}

/** Where one cell's screenshot goes: <capturesDir>/<review-id>/cells/<name>.png */
export function cellFile(plan: ReviewPlan, reviewId: string, name: string): string {
  return `${plan.capturesDir ?? DEFAULT_CAPTURES_DIR}/${reviewId}/cells/${name}.png`;
}

/**
 * The debug-link query that puts the app into one combination before its cells are opened: the
 * language, the theme following the system appearance the device was set to, and motion held still.
 */
export function combinationQuery(locale: string): string {
  return `lang=${encodeURIComponent(locale)}&theme=system&motion=still`;
}

/**
 * The debug-link query sent before any motion video: motion back to the system setting. The stills'
 * motion=still is a saved override (it survives a relaunch), so without this every full-motion video
 * would be recorded with reduced motion forced on. The reduced take then turns on the system's Reduce
 * Motion (iOS Settings by hand; Android reduceMotionCommands), the same path a person takes.
 */
export const VIDEO_QUERY = 'motion=system';

/** The link that opens a cell's state; throws when the plan has none (check-review-plan fails it too). */
export function openLinkOf(plan: ReviewPlan, cell: CellAxes): string {
  const link = plan.screens.open[`${cell.screen}.${cell.state}`];
  if (link === undefined)
    throw new Error(`no open link for ${cell.screen}.${cell.state} in the plan`);
  return link;
}

function combinationKey(cell: CellAxes): string {
  return [cell.device, cell.theme, cell.text, cell.locale].join('|');
}

type Setting = {
  readonly device: ReviewDevice;
  readonly theme: 'light' | 'dark';
  readonly textSize: ReviewTextSize;
  readonly locale: string;
};

/** Every device setting in capture order: device, then theme, text size and locale. */
function settingsOf(plan: ReviewPlan): readonly Setting[] {
  const themeSizes = plan.themes.flatMap((theme) =>
    plan.textSizes.map((textSize) => ({ theme, textSize })),
  );
  const withLocales = themeSizes.flatMap((pair) =>
    plan.locales.map(({ tag }) => ({ ...pair, locale: tag })),
  );
  return plan.devices.flatMap((device) => withLocales.map((rest) => ({ device, ...rest })));
}

/** The capture combinations that hold cells, each cell with its open link and its file. */
export function captureCombinations(
  plan: ReviewPlan,
  screens: readonly SweptScreen[],
  reviewId: string,
): CaptureCombination[] {
  const byKey = new Map<string, ReviewCell[]>();
  for (const cell of reviewCells(plan, screens)) {
    const key = combinationKey(cell);
    byKey.set(key, [...(byKey.get(key) ?? []), cell]);
  }
  const combinations: CaptureCombination[] = [];
  for (const setting of settingsOf(plan)) {
    const key = [setting.device.id, setting.theme, setting.textSize.id, setting.locale].join('|');
    const cells = byKey.get(key) ?? [];
    if (cells.length === 0) continue;
    const shots = cells.map((cell) => ({
      cell,
      open: openLinkOf(plan, cell),
      file: cellFile(plan, reviewId, cell.name),
    }));
    combinations.push({ ...setting, cells: shots });
  }
  return combinations;
}

/** The motion videos: each recorded moment x platform (not web) x full and reduced motion, sorted. */
export function motionVideos(plan: ReviewPlan): string[] {
  const platforms = [...new Set(plan.devices.map((device) => device.platform))].filter(
    (platform) => platform !== 'web',
  );
  const moments = plan.motion?.record ?? [];
  return moments
    .flatMap((moment) =>
      platforms.flatMap((platform) => [
        `${moment}--${platform}--full`,
        `${moment}--${platform}--reduced`,
      ]),
    )
    .sort();
}
