// scripts/e2e/write-gallery.test.ts
import {
  galleryHtml,
  isChanged,
  isFailed,
  NEW_BASELINE,
  type GalleryRow,
} from './write-gallery.ts';

const OUT = 'reports/screenshots/ios';
const MATCH: GalleryRow = {
  label: 'ios/phone/en-light/tasks',
  actual: 'reports/screenshots/ios/raw/phone/en-light/tasks.png',
  baseline: '.maestro/baselines/ios/phone/en-light/tasks.png',
  result: { kind: 'match', diffRatio: 0 },
};
const CHANGED: GalleryRow = {
  ...MATCH,
  label: 'ios/phone/ar-dark/tasks<b>',
  result: {
    kind: 'mismatch',
    diffRatio: 0.01,
    diffPath: 'reports/screenshots/ios/diff/phone/ar-dark/tasks.png',
  },
};
const FAILED: GalleryRow = {
  label: 'ios/tablet/ar-light',
  actual: null,
  baseline: null,
  result: {
    kind: 'capture-failed',
    message: 'maestro exited 1',
    outDir: 'reports/screenshots/ios/raw/tablet/ar-light',
  },
};

describe('isChanged and isFailed', () => {
  it('treats a new baseline and a match as unchanged, a failed capture as failed', () => {
    expect(isChanged(NEW_BASELINE)).toBe(false);
    expect(isChanged(MATCH.result)).toBe(false);
    expect(isChanged(CHANGED.result)).toBe(true);
    expect(isChanged(FAILED.result)).toBe(false);
    expect(isFailed(FAILED.result)).toBe(true);
    expect(isFailed(NEW_BASELINE)).toBe(false);
  });
});

describe('galleryHtml', () => {
  it('puts failed then changed rows first, links paths relative to the page and escapes labels', () => {
    const html = galleryHtml(OUT, [MATCH, CHANGED, FAILED]);
    expect(html.indexOf('capture failed')).toBeLessThan(html.indexOf('tasks&lt;b&gt;'));
    expect(html.indexOf('mismatch')).toBeLessThan(html.indexOf('ios/phone/en-light/tasks'));
    expect(html).toContain('src="diff/phone/ar-dark/tasks.png"');
    expect(html).toContain('href="raw/tablet/ar-light"');
  });
});
