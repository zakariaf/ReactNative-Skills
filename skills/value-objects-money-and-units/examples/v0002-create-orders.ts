// src/data/migrations/v0002-create-orders.ts
// Version 2 of the app database (an example shape; frozen once it ships, like every step).
// Money is <name>_minor INTEGER with the currency once on the aggregate (the order); an instant is
// <name>_at_ms INTEGER; a local calendar day is a TEXT DateKey named <name>_on; a rate is integer
// basis points. STRICT tables refuse a REAL in an INTEGER column, so a float can never sneak in.
// No total column: the order total is derived from its lines on read (order-split.ts).
import type { Migration } from '@/data/migrations/migration-runner';

export const CREATE_ORDERS: Migration = {
  version: 2,
  name: 'create-orders',
  up: (driver) => {
    driver.exec(`
CREATE TABLE orders (
  id            INTEGER PRIMARY KEY,
  currency      TEXT    NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  tax_rate_bps  INTEGER NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tip_minor     INTEGER NOT NULL DEFAULT 0,
  due_on        TEXT,
  created_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE order_lines (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders (id),
  label            TEXT    NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  quantity         INTEGER NOT NULL CHECK (quantity >= 1)
) STRICT;
CREATE INDEX order_lines_by_order ON order_lines (order_id, id);
`);
  },
};
