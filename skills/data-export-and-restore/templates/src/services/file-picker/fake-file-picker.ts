// src/services/file-picker/fake-file-picker.ts: a FilePickerPort that answers with what the test queued, for tests.
import { ok } from '@/core/result';

import type { Result } from '@/core/result';
import type {
  FilePickerPort,
  PickedFile,
  PickFailure,
} from '@/services/file-picker/file-picker-port';

export type FakeFilePicker = FilePickerPort & {
  /** The next pickFile answers this (a file, null for a cancelled pick, or a failure). */
  readonly queue: (answer: Result<PickedFile | null, PickFailure>) => void;
  /** How many times the picker was opened. */
  readonly opened: () => number;
};

/** With nothing queued, a pick is cancelled. */
export function createFakeFilePicker(): FakeFilePicker {
  const answers: Result<PickedFile | null, PickFailure>[] = [];
  let opens = 0;
  return {
    queue: (answer) => {
      answers.push(answer);
    },
    opened: () => opens,
    pickFile: () => {
      opens += 1;
      return Promise.resolve(answers.shift() ?? ok(null));
    },
  };
}
