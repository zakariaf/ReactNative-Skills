// test/render-with-providers.tsx
import { render } from '@testing-library/react-native';

export async function renderWithProviders(element: React.JSX.Element): Promise<void> {
  await render(element);
}
