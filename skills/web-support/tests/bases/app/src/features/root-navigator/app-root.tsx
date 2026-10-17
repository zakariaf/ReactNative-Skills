// src/features/root-navigator/app-root.tsx
// Stand-in for app-startup-and-bootstrap's app root: it opens the database once, inside the storage gate.
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';

import { createExpoSqliteSqlDriver } from '@/data/expo-sqlite-sql-driver';
import { readLayoutDirection } from '@/i18n/direction';
import { syncDocumentLanguage } from '@/i18n/document-language';

import type { Services } from '@/services/create-device-services';

export function AppRoot(props: { readonly services: Services }): React.JSX.Element {
  const [database] = useState(() => createExpoSqliteSqlDriver('tasks.db'));
  useEffect(() => {
    syncDocumentLanguage('en');
  }, []);
  const animation = readLayoutDirection() === 'rtl' ? 'slide_from_left' : 'default';
  return <Stack screenOptions={{ headerShown: props.services.share !== null && database.path !== '', animation }} />;
}
