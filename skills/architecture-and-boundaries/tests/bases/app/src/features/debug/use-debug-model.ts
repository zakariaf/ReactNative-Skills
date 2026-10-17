import { useServices } from '@/services/services-context';

export function useDebugModel(): { readonly label: string } {
  const { clock } = useServices();
  return { label: `debug ${clock.today()}` };
}
