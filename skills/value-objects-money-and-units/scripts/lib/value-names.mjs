// value-names.mjs: how the checkers recognise money, physical quantities and instants by name (a
// helper, not an entry point). Names are split into lower-case segments ("totalPriceMinor" ->
// total, price, minor; "price_minor" -> price, minor), then judged by the words they hold and by
// their last segment, which says the unit. The word lists are the skill's contract: an app whose
// domain uses one of these words for something that is not money adds the allow marker
// ("// value-objects-allow <rule>: <why>") on the line or the line above.

/** Words that make a name an amount of money. 'total', 'credit' and 'charge' are left out on purpose (task totals, battery charge). */
export const MONEY_WORDS = new Set([
  'price', 'prices', 'amount', 'amounts', 'cost', 'costs', 'subtotal', 'subtotals', 'balance', 'balances',
  'fee', 'fees', 'tax', 'taxes', 'tip', 'tips', 'discount', 'discounts', 'refund', 'refunds', 'payment',
  'payments', 'payout', 'payouts', 'salary', 'wage', 'wages', 'budget', 'revenue', 'spend', 'spent',
  'earnings', 'fare', 'fares', 'deposit', 'deposits', 'money', 'cash', 'cent', 'cents',
]);

/** Last segments that make a money name the canonical integer: minor units, or a store's micros. */
export const MONEY_UNIT_SUFFIXES = new Set(['minor', 'micros']);

/** Last segments that say a money-worded name is not an amount (a rate, a count, an id, text, an instant). */
export const NOT_AN_AMOUNT = new Set([
  'rate', 'rates', 'percent', 'pct', 'bps', 'ratio', 'factor', 'count', 'id', 'ids', 'key', 'keys', 'label',
  'text', 'name', 'index', 'type', 'kind', 'code', 'currency', 'display', 'formatted', 'title',
  'description', 'mode', 'at', 'ms', 'date', 'day', 'days', 'level', 'step', 'steps', 'tier', 'url', 'sku',
  'status', 'category', 'string', 'enabled', 'visible', 'shown', 'error', 'failure', 'message', 'schema',
]);

/** Words that make a name a physical quantity or a length of time. Layout words (width, height, size, volume) are left out. */
export const PHYSICAL_WORDS = new Set([
  'duration', 'timeout', 'delay', 'interval', 'elapsed', 'ttl', 'age', 'distance', 'weight', 'mass',
  'temperature', 'speed', 'altitude', 'elevation',
]);

/** Last segments that name a unit, or say the value has none (a ratio, a count, an index). */
export const UNIT_SUFFIXES = new Set([
  'ms', 'millis', 'milliseconds', 's', 'sec', 'secs', 'seconds', 'min', 'mins', 'minutes', 'h', 'hours', 'days',
  'weeks', 'months', 'years', 'deg', 'degrees', 'mm', 'cm', 'm', 'meters', 'metres', 'km', 'g', 'grams', 'kg', 'mg', 'ml', 'l', 'bytes', 'kb', 'mb',
  'c', 'celsius', 'k', 'kelvin', 'mps', 'kmh', 'percent', 'ratio', 'factor', 'count', 'index', 'id', 'steps',
  'frames', 'ticks', 'label', 'text', 'unit', 'key', 'kind', 'type', 'name',
]);

/** "totalPriceMinor" -> ['total', 'price', 'minor']; "price_minor" -> ['price', 'minor']; "URLText" -> ['url', 'text']. */
export function segmentsOf(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_$]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

const last = (segments) => segments[segments.length - 1] ?? '';

/** Words that, right before 'amount', make it a UI or motion quantity ("blurAmount", "scrollAmount"), not money. */
export const NOT_MONEY_AMOUNT = new Set([
  'blur', 'scroll', 'shake', 'offset', 'rotation', 'rotate', 'scale', 'zoom', 'opacity', 'fade', 'slide',
  'swipe', 'drag', 'pan', 'tilt', 'spin', 'bounce', 'parallax', 'translate', 'padding', 'inset', 'shadow',
  'vibration', 'jitter', 'wobble', 'overscroll',
]);

function isMoneyWordAt(segments, index) {
  const segment = segments[index];
  if (!MONEY_WORDS.has(segment)) return false;
  return !(segment === 'amount' || segment === 'amounts') || !NOT_MONEY_AMOUNT.has(segments[index - 1] ?? '');
}

/**
 * A name that holds an amount of money ("price", "taxMinor", "order_total_price", "totalMinor",
 * "chargedMinor"), rates and ids excluded. A '<what>Minor' or '<what>Micros' name is money by its
 * unit, whatever <what> is, because the skill names every plain money number that way; a bare
 * 'total' or 'charge' is not (task totals, battery charge).
 */
export function isMoneyName(name) {
  const segments = segmentsOf(name);
  if (segments.length > 1 && MONEY_UNIT_SUFFIXES.has(last(segments))) return true;
  if (!segments.some((_, index) => isMoneyWordAt(segments, index))) return false;
  return !NOT_AN_AMOUNT.has(last(segments));
}

/** A money name whose last segment says minor units or micros. */
export function isMinorUnitName(name) {
  return MONEY_UNIT_SUFFIXES.has(last(segmentsOf(name)));
}

/** A physical-quantity name ("durationMs", "distance") whose last segment names no unit. */
export function lacksUnit(name) {
  const segments = segmentsOf(name);
  if (!segments.some((segment) => PHYSICAL_WORDS.has(segment))) return false;
  return !UNIT_SUFFIXES.has(last(segments));
}

/** An instant name: "createdAt", "remindAtMs", "lastSyncTimestamp", "at_ms". A bare "at" (a step, a version) is not one. */
export function isInstantName(name) {
  const segments = segmentsOf(name);
  const end = last(segments);
  if (end === 'timestamp' || (end === 'at' && segments.length > 1)) return true;
  return end === 'ms' && segments[segments.length - 2] === 'at';
}

/** The last identifier of a member chain: "order.items[0].price" -> "price", "amount?.minor" -> "minor". */
export function lastIdentifier(chain) {
  const match = /([A-Za-z_$][\w$]*)\s*$/.exec(chain);
  return match === null ? '' : match[1];
}

/** True when a member chain ends in a money name or in `.minor` (a Money's integer). */
export function isMoneyChain(chain) {
  const name = lastIdentifier(chain);
  return name === 'minor' || isMoneyName(name);
}
