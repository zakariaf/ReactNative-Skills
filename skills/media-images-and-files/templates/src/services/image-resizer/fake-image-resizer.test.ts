// src/services/image-resizer/fake-image-resizer.test.ts
import { createFakeImageResizer } from './fake-image-resizer';

const REQUEST = {
  uri: 'file:///cache/ImagePicker/a.heic',
  size: { width: 4032, height: 3024 },
  maxEdgePx: 2048,
  quality: 0.8,
};

describe('createFakeImageResizer', () => {
  it('answers with a new cache JPEG of the fitted size and tells its listeners', async () => {
    const resizer = createFakeImageResizer();
    const outputs: string[] = [];
    resizer.onOutput((uri) => outputs.push(uri));
    await expect(resizer.downscale(REQUEST)).resolves.toStrictEqual({
      ok: true,
      value: { uri: 'file:///cache/ImageManipulator/1.jpg', size: { width: 2048, height: 1536 } },
    });
    expect(outputs).toStrictEqual(['file:///cache/ImageManipulator/1.jpg']);
    expect(resizer.requests).toStrictEqual([REQUEST]);
  });

  it('fails once as a value when told to', async () => {
    const resizer = createFakeImageResizer();
    resizer.failNext();
    await expect(resizer.downscale(REQUEST)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'resize-failed' },
    });
    expect((await resizer.downscale(REQUEST)).ok).toBe(true);
  });
});
