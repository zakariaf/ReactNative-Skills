// src/data/migrations/migrations.ts: the app's migration list. Ordered and append-only: entry N is version N.
import { CREATE_LISTS_AND_TASKS } from './v0001-create-lists-and-tasks';
import { ADD_LIST_SORT_ORDER } from './v0002-add-list-sort-order';

import type { Baseline } from '@/data/app-database';
import type { Migration } from '@/data/migrations/migration-runner';

/** Every step ever shipped. A new schema is a new file appended here, never an edit above. */
export const MIGRATIONS: readonly Migration[] = [CREATE_LISTS_AND_TASKS, ADD_LIST_SORT_ORDER];

/** The schema version this build writes (PRAGMA user_version after a successful open). */
export const LATEST_DB_VERSION = MIGRATIONS.length;

/**
 * null: every installed database came from this layer. An app adopting a database that older
 * builds wrote without versions sets { version, variants } once, before that release, and never
 * changes it (references/tables-and-repositories.md, "Adopting in an existing app").
 */
export const BASELINE: Baseline | null = null;
