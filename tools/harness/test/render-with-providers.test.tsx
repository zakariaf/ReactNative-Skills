// test/render-with-providers.test.tsx — the helper's own test, and the model for every component
// and hook test: await every call, query by role and name, press through userEvent.setup(), use
// findBy* for what appears later and queryBy* only to prove absence, pass fakes as services, and
// change state from outside React inside act().
import { useQuery } from '@tanstack/react-query';
import { act, screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Pressable, Text, View } from 'react-native';

import { useDirection } from '@/i18n/direction-context';
import { useLanguage } from '@/i18n/language-context';
import { createFakeClock } from '@/services/clock/fake-clock';
import { useServices } from '@/services/services-context';

import {
  createProvidersWrapper,
  renderHookWithProviders,
  renderWithProviders,
} from './render-with-providers';

import type { ReactNode } from 'react';

const TASKS_KEY = ['tasks'] as const;

type TaskLoaderProps = { readonly load: () => Promise<readonly string[]> };

/** A screen-sized probe: a button that loads task titles through a query and lists them. */
function TaskLoader({ load }: TaskLoaderProps): ReactNode {
  const [isEnabled, setIsEnabled] = useState(false);
  const tasks = useQuery({ queryKey: TASKS_KEY, queryFn: load, enabled: isEnabled });
  const handleLoad = (): void => {
    setIsEnabled(true);
  };
  return (
    <View>
      <Pressable accessibilityRole="button" onPress={handleLoad}>
        <Text>Load tasks</Text>
      </Pressable>
      {tasks.data?.map((title) => (
        <Text key={title}>{title}</Text>
      ))}
    </View>
  );
}

/** A probe that reads a port through the app's ServicesProvider. */
function TodayLabel(): ReactNode {
  const { clock } = useServices();
  return <Text>{clock.today()}</Text>;
}

describe('renderWithProviders', () => {
  it('shows what a query loads after a press', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<TaskLoader load={() => Promise.resolve(['Buy milk'])} />);

    await user.press(screen.getByRole('button', { name: 'Load tasks' }));

    expect(await screen.findByText('Buy milk')).toBeOnTheScreen();
  });

  it('proves absence with queryBy and loads nothing before the press', async () => {
    const load = jest.fn(() => Promise.resolve(['Buy milk']));
    await renderWithProviders(<TaskLoader load={load} />);

    expect(screen.queryByText('Buy milk')).not.toBeOnTheScreen();
    expect(load).not.toHaveBeenCalled();
  });

  it('updates the screen when state changes outside React', async () => {
    const { queryClient } = await renderWithProviders(
      <TaskLoader load={() => Promise.resolve([])} />,
    );

    await act(() => {
      queryClient.setQueryData(TASKS_KEY, ['Answer email']);
    });

    // TanStack Query tells its observers on a timer, so the new data appears a tick later.
    expect(await screen.findByText('Answer email')).toBeOnTheScreen();
  });

  it('fails the test when a message is missing from the catalog', async () => {
    await expect(renderWithProviders(<FormattedMessage id="tasks.empty-title" />)).rejects.toThrow(
      /tasks\.empty-title/,
    );
  });

  it('hands the ports the test gives to the tree and back to the test', async () => {
    const clock = createFakeClock({ nowMs: 0, today: '2026-10-03' });
    const { services } = await renderWithProviders(<TodayLabel />, { services: { clock } });

    expect(screen.getByText('2026-10-03')).toBeOnTheScreen();
    expect(services.clock).toBe(clock);
  });

  it('fails the test when the tree uses a port the test did not give', async () => {
    // React reports the render error through console.error; keep the output readable.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(renderWithProviders(<TodayLabel />)).rejects.toThrow(
      'services.clock.today was used, but the test gave no clock port',
    );
  });
});

describe('createProvidersWrapper', () => {
  it('builds a fresh tree with its own state for every test', () => {
    const first = createProvidersWrapper();
    first.queryClient.setQueryData(TASKS_KEY, ['Buy milk']);

    expect(createProvidersWrapper().queryClient.getQueryData(TASKS_KEY)).toBeUndefined();
  });
});

describe('renderHookWithProviders', () => {
  it('renders a hook inside the same providers as a component', async () => {
    const { result } = await renderHookWithProviders(() => useIntl().locale);

    expect(result.current).toBe('en');
  });

  it('renders in the language a test picks, laid out in its direction unless told otherwise', async () => {
    const useLocaleProbe = (): readonly string[] => [
      useLanguage(),
      useIntl().locale,
      useDirection(),
    ];
    const { result: arabic } = await renderHookWithProviders(useLocaleProbe, { language: 'ar' });
    const { result: beforeRestart } = await renderHookWithProviders(useLocaleProbe, {
      language: 'ar',
      direction: 'ltr',
    });

    expect(arabic.current).toStrictEqual(['ar', 'ar-u-nu-arab', 'rtl']);
    expect(beforeRestart.current).toStrictEqual(['ar', 'ar-u-nu-arab', 'ltr']);
  });
});
