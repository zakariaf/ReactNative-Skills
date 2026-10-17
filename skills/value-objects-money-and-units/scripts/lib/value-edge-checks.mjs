// value-edge-checks.mjs: behaviour of the modules where values cross a boundary (a helper, not an
// entry point): rates and conversions (the second rounding site), money text, store prices, units and
// instants. Same shape as value-core-checks.mjs: { rule, needs, fn, fix, run(modules, assert) }.

const isFailure = (result, kind) => result?.ok === false && result.error?.kind === kind;
const plain = (amount) => (amount === undefined ? undefined : { minor: amount.minor, currency: amount.currency });
const okMoney = (result) => (result?.ok === true ? plain(result.value) : result);

const CHECK_RATE = {
  rule: 'apply-rate', needs: ['money', 'rate'], fn: 'applyRate',
  fix: 'applyRate multiplies in BigInt and rounds once with the named mode (half-even: ties to even; half-expand: ties away from zero); parsePercent("8.25") is 825/10000; a non-integer rate throws.',
  run({ money: m, rate }, assert) {
    const vat = { numerator: 19, denominator: 100 };
    const tenth = { numerator: 1000, denominator: 10_000 };
    assert.deepStrictEqual(plain(rate.applyRate(m.money(1005, 'EUR'), vat, 'half-even')), { minor: 191, currency: 'EUR' }, '19 % of 10.05 EUR');
    assert.deepStrictEqual(plain(rate.applyRate(m.money(125, 'USD'), tenth, 'half-even')), { minor: 12, currency: 'USD' }, '10 % of 1.25 USD, half-even');
    assert.deepStrictEqual(plain(rate.applyRate(m.money(125, 'USD'), tenth, 'half-expand')), { minor: 13, currency: 'USD' }, '10 % of 1.25 USD, half-expand');
    assert.deepStrictEqual(plain(rate.applyRate(m.money(-125, 'USD'), tenth, 'half-expand')), { minor: -13, currency: 'USD' }, '10 % of -1.25 USD, half-expand');
    assert.deepStrictEqual(rate.parsePercent('8.25'), { ok: true, value: { numerator: 825, denominator: 10_000 } }, "parsePercent('8.25')");
    assert.throws(() => rate.applyRate(m.money(1, 'USD'), { numerator: 0.19, denominator: 1 }, 'trunc'), RangeError, 'a float numerator throws');
  },
};

const CHECK_CONVERT = {
  rule: 'convert-money', needs: ['money', 'rate'], fn: 'convertMoney',
  fix: 'convertMoney scales minor units by 10^(exponent of to - exponent of from) inside one exact division and rounds once.',
  run({ money: m, rate }, assert) {
    const jpyToUsd = { to: 'USD', perUnit: { numerator: 67, denominator: 10_000 } };
    const usdToKwd = { to: 'KWD', perUnit: { numerator: 3074, denominator: 10_000 } };
    assert.deepStrictEqual(plain(rate.convertMoney(m.money(1000, 'JPY'), jpyToUsd, 'half-even')), { minor: 670, currency: 'USD' }, '1000 JPY at 0.0067');
    assert.deepStrictEqual(plain(rate.convertMoney(m.money(1999, 'USD'), usdToKwd, 'half-even')), { minor: 6145, currency: 'KWD' }, '19.99 USD at 0.3074');
  },
};

const TEXT_VECTORS = [['1.50', 'USD', 150], ['1.5', 'USD', 150], ['125.00', 'KWD', 125_000], ['125', 'JPY', 125], ['12.345', 'KWD', 12_345], ['0.001', 'OMR', 1], ['12.345', 'IQD', 12_345], ['-0.05', 'EUR', -5]];

const CHECK_TEXT = {
  rule: 'parse-money', needs: ['text'], fn: 'parseMoney',
  fix: "parseMoney reads canonical ASCII decimal text into minor units with the currency's exponent, refuses more decimals ('too-many-decimals') and anything else ('not-a-decimal'); toDecimalString writes the exact text back.",
  run({ text }, assert) {
    for (const [input, currency, minor] of TEXT_VECTORS) {
      assert.deepStrictEqual(okMoney(text.parseMoney(input, currency)), { minor, currency }, `parseMoney('${input}', '${currency}')`);
    }
    assert.ok(isFailure(text.parseMoney('1.234', 'USD'), 'too-many-decimals'), "parseMoney('1.234', 'USD') refuses the extra decimal");
    assert.ok(isFailure(text.parseMoney('125.5', 'JPY'), 'too-many-decimals'), "parseMoney('125.5', 'JPY') refuses a decimal");
    for (const input of ['12.50xyz', '1,50', '١٢', '$1', '', '1e2', '0x10']) {
      assert.ok(isFailure(text.parseMoney(input, 'USD'), 'not-a-decimal'), `parseMoney('${input}') is not-a-decimal`);
    }
    const round = text.parseMoney('90071992547409.91', 'USD');
    assert.strictEqual(round.ok === true ? text.toDecimalString(round.value) : null, '90071992547409.91', 'toDecimalString of the largest safe amount is exact');
  },
};

