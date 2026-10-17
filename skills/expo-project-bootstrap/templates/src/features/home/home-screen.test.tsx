// src/features/home/home-screen.test.tsx
// no-providers: the starter screen reads nothing from context (no copy, theme or store yet)
import { render, screen } from '@testing-library/react-native';

import { HomeScreen } from './home-screen';

describe('HomeScreen', () => {
  it('renders the starter screen under its testID', async () => {
    await render(<HomeScreen />);

    expect(screen.getByTestId('home.screen')).toBeOnTheScreen();
  });
});
