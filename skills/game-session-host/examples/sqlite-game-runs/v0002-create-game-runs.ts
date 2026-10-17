// src/data/migrations/v0002-create-game-runs.ts
// The tables behind GameRunsRepository. Frozen once it ships.
// Append it to MIGRATIONS (persistence-and-migrations); the version is the next free one in your app.
import type { Migration } from '@/data/migrations/migration-runner';

/** Literal SQL only. STRICT tables reject a value of the wrong type. */
export const CREATE_GAME_RUNS: Migration = {
  version: 2,
  name: 'create-game-runs',
  up: (driver) => {
    driver.exec(`
CREATE TABLE game_saved_runs (
  game_id  TEXT PRIMARY KEY NOT NULL,
  run_json TEXT NOT NULL
) STRICT;
CREATE TABLE game_results (
  game_id    TEXT    NOT NULL,
  run_key    TEXT    NOT NULL,
  best_score INTEGER NOT NULL,
  best_stars INTEGER NOT NULL DEFAULT 0 CHECK (best_stars BETWEEN 0 AND 3),
  PRIMARY KEY (game_id, run_key)
) STRICT;
CREATE TABLE game_run_ends (
  id            INTEGER PRIMARY KEY,
  game_id       TEXT    NOT NULL,
  run_key       TEXT    NOT NULL,
  day           TEXT    NOT NULL,
  is_won        INTEGER NOT NULL CHECK (is_won IN (0, 1)),
  score         INTEGER NOT NULL,
  moves         INTEGER NOT NULL,
  play_ms       INTEGER NOT NULL,
  stars         INTEGER NOT NULL CHECK (stars BETWEEN 0 AND 3),
  hints_used    INTEGER NOT NULL,
  counters_json TEXT    NOT NULL,
  is_practice   INTEGER NOT NULL DEFAULT 0 CHECK (is_practice IN (0, 1))
) STRICT;
CREATE INDEX game_run_ends_by_day ON game_run_ends (game_id, day);
CREATE INDEX game_run_ends_by_key ON game_run_ends (game_id, run_key);
`);
  },
};
