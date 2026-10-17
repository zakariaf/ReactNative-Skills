// src/hooks/use-permission-gate.test.ts — the ask flow as a person on each OS meets it, through
// the scripted fake (fake-permissions.ts). The foreground source is real (AppState): the
// mirror's own tests cover the return from Settings.
import { act } from '@testing-library/react-native';

import { createFakePermissionAccess } from '@/services/permissions/fake-permissions';
import { renderHookWithProviders } from '@test/render-with-providers';

import { usePermissionGate } from './use-permission-gate';

import type { FakePermissionScript } from '@/services/permissions/fake-permissions';

type Setup = {
  readonly script: FakePermissionScript;
  readonly shouldExplainFirst?: boolean;
};

async function mountGate({ script, shouldExplainFirst = false }: Setup) {
  const access = createFakePermissionAccess(script);
  const openSettings = jest.fn(() => Promise.resolve());
  const onError = jest.fn();
  const onAllowed = jest.fn();
  const view = await renderHookWithProviders(() =>
    usePermissionGate({ access, openSettings, shouldExplainFirst, onError }),
  );
  const press = async (): Promise<void> => {
    await act(async () => {
      view.result.current.requestAccess(onAllowed);
      await Promise.resolve();
    });
  };
  const tap = async (action: 'confirm' | 'dismiss' | 'openSettings'): Promise<void> => {
    await act(async () => {
      view.result.current[action]();
      await Promise.resolve();
    });
  };
  return { view, access, openSettings, onError, onAllowed, press, tap };
}

describe('usePermissionGate', () => {
  it('runs the action at once when the permission is granted, without a dialog', async () => {
    const gate = await mountGate({ script: { platform: 'ios', state: 'granted' } });

    await gate.press();

    expect(gate.onAllowed).toHaveBeenCalledTimes(1);
    expect(gate.access.dialogs()).toBe(0);
    expect(gate.view.result.current.sheet).toBeNull();
  });

  it('treats limited access as allowed (iOS Select Photos)', async () => {
    const gate = await mountGate({ script: { platform: 'ios', state: 'limited' } });

    await gate.press();

    expect(gate.onAllowed).toHaveBeenCalledTimes(1);
  });

  it('asks straight away when the control explains the need, then runs the action', async () => {
    const gate = await mountGate({ script: { platform: 'ios', answers: ['allow'] } });

    await gate.press();

    expect(gate.access.dialogs()).toBe(1);
    expect(gate.onAllowed).toHaveBeenCalledTimes(1);
    expect(gate.view.result.current.state).toBe('granted');
  });

  it('explains first, and only its one button opens the dialog', async () => {
    const gate = await mountGate({
      script: { platform: 'ios', answers: ['allow'] },
      shouldExplainFirst: true,
    });

    await gate.press();
    expect(gate.view.result.current.sheet).toBe('explain');
    expect(gate.access.dialogs()).toBe(0);
    await gate.tap('confirm');

    expect(gate.view.result.current.sheet).toBeNull();
    expect(gate.access.dialogs()).toBe(1);
    expect(gate.onAllowed).toHaveBeenCalledTimes(1);
  });

  it('respects a refusal: no sheet follows and the action never runs', async () => {
    const gate = await mountGate({ script: { platform: 'ios' } });

    await gate.press();

    expect(gate.view.result.current.state).toBe('blocked');
    expect(gate.view.result.current.sheet).toBeNull();
    expect(gate.onAllowed).not.toHaveBeenCalled();
  });

  it('shows the Android rationale before asking again, and "No thanks" asks nothing', async () => {
    const gate = await mountGate({ script: { platform: 'android', state: 'denied' } });

    await gate.press();
    expect(gate.view.result.current.sheet).toBe('rationale');
    await gate.tap('dismiss');

    expect(gate.view.result.current.sheet).toBeNull();
    expect(gate.access.dialogs()).toBe(0);
    expect(gate.onAllowed).not.toHaveBeenCalled();
  });

  it('shows the second and last Android dialog after "Continue" on the rationale', async () => {
    const gate = await mountGate({
      script: { platform: 'android', state: 'denied', answers: ['allow'] },
    });

    await gate.press();
    await gate.tap('confirm');

    expect(gate.access.dialogs()).toBe(1);
    expect(gate.onAllowed).toHaveBeenCalledTimes(1);
  });

  it('offers the Settings app when blocked, instead of a dialog that cannot appear', async () => {
    const gate = await mountGate({ script: { platform: 'ios', state: 'blocked' } });

    await gate.press();
    expect(gate.view.result.current.sheet).toBe('settings');
    await gate.tap('openSettings');

    expect(gate.openSettings).toHaveBeenCalledTimes(1);
    expect(gate.view.result.current.sheet).toBeNull();
    expect(gate.access.dialogs()).toBe(0);
    expect(gate.onAllowed).not.toHaveBeenCalled();
  });

  it('says so when unavailable and never asks', async () => {
    const gate = await mountGate({ script: { platform: 'android', state: 'unavailable' } });

    await gate.press();

    expect(gate.view.result.current.sheet).toBe('unavailable');
    expect(gate.access.dialogs()).toBe(0);
  });

  it('ignores a second press while the first ask is in progress', async () => {
    const gate = await mountGate({ script: { platform: 'android', answers: ['allow'] } });

    await act(async () => {
      gate.view.result.current.requestAccess(gate.onAllowed);
      gate.view.result.current.requestAccess(gate.onAllowed);
      await Promise.resolve();
    });

    expect(gate.access.dialogs()).toBe(1);
    expect(gate.onAllowed).toHaveBeenCalledTimes(1);
    expect(gate.view.result.current.isAsking).toBe(false);
  });

  it('hands a failure to onError and frees the control again', async () => {
    const failure = new Error('read failed');
    const access = { permission: () => Promise.reject(failure), requestPermission: jest.fn() };
    const onError = jest.fn();
    const view = await renderHookWithProviders(() =>
      usePermissionGate({ access, openSettings: jest.fn(), shouldExplainFirst: false, onError }),
    );

    await act(async () => {
      view.result.current.requestAccess(jest.fn());
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith(failure);
    expect(view.result.current.isAsking).toBe(false);
  });
});
