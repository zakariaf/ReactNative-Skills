// scripts/design-review/review-cells.test.ts
import {
  captureCombinations,
  cellFile,
  cellName,
  combinationQuery,
  motionVideos,
  openLinkOf,
  reviewCells,
  textSizeDevices,
  type ReviewPlan,
  type SweptScreen,
  VIDEO_QUERY,
} from './review-cells.ts';

const PLAN: ReviewPlan = {
  screens: { open: { 'tasks.default': 'open=tasks', 'tasks.empty': 'open=tasks&seed=empty' } },
  themes: ['light', 'dark'],
  locales: [
    { tag: 'en', direction: 'ltr' },
    { tag: 'ar', direction: 'rtl' },
  ],
  textSizes: [
    { id: 'default', ios: 'large', android: 1 },
    { id: 'largest', ios: 'accessibility-extra-extra-extra-large', android: 2, devices: ['phone'] },
  ],
  devices: [
    { id: 'phone', platform: 'ios', role: 'smallest-phone', model: 'iPhone SE (3rd generation)' },
    { id: 'tablet', platform: 'android', role: 'tablet', model: 'medium_tablet' },
  ],
  motion: { record: ['press'] },
};

const SCREENS: readonly SweptScreen[] = [{ id: 'tasks', states: ['default', 'empty'] }];

describe('reviewCells', () => {
  it('names a cell <screen>.<state>--<theme>--<locale>--<text>--<device>', () => {
    const axes = {
      screen: 'tasks',
      state: 'empty',
      theme: 'dark',
      locale: 'ar',
      text: 'largest',
      device: 'phone',
    } as const;
    expect(cellName(axes)).toBe('tasks.empty--dark--ar--largest--phone');
  });

  it('sweeps the largest text only on the devices it names, the default size everywhere', () => {
    expect(textSizeDevices(PLAN, PLAN.textSizes[0] ?? { id: 'none' })).toStrictEqual([
      'phone',
      'tablet',
    ]);
    expect(textSizeDevices(PLAN, PLAN.textSizes[1] ?? { id: 'none' })).toStrictEqual(['phone']);
  });

  it('expands every state x theme x locale x text size x device, sorted by name', () => {
    const cells = reviewCells(PLAN, SCREENS);
    expect(cells).toHaveLength(2 * 2 * 2 * 3);
    const names = cells.map((cell) => cell.name);
    expect(names).toStrictEqual([...names].sort());
    expect(names[0]).toBe('tasks.default--dark--ar--default--phone');
    expect(names).not.toContain('tasks.default--light--en--largest--tablet');
  });
});

describe('captureCombinations', () => {
  it('orders combinations device first, then theme, text size and locale', () => {
    const combinations = captureCombinations(PLAN, SCREENS, '2026-10-14-1-0-0');
    const keys = combinations.map((c) => [c.device.id, c.theme, c.textSize.id, c.locale].join(' '));
    expect(keys.slice(0, 4)).toStrictEqual([
      'phone light default en',
      'phone light default ar',
      'phone light largest en',
      'phone light largest ar',
    ]);
    expect(keys).toHaveLength(8 + 4);
    expect(keys).not.toContain('tablet light largest en');
  });

  it('gives each cell its open link and its capture file', () => {
    const [first] = captureCombinations(PLAN, SCREENS, '2026-10-14-1-0-0');
    expect(first?.cells.map((shot) => [shot.open, shot.file])).toStrictEqual([
      [
        'open=tasks',
        'reports/design-review/2026-10-14-1-0-0/cells/tasks.default--light--en--default--phone.png',
      ],
      [
        'open=tasks&seed=empty',
        'reports/design-review/2026-10-14-1-0-0/cells/tasks.empty--light--en--default--phone.png',
      ],
    ]);
  });
});

describe('links, files and videos', () => {
  it('fails loudly for a state the plan cannot open', () => {
    const axes = {
      screen: 'settings',
      state: 'default',
      theme: 'light',
      locale: 'en',
      text: 'default',
      device: 'phone',
    } as const;
    expect(() => openLinkOf(PLAN, axes)).toThrow('no open link for settings.default');
  });

  it('puts captures under the plan capturesDir and sets each combination by one query', () => {
    expect(cellFile({ ...PLAN, capturesDir: 'qa/shots' }, 'r1', 'x')).toBe(
      'qa/shots/r1/cells/x.png',
    );
    expect(combinationQuery('ar')).toBe('lang=ar&theme=system&motion=still');
  });

  it('turns the saved motion=still override back to the system setting before the videos', () => {
    expect(VIDEO_QUERY).toBe('motion=system');
    expect(combinationQuery('en')).toContain('motion=still');
  });

  it('records each moment per platform with motion full and reduced', () => {
    expect(motionVideos(PLAN)).toStrictEqual([
      'press--android--full',
      'press--android--reduced',
      'press--ios--full',
      'press--ios--reduced',
    ]);
  });
});
