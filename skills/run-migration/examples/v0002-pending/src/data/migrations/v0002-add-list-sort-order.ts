// src/data/migrations/v0002-add-list-sort-order.ts: version 2 of the app database. Frozen once a build or update with it reaches any device.
import type { Migration } from '@/data/migrations/migration-runner';

/**
 * Lists get a manual order. The backfill derives every value from existing columns (the order the
 * user created them in), never from the clock or today's defaults, so a database that upgrades a
 * year from now gets exactly what one upgrading today gets.
 */
export const ADD_LIST_SORT_ORDER: Migration = {
  version: 2,
  name: 'add-list-sort-order',
  up: (driver) => {
    driver.exec(`
ALTER TABLE lists ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0);
UPDATE lists SET sort_order = (SELECT COUNT(*) FROM lists AS earlier WHERE earlier.id < lists.id);
CREATE INDEX lists_by_sort_order ON lists (sort_order, id);
`);
  },
};
