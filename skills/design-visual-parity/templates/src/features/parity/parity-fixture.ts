// src/features/parity/parity-fixture.ts
// The design's sample data: what the approved frames draw (the tasks, the lists, the day), in every
// language. parity-fixture.json is a copy of the references' fixture (design/parity/fixture.json);
// check-harness.mjs proves the two are equal, so nobody edits the data to make a frame pass. It is
// validated here, at load, with the same kind of schema the app's data uses: a wrong field fails in
// Jest, not on the device. The launch writes it through the app's own repositories (ParityAppliers).
import * as v from 'valibot';

import { LANGUAGES } from '@/i18n/languages';

import fixtureJson from './parity-fixture.json';

import type { Language } from '@/i18n/languages';

const localizedText = v.pipe(
  v.record(v.string(), v.string()),
  v.check(
    (texts) => LANGUAGES.every((language) => typeof texts[language] === 'string'),
    'a text in every language',
  ),
);

const parityFixtureSchema = v.strictObject({
  version: v.literal(1),
  day: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
  tasks: v.array(v.strictObject({ id: v.string(), title: localizedText, done: v.boolean() })),
  lists: v.array(v.strictObject({ id: v.string(), name: localizedText })),
});

export type ParityFixture = v.InferOutput<typeof parityFixtureSchema>;

/** Throws at load when the copy is malformed (the fixture test makes that a Jest failure). */
export const PARITY_FIXTURE: ParityFixture = v.parse(parityFixtureSchema, fixtureJson);

/** What the launch writes for one frame: the sample rows in the render language, or none. */
export type ParityData = {
  readonly day: string;
  readonly tasks: readonly {
    readonly id: string;
    readonly title: string;
    readonly isDone: boolean;
  }[];
  readonly lists: readonly { readonly id: string; readonly name: string }[];
};

export function parityDataFor(
  fixture: ParityFixture,
  language: Language,
  data: 'design' | 'empty',
): ParityData {
  if (data === 'empty') return { day: fixture.day, tasks: [], lists: [] };
  return {
    day: fixture.day,
    tasks: fixture.tasks.map((task) => ({
      id: task.id,
      title: task.title[language] ?? '',
      isDone: task.done,
    })),
    lists: fixture.lists.map((list) => ({ id: list.id, name: list.name[language] ?? '' })),
  };
}
