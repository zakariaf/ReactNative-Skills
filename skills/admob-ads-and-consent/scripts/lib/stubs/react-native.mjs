// Scripted stand-in for the two react-native members the consent adapter reads (Platform.OS and
// AppState), used only by check-ad-behaviour.mjs. The checker sets the platform and the app state
// and fires 'change' events. Not an entry point.

const listeners = new Set();

export const Platform = { OS: 'ios' };

export const AppState = {
  currentState: 'active',
  addEventListener(type, listener) {
    if (type !== 'change') throw new Error(`AppState.addEventListener('${type}') is not scripted`);
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  },
};

export const reactNativeStub = {
  reset({ os = 'ios', appState = 'active' } = {}) {
    Platform.OS = os;
    AppState.currentState = appState;
    listeners.clear();
  },
  /** The OS moves the app to another state (for example back to 'active'). */
  setAppState(next) {
    AppState.currentState = next;
    for (const listener of [...listeners]) listener(next);
  },
};
