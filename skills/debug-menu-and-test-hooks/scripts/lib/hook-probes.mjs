// hook-probes.mjs: behaviour probes for check-test-hooks (a helper, not an entry point). Each probe
// runs the app's own module, loaded through app-modules (Node type stripping), and returns the
// sentences that describe what it got wrong ([] when it behaves).
//
//   probeRegistry(registry)          the debug-link registry: strict parsing of every parameter
//   probeSimulatedClock(module)      createSimulatedClock(real, simulatedToday)
//   probeSimulatedConnectivity(module, hub)   createSimulatedConnectivity(real, isInitiallyOffline)

const isRefused = (result, kind) => result !== null && typeof result === 'object' && result.ok === false && result.error?.kind === kind;
const isAccepted = (result) => result !== null && typeof result === 'object' && result.ok === true;

/**
 * Values of one parameter that the registry must refuse: every unlisted candidate, including the
 * boolean aliases (`offline=true`) a lenient parser maps to 1 and 0.
 */
function badValuesFor(spec) {
  if (spec.kind === 'date') return ['2030-2-30', 'today', 'true'];
  const values = new Set(spec.values);
  const candidates = ['bogus', 'yes', 'no', 'true', 'false', 'on', '2', 'unknown-value'].filter((candidate) => !values.has(candidate));
  return candidates.length > 0 ? candidates : [`${spec.values.join('')}-not-listed`];
}

function goodValuesFor(spec) {
  return spec.kind === 'date' ? ['real', '2030-01-01'] : [...spec.values];
}

/**
 * The registry refuses an unknown parameter, a repeated one and a bad value of each parameter with
 * the typed failure kinds, and accepts every listed value. A registry that ignores a typo lets an
 * E2E flow test the wrong state and pass.
 */
export function probeRegistry({ DEBUG_LINK_PARAMS: params, parseDebugLink: parse }) {
  const problems = [];
  const call = (input) => {
    try {
      return parse(input);
    } catch (error) {
      return { threw: error instanceof Error ? error.message : String(error) };
    }
  };
  const unknown = call({ 'rnskills-unknown-param': '1' });
  if (!isRefused(unknown, 'debug-link-unknown-param')) problems.push(`an unknown parameter is not refused with debug-link-unknown-param (got ${JSON.stringify(unknown)})`);
  for (const [name, spec] of Object.entries(params)) {
    const [first] = goodValuesFor(spec);
    const repeated = call({ [name]: [first, first] });
    if (!isRefused(repeated, 'debug-link-repeated-param')) problems.push(`${name} given twice is not refused with debug-link-repeated-param (got ${JSON.stringify(repeated)})`);
    for (const bad of badValuesFor(spec)) {
      const refused = call({ [name]: bad });
      if (!isRefused(refused, 'debug-link-bad-value')) problems.push(`${name}=${bad} is not refused with debug-link-bad-value (got ${JSON.stringify(refused)})`);
    }
    for (const value of goodValuesFor(spec)) {
      const accepted = call({ [name]: value });
      if (!isAccepted(accepted)) problems.push(`${name}=${value} is listed but refused (got ${JSON.stringify(accepted)})`);
    }
  }
  return problems;
}

/** A ClockPort whose values the probe changes after the wrapper exists. */
function movableClock() {
  const now = { ms: 1_000, today: '2030-01-10', left: 600 };
  return { now, port: { nowMs: () => now.ms, today: () => now.today, msUntilNextLocalDay: () => now.left } };
}

/**
 * The simulated clock changes today() only, reads the simulated day on every call, and forwards
 * nowMs() and msUntilNextLocalDay() at call time (a captured value would freeze timers).
 */
export function probeSimulatedClock({ createSimulatedClock: create }) {
  const problems = [];
  const { now, port } = movableClock();
  let simulated = null;
  const clock = create(port, () => simulated);
  if (clock.today() !== '2030-01-10') problems.push(`with no simulated day, today() is ${JSON.stringify(clock.today())} instead of the real day`);
  simulated = '2031-06-15';
  if (clock.today() !== '2031-06-15') problems.push(`after the simulated day changed, today() is ${JSON.stringify(clock.today())}: read the simulated day on every call`);
  now.ms = 9_000;
  now.left = 42;
  if (clock.nowMs() !== 9_000) problems.push(`nowMs() is ${JSON.stringify(clock.nowMs())} after the real clock moved to 9000: forward the real nowMs() at call time, never a simulated or captured value`);
  if (clock.msUntilNextLocalDay() !== 42) problems.push(`msUntilNextLocalDay() is ${JSON.stringify(clock.msUntilNextLocalDay())} instead of the real 42: keep the real countdown so timers never jump`);
  simulated = null;
  now.today = '2030-01-11';
  if (clock.today() !== '2030-01-11') problems.push('clearing the simulated day does not return to the real calendar');
  return problems;
}

const PORT_MEMBERS = ['isOnline', 'subscribe', 'reachability', 'subscribeReachability'];

/**
 * The simulated connectivity is a full ConnectivityPort on the reachability hub: `none` while
 * simulating offline, the real reachability otherwise, isOnline derived from it, unchanged reports
 * dropped, and stop() unsubscribes from the real adapter.
 */
export function probeSimulatedConnectivity({ createSimulatedConnectivity: create }, { createReachabilityHub }) {
  const problems = [];
  const real = createReachabilityHub('reachable');
  const before = real.listenerCount();
  const simulated = create(real.port, false);
  const port = simulated?.port ?? simulated;
  const missing = PORT_MEMBERS.filter((member) => typeof port?.[member] !== 'function');
  if (missing.length > 0) return [`the simulated port lacks ${missing.join(', ')}: every ConnectivityPort reader (TanStack Query's onlineManager, banners, ads, purchases) needs all four members`];
  if (typeof simulated.setOffline !== 'function') return ['there is no setOffline(isOffline) to switch the simulation'];
  const online = [];
  const reach = [];
  port.subscribe((value) => online.push(value));
  port.subscribeReachability((value) => reach.push(value));
  if (port.reachability() !== 'reachable') problems.push(`before any switch it reports ${JSON.stringify(port.reachability())} instead of the real 'reachable'`);
  simulated.setOffline(true);
  if (port.isOnline() !== false || port.reachability() !== 'none') problems.push(`while simulating offline it reports isOnline ${JSON.stringify(port.isOnline())} and ${JSON.stringify(port.reachability())} instead of false and 'none'`);
  real.report('unvalidated');
  if (port.reachability() !== 'none') problems.push('a real network change leaks through while offline is simulated');
  simulated.setOffline(true);
  simulated.setOffline(false);
  if (port.reachability() !== 'unvalidated') problems.push(`after the simulation ends it reports ${JSON.stringify(port.reachability())} instead of the real 'unvalidated'`);
  if (JSON.stringify(online) !== JSON.stringify([false, true])) problems.push(`isOnline listeners heard ${JSON.stringify(online)} instead of [false, true]: derive isOnline from reachability and drop unchanged reports (build on createReachabilityHub)`);
  if (JSON.stringify(reach) !== JSON.stringify(['none', 'unvalidated'])) problems.push(`reachability listeners heard ${JSON.stringify(reach)} instead of ["none","unvalidated"]`);
  real.report('reachable');
  if (port.reachability() !== 'reachable') problems.push('a real network change is not forwarded once the simulation ends');
  if (typeof simulated.stop === 'function') {
    simulated.stop();
    if (real.listenerCount() !== before) problems.push('stop() leaves a listener on the real adapter');
  } else {
    problems.push('there is no stop() to release the real adapter');
  }
  return problems;
}
