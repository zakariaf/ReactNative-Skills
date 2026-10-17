// value-core-checks.mjs: the behaviour the app's value-object modules must show (a helper, not an
// entry point). Each check names the modules it needs, the rule id, the exported function it judges
// (for the line number) and the fix. The pinned vectors were computed by hand and cross-checked with
// an independent BigInt implementation; the random cases come from a seeded generator, so a failure
// is the same on every run. Module keys: currency, exponents, money, allocate, rate, text, store,
// units, instant (see MODULES in check-value-core.mjs).

const throwsRange = (assert, run, label) => assert.throws(run, RangeError, label);

/** A small seeded generator (mulberry32): the checker's random cases repeat on every machine. */
export function seededInts(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (min, max) => min + Math.floor(next() * (max - min + 1));
}

const isFailure = (result, kind) => result?.ok === false && result.error?.kind === kind;
const plain = (amount) => (amount === undefined ? undefined : { minor: amount.minor, currency: amount.currency });

const CHECK_CURRENCY = {
  rule: 'exponent-table', needs: ['currency', 'exponents'], fn: 'CURRENCY_EXPONENTS',
  fix: 'Regenerate src/core/money/currency-exponents.ts from the ISO 4217 list (the skill template is the current list); never edit an exponent by hand or take it from Intl/CLDR.',
  run({ currency, exponents }, assert, context) {
    const table = exponents.CURRENCY_EXPONENTS;
    assert.ok(table !== null && typeof table === 'object', 'CURRENCY_EXPONENTS is exported as an object');
    for (const [code, exponent] of Object.entries(table)) {
      assert.ok(code in context.iso, `${code} is not an ISO 4217 code with a minor unit`);
      assert.strictEqual(exponent, context.iso[code], `${code} has exponent ${context.iso[code]} in ISO 4217`);
      assert.strictEqual(currency.exponentOf(code), context.iso[code], `exponentOf('${code}')`);
    }
  },
};

const CHECK_UNKNOWN = {
  rule: 'unknown-currency', needs: ['currency'], fn: 'parseCurrencyCode',
  fix: "parseCurrencyCode returns err({ kind: 'unknown-currency', code }) for any code outside the table (look it up in a Map, not with `in`, which finds 'toString').",
  run({ currency }, assert) {
    assert.deepStrictEqual(currency.parseCurrencyCode('EUR'), { ok: true, value: 'EUR' }, "parseCurrencyCode('EUR')");
    for (const code of ['ZZZ', 'usd', 'XAU', 'XXX', 'toString', '']) {
      assert.ok(isFailure(currency.parseCurrencyCode(code), 'unknown-currency'), `parseCurrencyCode('${code}') is an unknown-currency failure`);
    }
  },
};

