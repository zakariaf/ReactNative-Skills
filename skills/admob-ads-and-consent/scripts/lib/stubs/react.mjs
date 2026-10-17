// Minimal stand-in for 'react' when check-ad-behaviour.mjs runs the ads adapter under Node:
// createElement returns a plain { type, props } record the checker can inspect, and
// useSyncExternalStore reads the store's current value (the checker renders one component by
// calling it, so a hook-reading component shows what it would draw now). Not an entry point.

export function createElement(type, props) {
  return { type, props };
}

export function useSyncExternalStore(_subscribe, getSnapshot) {
  return getSnapshot();
}

export default { createElement, useSyncExternalStore };
