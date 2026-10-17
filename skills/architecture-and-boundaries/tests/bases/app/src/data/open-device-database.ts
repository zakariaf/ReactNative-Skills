// The data layer's device opener: the composition root calls it once and hands the driver down.
import { createExpoSqliteSqlDriver } from './expo-sqlite-sql-driver';

import type { SqlDriver } from './sql-driver';

export function openDeviceDatabase(): SqlDriver {
  return createExpoSqliteSqlDriver('tasks.db');
}
