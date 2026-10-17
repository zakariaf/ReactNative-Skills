// test/goldens/progress-ring.golden.test.ts
// PIXEL GOLDEN: the list progress ring at three canvas sizes.
import { toMatchPixelGolden } from './skia-golden';

expect.extend({ toMatchImageSnapshot: toMatchPixelGolden });

const SIZES = [
  { name: 'narrow', width: 320, height: 400 },
  { name: 'phone', width: 390, height: 560 },
  { name: 'tablet', width: 1024, height: 700 },
];

describe('progress ring golden', () => {
  it.each(SIZES)('draws the ring at $name', (size) => {
    expect(paintRing(size)).toMatchImageSnapshot({ customSnapshotIdentifier: `progress-ring-${size.name}` });
  });
});
