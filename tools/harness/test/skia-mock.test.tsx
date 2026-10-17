// test/skia-mock.test.tsx — proves the central Skia mock in jest.setup.ts (an app that depends on
// @shopify/react-native-skia keeps this test; without the mock, importing Skia crashes the suite).
import { Canvas, Path } from '@shopify/react-native-skia';
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from './render-with-providers';

describe('the central Skia mock', () => {
  it('renders Skia drawings as inert elements that keep their accessibility props', async () => {
    await renderWithProviders(
      <Canvas accessible accessibilityRole="image" accessibilityLabel="Task progress ring">
        <Path path="M0 0H8V8Z" />
      </Canvas>,
    );

    expect(screen.getByRole('image', { name: 'Task progress ring' })).toBeOnTheScreen();
  });
});
