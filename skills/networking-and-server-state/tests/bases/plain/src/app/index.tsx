// src/app/index.tsx: an offline app's home route (no network, no TanStack Query, no src/api).
import { NotesScreen } from '@/features/notes/notes-screen';

export default function NotesRoute(): React.JSX.Element {
  return <NotesScreen />;
}
