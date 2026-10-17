// src/core/media/media-sweep.test.ts
import { parseMediaRef } from './media-ref';
import { planMediaSweep } from './media-sweep';

import type { MediaRef } from './media-ref';

function refs(...texts: string[]): MediaRef[] {
  return texts.map((text) => {
    const parsed = parseMediaRef(text);
    if (!parsed.ok) throw new Error(`test setup: ${text} is not a MediaRef`);
    return parsed.value;
  });
}

describe('planMediaSweep', () => {
  it('finds stored files nothing references, and referenced files that are gone', () => {
    const plan = planMediaSweep({
      stored: refs('c.jpg', 'a.jpg', 'b.jpg'),
      referenced: new Set(refs('b.jpg', 'z.jpg')),
    });
    expect(plan).toStrictEqual({ orphans: refs('a.jpg', 'c.jpg'), missing: refs('z.jpg') });
  });

  it('keeps a file the importer stored in this process, referenced or not', () => {
    const plan = planMediaSweep({
      stored: refs('new.jpg', 'old.jpg'),
      referenced: new Set<MediaRef>(),
      sessionRefs: new Set(refs('new.jpg')),
    });
    expect(plan.orphans).toStrictEqual(refs('old.jpg'));
  });

  it("keeps a file only the restore's safety copy references (protected), and never reports it missing", () => {
    const plan = planMediaSweep({
      stored: refs('undo.jpg', 'old.jpg'),
      referenced: new Set<MediaRef>(),
      protectedRefs: new Set(refs('undo.jpg', 'elsewhere.jpg')),
    });
    expect(plan).toStrictEqual({ orphans: refs('old.jpg'), missing: [] });
  });

  it('plans nothing when every file is referenced', () => {
    const stored = refs('a.jpg', 'b.png');
    expect(planMediaSweep({ stored, referenced: new Set(stored) })).toStrictEqual({
      orphans: [],
      missing: [],
    });
  });
});