const CHECK_STORE = {
  rule: 'store-price', needs: ['store'], fn: 'moneyFromStoreDouble',
  fix: 'Micros convert exactly (refusing a fraction of a minor unit); a store double rounds to the nearest minor unit only when the difference is double noise (< 1e-4 minor units).',
  run({ store }, assert) {
    assert.deepStrictEqual(okMoney(store.moneyFromMicros('1990000', 'EUR')), { minor: 199, currency: 'EUR' }, "moneyFromMicros('1990000', 'EUR')");
    assert.deepStrictEqual(okMoney(store.moneyFromMicros('120000000', 'JPY')), { minor: 120, currency: 'JPY' }, "moneyFromMicros('120000000', 'JPY')");
    assert.ok(isFailure(store.moneyFromMicros('1995000', 'EUR'), 'too-many-decimals'), 'micros between two cents are refused');
    assert.deepStrictEqual(okMoney(store.moneyFromStoreDouble(1.9899999999999998, 'EUR')), { minor: 199, currency: 'EUR' }, "StoreKit's 1.99 as a double");
    assert.ok(isFailure(store.moneyFromStoreDouble(1.999, 'USD'), 'too-many-decimals'), 'a double with a real third decimal is refused');
  },
};

const CHECK_UNITS = {
  rule: 'units-exact', needs: ['units'], fn: 'quantityFromDecimal',
  fix: 'Use the exact definitions as integer ratios (mile 1609344 mm, inch 254/10 mm, pound 45359237/100000 g, US gallon 3785411784/1000000 mL) and round half-even once into the canonical unit.',
  run({ units: u }, assert) {
    const value = (result) => (result?.ok === true ? result.value : result);
    assert.strictEqual(value(u.quantityFromDecimal(u.LENGTH, '1', 'mile')), 1_609_344, '1 mile in mm');
    assert.strictEqual(value(u.quantityFromDecimal(u.LENGTH, '10', 'inch')), 254, '10 inches in mm');
    assert.strictEqual(value(u.quantityFromDecimal(u.LENGTH, '0.25', 'centimeter')), 2, '0.25 cm rounds half-even to 2 mm');
    assert.strictEqual(value(u.quantityFromDecimal(u.LENGTH, '0.35', 'centimeter')), 4, '0.35 cm rounds half-even to 4 mm');
    assert.strictEqual(value(u.quantityFromDecimal(u.MASS, '100', 'pound')), 45_359, '100 lb in g');
    assert.strictEqual(value(u.quantityFromDecimal(u.VOLUME, '1', 'gallon')), 3785, '1 US gallon in mL');
    assert.strictEqual(u.quantityToDisplay(u.LENGTH, 1_609_344, 'mile'), 1, '1609344 mm shown in miles');
    assert.ok(isFailure(u.quantityFromDecimal(u.LENGTH, '1,5', 'meter'), 'not-a-decimal'), "'1,5' is not canonical decimal text");
  },
};

const AT = 1_791_621_000_000;

const CHECK_INSTANT = {
  rule: 'instant-parse', needs: ['instant'], fn: 'parseIsoInstant',
  fix: "parseIsoInstant accepts ISO 8601 with 'Z' or an offset only: a date alone is 'date-only', a time without an offset is 'missing-offset', impossible fields are 'not-an-instant'; toIsoInstant writes UTC with milliseconds.",
  run({ instant }, assert) {
    const value = (result) => (result?.ok === true ? result.value : result);
    assert.strictEqual(value(instant.parseIsoInstant('2026-10-10T08:30:00Z')), AT, "'Z'");
    assert.strictEqual(value(instant.parseIsoInstant('2026-10-10T10:30:00+02:00')), AT, "'+02:00'");
    assert.strictEqual(value(instant.parseIsoInstant('2026-10-10T03:00:00-0530')), AT, "'-0530'");
    assert.strictEqual(value(instant.parseIsoInstant('2026-10-10T08:30:00.250Z')), AT + 250, 'milliseconds');
    assert.ok(isFailure(instant.parseIsoInstant('2026-10-10'), 'date-only'), 'a date alone is a DateKey, not an instant');
    assert.ok(isFailure(instant.parseIsoInstant('2026-10-10T08:30:00'), 'missing-offset'), 'a time without an offset is refused');
    assert.ok(isFailure(instant.parseIsoInstant('2026-02-29T00:00:00Z'), 'not-an-instant'), '29 February 2026 does not exist');
    assert.strictEqual(instant.toIsoInstant(AT), '2026-10-10T08:30:00.000Z', 'toIsoInstant');
  },
};

export const EDGE_CHECKS = [CHECK_RATE, CHECK_CONVERT, CHECK_TEXT, CHECK_STORE, CHECK_UNITS, CHECK_INSTANT];
