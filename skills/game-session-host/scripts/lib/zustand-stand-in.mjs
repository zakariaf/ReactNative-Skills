// zustand-stand-in.mjs: a tiny stand-in for 'zustand' and 'zustand/vanilla', used only when the
// checker runs with --stand-ins on a repo without node_modules (its own self-test fixtures). It has
// zustand 5's vanilla createStore contract (getState, setState with merge, subscribe(listener with
// (state, previous)), getInitialState); useStore throws, since checkers never render. A real app
// run never uses it: there the repo's installed zustand loads. Not an entry point.

import { registerHooks } from 'node:module';

const SOURCE = `
const createStoreImpl = (createState) => {
  let state;
  const listeners = new Set();
  const setState = (partial, replace) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    if (Object.is(next, state)) return;
    const previous = state;
    state = replace ?? (typeof next !== 'object' || next === null) ? next : Object.assign({}, state, next);
    for (const listener of listeners) listener(state, previous);
  };
  const getState = () => state;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const api = { setState, getState, getInitialState: () => initial, subscribe };
  const initial = (state = createState(setState, getState, api));
  return api;
};
export const createStore = (createState) => (createState ? createStoreImpl(createState) : createStoreImpl);
export const useStore = () => {
  throw new Error('zustand stand-in: useStore cannot run in a checker');
};
`;

const URL = `data:text/javascript;base64,${Buffer.from(SOURCE).toString('base64')}`;
const NAMES = new Set(['zustand', 'zustand/vanilla']);
let registered = false;

/** Resolves zustand to the stand-in only when the repo cannot resolve it itself. */
export function registerZustandStandIn() {
  if (registered) return;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!NAMES.has(specifier)) return nextResolve(specifier, context);
      try {
        return nextResolve(specifier, context);
      } catch {
        return { url: URL, format: 'module', shortCircuit: true };
      }
    },
  });
  registered = true;
}
