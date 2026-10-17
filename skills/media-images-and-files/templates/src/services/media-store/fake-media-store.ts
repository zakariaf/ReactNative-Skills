// src/services/media-store/fake-media-store.ts: an in-memory MediaStorePort with the adapter's contract, for tests.
import { err, ok } from '@/core/result';

import type { MediaRef } from '@/core/media/media-ref';
import type { MediaStoreFailure, MediaStorePort } from '@/services/media-store/media-store-port';

export type FakeMediaStore = MediaStorePort & {
  /** Stored files: name to the URI of the temporary each was imported from. */
  readonly stored: () => ReadonlyMap<MediaRef, string>;
  /** Temporaries that exist (the cache); importFile reads them, discardTemporary deletes them. */
  readonly giveTemporary: (uri: string) => void;
  readonly temporaries: () => ReadonlySet<string>;
  /** The next importFile fails with this, once (nothing is stored). */
  readonly failNextImport: (failure: MediaStoreFailure) => void;
  /** Puts a file in the folder directly (a file a crash left behind). */
  readonly plant: (ref: MediaRef) => void;
  /** Leaves a partial copy of `ref` in the folder (a crash mid-copy); list() never shows it. */
  readonly plantPartial: (ref: MediaRef) => void;
  readonly partials: () => ReadonlySet<MediaRef>;
};

/** The adapter's cache folder; discardTemporary ignores anything outside it. */
export const FAKE_CACHE_PREFIX = 'file:///cache/';

type FakeFolder = {
  readonly files: Map<MediaRef, string>;
  readonly temporaries: Set<string>;
  readonly partials: Set<MediaRef>;
};

/** The adapter's importFile contract over the fake folder; `takeFailure` answers a queued failure once. */
function fakeImport(
  { files, temporaries }: FakeFolder,
  takeFailure: () => MediaStoreFailure | null,
): MediaStorePort['importFile'] {
  return ({ sourceUri, ref }) => {
    const failure = takeFailure();
    if (failure !== null) return Promise.resolve(err(failure));
    if (files.has(ref)) return Promise.resolve(err({ kind: 'name-taken', ref }));
    if (!temporaries.has(sourceUri)) return Promise.resolve(err({ kind: 'source-missing' }));
    files.set(ref, sourceUri);
    return Promise.resolve(ok(ref));
  };
}

/** The test-only members: what is stored, temporaries, planted files and queued failures. */
function fakeControls(
  folder: FakeFolder,
  queueFailure: (failure: MediaStoreFailure) => void,
): Omit<FakeMediaStore, keyof MediaStorePort> {
  const { files, temporaries, partials } = folder;
  return {
    stored: () => files,
    temporaries: () => temporaries,
    giveTemporary: (uri) => {
      temporaries.add(uri);
    },
    failNextImport: queueFailure,
    plant: (ref) => {
      files.set(ref, 'planted');
    },
    plantPartial: (ref) => {
      partials.add(ref);
    },
    partials: () => partials,
  };
}

export function createFakeMediaStore(): FakeMediaStore {
  const folder: FakeFolder = { files: new Map(), temporaries: new Set(), partials: new Set() };
  const { files, temporaries, partials } = folder;
  let nextFailure: MediaStoreFailure | null = null;
  const takeFailure = (): MediaStoreFailure | null => {
    const failure = nextFailure;
    nextFailure = null;
    return failure;
  };
  return {
    ...fakeControls(folder, (failure) => {
      nextFailure = failure;
    }),
    importFile: fakeImport(folder, takeFailure),
    uriOf: (ref) => `file:///documents/media/${ref}`,
    exists: (ref) => files.has(ref),
    remove: (ref) => {
      files.delete(ref);
      return ok(undefined);
    },
    list: () => ok([...files.keys()]),
    removeStalePartials: () => {
      const count = partials.size;
      partials.clear();
      return ok(count);
    },
    discardTemporary: (uri) => {
      if (uri.startsWith(FAKE_CACHE_PREFIX)) temporaries.delete(uri);
    },
  };
}