const CHECK_INTEGER = {
  rule: 'money-integer', needs: ['money'], fn: 'money',
  fix: 'money(minor, currency) throws a RangeError unless Number.isSafeInteger(minor).',
  run({ money }, assert) {
    assert.deepStrictEqual(plain(money.money(150, 'USD')), { minor: 150, currency: 'USD' }, 'money(150, USD)');
    for (const minor of [1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      throwsRange(assert, () => money.money(minor, 'USD'), `money(${minor}, 'USD') throws`);
    }
  },
};

const CHECK_CROSS = {
  rule: 'cross-currency', needs: ['money'], fn: 'addMoney',
  fix: 'addMoney, subtractMoney, sumMoney and compareMoney call assertSameCurrency first and build the result with money(), which refuses an unsafe sum.',
  run({ money: m }, assert) {
    const usd = m.money(100, 'USD');
    const eur = m.money(100, 'EUR');
    throwsRange(assert, () => m.addMoney(usd, eur), 'addMoney(USD, EUR) throws');
    throwsRange(assert, () => m.subtractMoney(usd, eur), 'subtractMoney(USD, EUR) throws');
    throwsRange(assert, () => m.compareMoney(usd, eur), 'compareMoney(USD, EUR) throws');
    throwsRange(assert, () => m.sumMoney([usd, eur], 'USD'), 'sumMoney([USD, EUR]) throws');
    throwsRange(assert, () => m.addMoney(m.money(Number.MAX_SAFE_INTEGER, 'JPY'), m.money(1, 'JPY')), 'an unsafe sum throws');
    assert.strictEqual(m.equalsMoney(usd, m.money(100, 'USD')), true, 'equalsMoney by value');
    assert.strictEqual(m.equalsMoney(usd, eur), false, 'equalsMoney across currencies is false');
    assert.deepStrictEqual(plain(m.sumMoney([], 'EUR')), { minor: 0, currency: 'EUR' }, 'sumMoney([]) is zero');
  },
};

const VECTORS = [
  [1001, [1, 1, 1], [334, 334, 333]],
  [660, [1584, 4033, 1933], [138, 353, 169]],
  [1510, [1584, 4033, 1933], [317, 807, 386]],
  [100, [1, 2, 3], [17, 33, 50]],
  [999, [333, 333, 334], [333, 333, 333]],
  [5, [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 0, 0]],
  [-1001, [1, 1, 1], [-334, -334, -333]],
  [90, [0, 0, 0], [30, 30, 30]],
  [10, [0, 1], [0, 10]],
];

const CHECK_VECTORS = {
  rule: 'allocate-vectors', needs: ['allocate'], fn: 'allocateMinor',
  fix: 'Largest remainder: floor every exact share (BigInt amount × weight / sum), then give the leftover minor units one each to the largest remainders, ties to the lower index; all-zero weights split evenly; a negative amount splits like its magnitude, negated.',
  run({ allocate }, assert) {
    for (const [amount, weights, expected] of VECTORS) {
      assert.deepStrictEqual(allocate.allocateMinor(amount, weights).map((part) => part + 0), expected, `allocateMinor(${amount}, [${weights}])`);
    }
  },
};

const CHECK_CONSERVATION = {
  rule: 'allocate-conservation', needs: ['allocate'], fn: 'allocateMinor',
  fix: 'Every split must sum to the amount, stay within one minor unit of each exact share, mirror negatives and repeat for the same input: compute in BigInt and hand out the leftover by remainder.',
  run({ allocate }, assert) {
    const int = seededInts(20261010);
    for (let round = 0; round < 400; round += 1) {
      // Half the rounds near zero, half near the safe-integer limit, where amount × weight passes
      // 2^53 and a float share loses its last digits.
      const limit = round % 2 === 0 ? 1_000_000 : 4_000_000_000_000_000;
      const amount = int(-limit, limit);
      const weights = Array.from({ length: int(1, 9) }, () => int(1, 1_000_000_000));
      const parts = allocate.allocateMinor(amount, weights);
      const label = `allocateMinor(${amount}, [${weights}])`;
      assert.strictEqual(parts.length, weights.length, `${label} returns one part per weight`);
      assert.strictEqual(parts.reduce((sum, part) => sum + part, 0), amount, `${label} sums to the amount`);
      // |part - amount × weight / total| < 1, compared in BigInt: amount × weight passes 2^53.
      const total = BigInt(weights.reduce((sum, weight) => sum + weight, 0));
      parts.forEach((part, index) => {
        const gap = BigInt(part) * total - BigInt(amount) * BigInt(weights[index]);
        assert.ok((gap < 0n ? -gap : gap) < total, `${label} part ${index} is within one minor unit of its share`);
      });
      assert.deepStrictEqual(allocate.allocateMinor(-amount, weights).map((part) => part + 0), parts.map((part) => -part + 0), `${label} mirrors the negative amount`);
      assert.deepStrictEqual(allocate.allocateMinor(amount, weights), parts, `${label} repeats`);
    }
  },
};

const CHECK_REFUSES = {
  rule: 'allocate-refuses', needs: ['allocate'], fn: 'allocateMinor',
  fix: 'allocateMinor throws a RangeError for no weights, a negative or fractional weight, or a fractional amount: each would lose or invent money.',
  run({ allocate }, assert) {
    throwsRange(assert, () => allocate.allocateMinor(100, []), 'no weights');
    // [2, -1] sums to 1, so only the weight check can stop it (it would hand out 200 and -100).
    throwsRange(assert, () => allocate.allocateMinor(100, [2, -1]), 'a negative weight');
    throwsRange(assert, () => allocate.allocateMinor(100, [0.5, 1]), 'a fractional weight');
    throwsRange(assert, () => allocate.allocateMinor(10.5, [1, 1]), 'a fractional amount');
  },
};

export const MONEY_CHECKS = [CHECK_CURRENCY, CHECK_UNKNOWN, CHECK_INTEGER, CHECK_CROSS, CHECK_VECTORS, CHECK_CONSERVATION, CHECK_REFUSES];
