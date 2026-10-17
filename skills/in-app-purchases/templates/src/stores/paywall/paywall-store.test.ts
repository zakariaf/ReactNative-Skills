// src/stores/paywall/paywall-store.test.ts
import { createPaywallStore } from '@/stores/paywall/paywall-store';

describe('paywall store', () => {
  it('starts loading and moves through the reducer', () => {
    const store = createPaywallStore();
    expect(store.getState().flow).toStrictEqual({ kind: 'loading' });
    store.getState().dispatch({ type: 'set-price', price: '$2.99' });
    expect(store.getState().flow).toStrictEqual({ kind: 'ready', price: '$2.99' });
  });

  it('publishes nothing for an action that changes nothing', () => {
    const store = createPaywallStore();
    const listener = jest.fn();
    store.subscribe(listener);
    store.getState().dispatch({ type: 'clear-thanks' });
    expect(listener).not.toHaveBeenCalled();
  });
});
