# The seeded RNG, seeds and salts

The one PRNG every seeded output draws from, how a key becomes a seed, why the seed must be mixed,
how draws are threaded, and the golden values that make all of it a compatibility contract, with
the independent oracle that computed them.

## Contents

- Why sfc32, and why the app owns it
- The API (`src/core/rng/sfc32.ts`)
- From a key to a seed: hash, salt, mix
- The unmixed-seed trap, in numbers
- Salts: one per feature and mode, frozen
- Threading the state; draw order is a contract
- Seeded draws (`src/core/rng/seeded-draws.ts`)
- Stateless per-index randomness
- The UI thread
- The golden values
- How the goldens were computed (the independent oracle)
- Testing the RNG

## Why sfc32, and why the app owns it

sfc32 (Chris Doty-Humphrey's "small fast counting" generator from PractRand) has 128 bits of state,
passes PractRand, and uses only 32-bit integer operations (`+`, `^`, shifts, `| 0`, `>>> 0`). Integer
operations are exactly specified by ECMA-262, so V8 (Jest, Node), Hermes on iOS and Hermes on Android
produce the same sequence, bit for bit. The state is four plain numbers, so it serialises to JSON and
can be stored in a game state or a replay.

The app owns it (a template file, not a package) because a library PRNG promises nothing about its
sequence across versions: a minor upgrade that "improves" the generator would silently change every
seeded output. `Math.random` cannot be seeded at all and its algorithm is implementation-defined
(ECMA-262: "using an implementation-defined algorithm or strategy").

## The API (`src/core/rng/sfc32.ts`)

| Function | Use |
|---|---|
| `seedRng(seed)` | A warmed-up `RngState` from any integer seed: four `mix32(seed + k * 0x9e3779b9)` words, then 12 discarded draws. This is the mix step every derived seed passes. |
| `nextU32(state)` | `{ value: 0 … 2^32-1, state }`. No hidden mutation: the caller keeps the next state. |
| `nextInt(state, n)` | Unbiased integer in `[0, n)`, `n` in 1 … 2^32, by rejection sampling: the top `2^32 mod n` values are redrawn, so `% n` is never biased. |
| `nextUnit(state)` | `[0, 1)` as `value / 2^32` (division by a power of two is exact). |
| `hashSeed(text)` | FNV-1a 32 over UTF-16 code units: a text key into a seed. Not mixed. |
| `mix32(x)` / `hashU32(a, b)` | The murmur3 finaliser, and a stateless mixed hash of two integers. |

Never edit this file. A different generator (more state, a faster one, a 64-bit one) is a new module
under a new name, used by a new generator version from a future cutover key; existing versions keep
calling sfc32.

## From a key to a seed: hash, salt, mix

```
key ('2026-09-26')  --dailySeed(key, salt)-->  uint32  --seedRng-->  RngState  --nextInt / drawSample-->  output
key ('share:7KQ2')  --hashSeed(key) ^ salt-->  uint32  --seedRng-->  RngState  --...
```

- `dailySeed(dateKey, salt)` (`src/core/dates/daily-seed.ts`) is FNV-1a over the civil-date key with
  the salt XORed into the offset basis. `hashSeed(text)` is the same hash without a salt.
- Both are **hashes, not random numbers**: always pass them through `seedRng` before drawing. The
  mixing in `seedRng` (murmur3 finaliser on four spread words plus 12 warm-up draws) is what turns
  "differs by one character" into "unrelated".
- A second independent stream from the same key gets its own salt (`dailySeed(key, SALT_B)`), never
  "the next draws after stream A": stream B would then change whenever stream A's draw count changes.

## The unmixed-seed trap, in numbers

Most consecutive days differ only in the last character of the key, and FNV-1a's last step is one
XOR with that character and one multiply by the FNV prime P (`0x01000193`). Two such keys therefore
get seeds that differ by a small odd multiple of P, modulo 2^32: exactly plus or minus P when the two
digits differ only in bit 0 (`0`/`1`, `2`/`3`, `4`/`5`, `6`/`7`, `8`/`9`: every other pair of
neighbouring days), and plus or minus 3P to 15P otherwise (`7` to `8` flips four bits):

```
dailySeed('2026-09-26', 17) = 2599028541
dailySeed('2026-09-27', 17) = 2582250922      difference: -16777619 = minus P
dailySeed('2026-09-28', 17) = 2364141875      difference: -13 × P (mod 2^32)
```

`CATALOG[dailySeed(key, salt) % 12]` therefore walks the catalog in a visible pattern:
`dailySeed(key, 17) % 12` for 2026-09-01 … 09 reads 2, 3, 4, 9, 10, 11, 0, 5, 6, and for 2026-09-10 … 19
reads 8, 7, 6, 5, 4, 3, 2, 1, 0, 11. The pick moves one item forward (or back) on most days, with an
occasional jump, and users notice within a week (verified on 2026-10-03 with the Python oracle below;
re-verify with `print([daily_seed('2026-09-%02d' % d, 17) % 12 for d in range(1, 20)])`). After
`seedRng`, the first draws of 60
consecutive days are 60 unrelated values (the template's generator test checks this, and
`daily-seed.test.ts` pins the difference above so nobody "fixes" the hash instead).
`check-determinism.mjs` flags `dailySeed(...) % n`, `hashSeed(...) & mask` and a variable holding one
of them used with `%`, `&` or `>>` (rule `unmixed-seed`).

## Salts: one per feature and mode, frozen

- Each seeded feature has its own salt constant (`DAILY_FOCUS_SALT = 0x2f6b4c1d`); two features with
  one salt draw the same sequence for the same day and their outputs move together. A mode inside a
  feature (easy/hard, a second list) gets its own salt or a documented derivation (`SALT ^ 0x1`).
- A salt is frozen on first ship. Changing it changes every key's output: it is a version cutover
  (`versioning-and-regeneration.md`), never a tweak.
- `contracts/seeded-generators.json` records each shipped salt; `check-golden-vectors.mjs` fails when
  the exported salt differs from the record or two generators share one (rule `salt-frozen`).
- Pick a salt once with any random 32-bit value (for example `node -e "console.log('0x' +
  crypto.randomBytes(4).toString('hex'))"` on your machine), then freeze it.

## Threading the state; draw order is a contract

- Functions take a state and return `{ value, state }`. A module-level RNG object, a `let state` at
  file level, or a reseed from a counter makes output depend on what ran before.
- The **order and number of draws** is part of the output. Swapping two draws, adding a draw "just to
  pick a colour", or drawing inside a loop whose length changed rewrites every output after that
  point. Comment the draw sequence in each generator version (`// Draw order: one drawSample of 3`).
- A vectors diff in a refactor is a defect until proven otherwise: find the draw that moved.
- Games carry `rng: RngState` in their state and thread it through every move (game-rules-engine);
  a real-time sim keeps the four words in a typed array (realtime-game-loop). The rules here apply.

## Seeded draws (`src/core/rng/seeded-draws.ts`)

The template's list helpers state exactly how many `nextInt` calls they make, in which order, because
that is what an independent oracle must reproduce:

| Function | Draws, in order |
|---|---|
| `drawOne(items, state)` | one `nextInt(n)` |
| `shuffle(items, state)` | Durstenfeld from the end: for `i = n-1 … 1`, `j = nextInt(i + 1)`, swap `i`, `j`: `n - 1` draws |
| `drawSample(items, k, state)` | partial Fisher-Yates from the front: for `i = 0 … k-1`, `j = i + nextInt(n - i)`, swap: exactly `k` draws (including the last `nextInt(1)` when `k = n`) |

`shuffle` then `slice(0, k)` is a different output from `drawSample(k)`; pick one per generator
version and keep it. Never `items.sort(() => rng() - 0.5)`: a comparator that is not consistent gives
engine-specific results (ECMA-262 makes such a sort order implementation-defined).

## Stateless per-index randomness

When each item needs its own stable random value and no stream exists (a per-task reminder offset, a
tile variant, a particle direction), use `hashU32(itemSeed, salt)`: it is mixed, needs no state, and
gives the same value whatever else ran. `examples/reminder-jitter.ts` spreads reminders over a window
this way. Do not use `hashSeed(id) % n` directly (unmixed, see above).

## The UI thread

`sfc32.ts` starts with a file-level `'worklet';` directive, so the Worklets Babel plugin turns every
top-level function into a worklet that a frame callback can call on the UI thread (verified on
2026-10-03 with react-native-worklets 0.10.1 and babel-preset-expo 57.0.13 in an Expo SDK 57 app:
`babel.transformSync` produced 7 worklets, one per function). Re-verify from the app's root; the
`caller` makes babel-preset-expo transform the file as Metro does for iOS, and the output is compact,
so count `__workletHash`, not `__workletHash =`:

```sh
node -e "const b=require('@babel/core');const f=require('path').resolve('src/core/rng/sfc32.ts');console.log((b.transformSync(require('fs').readFileSync(f,'utf8'),{filename:f,caller:{name:'metro',platform:'ios'}}).code.match(/__workletHash/g)||[]).length)"
```

It prints `7`. On the JS thread the directive changes nothing. `seeded-draws.ts`,
`daily-seed.ts` and `fingerprint.ts` are not worklets: call them on the JS thread, or give a sim its
own worklet helpers (realtime-game-loop). `check-determinism.mjs` fails when the directive is removed.

## The golden values

Pinned in the canonical tests and repeated by `check-determinism.mjs`. A change to any of them changes
every seeded output on every installed copy of the app.

| Call | Golden value |
|---|---|
| `seedRng(1)`, first five `nextU32` values | `1828152527, 3394835397, 2967886022, 2251045104, 4148684523` |
| `nextU32` from the raw state `[1, 2, 3, 4]`, first five | `7, 34, 56623200, 188882296, 3431242869` |
| `hashSeed('tasks:2026-09-26')` | `2847463752` |
| `mix32(1)` · `hashU32(7, 3)` | `1364076727` · `2535364964` |
| `nextInt(…, 6)` eight times from `seedRng(42)` | `3, 4, 2, 0, 4, 0, 1, 2` |
| `nextUnit(seedRng(3))` | `0.4118875162675977` |
| `dailySeed('2026-09-26', 17)` · `('2026-09-27', 17)` · `('2027-01-01', 17)` | `2599028541` · `2582250922` · `2349681313` |
| `dailySeed('2026-09-26', 0)` · `('2028-02-29', 4242)` | `2362601272` · `773016242` |
| `drawOne` · `shuffle` · `drawSample(3)` of `abcdefgh` from `seedRng(42)` | `h` · `fbdeacgh` · `hae` |

## How the goldens were computed (the independent oracle)

Every value above was computed on 2026-10-03 by a Python oracle written from the algorithm
descriptions (Python's unbounded integers, masked to 32 bits; no line ported from the TypeScript), and
then confirmed by two more implementations: the TypeScript module itself (the canonical tests pass)
and the checker's own BigInt implementation (`scripts/lib/determinism-spec.mjs`). Three
implementations in three styles agreeing is what makes a value a golden; one implementation agreeing
with itself proves nothing. Re-run it with `python3 oracle.py`:

```python
M, GAMMA = 0xFFFFFFFF, 0x9E3779B9
def u32(x): return x & M
def to_int32(x): x &= M; return x - (1 << 32) if x >= (1 << 31) else x
def mix32(v):
    z = u32(v); z = u32((z ^ (z >> 16)) * 0x85EBCA6B); z = u32((z ^ (z >> 13)) * 0xC2B2AE35)
    return z ^ (z >> 16)
def next_u32(s):
    a, b, c, d = s; t = u32(a + b + d)
    return t, (b ^ (b >> 9), u32(c + (c << 3)), u32(u32((c << 21) | (c >> 11)) + t), u32(d + 1))
def seed_rng(seed):
    s = to_int32(seed); st = tuple(mix32(s + k * GAMMA) for k in (1, 2, 3, 4))
    for _ in range(12): _, st = next_u32(st)
    return st
def next_int(s, n):
    limit = (1 << 32) - ((1 << 32) % n); v, s = next_u32(s)
    while v >= limit: v, s = next_u32(s)
    return v % n, s
def fnv1a32(text, basis=0x811C9DC5):
    raw = text.encode('utf-16-le'); h = basis
    for i in range(0, len(raw), 2): h = u32((h ^ (raw[i] | raw[i + 1] << 8)) * 0x01000193)
    return h
def daily_seed(key, salt): return fnv1a32(key, 0x811C9DC5 ^ u32(salt))
def draws(state, n):
    out = []
    for _ in range(n): v, state = next_u32(state); out.append(v)
    return out
print(draws(seed_rng(1), 5), fnv1a32('tasks:2026-09-26'), daily_seed('2026-09-26', 17))
```

Never compute a golden by running the module under test and pasting its output: that freezes today's
bug as tomorrow's contract. `check-determinism.mjs` fails a canonical test that stops pinning the
values as literals (rule `golden-pins`), for example `const GOLDEN = hashSeed('tasks:2026-09-26')`.

## Testing the RNG

- Pin golden values next to the properties. Determinism and range properties alone leave mutants
  alive (a changed warm-up count or rotation passes "same seed, same sequence" and "in range"); a
  pinned sequence kills them.
- Property tests over seeds pass a fixed fast-check seed (`{ seed: 42, numRuns: 300 }`) so a failure
  reproduces; fast-check (4.10.2, verified on 2026-10-03; re-verify with `npm view fast-check
  version`) prints the seed and path of a counterexample: add it as an example test before fixing.
- Tests never read real time or randomness either; the canonical Jest config pins `TZ=UTC` for every
  worker (unit-and-component-tests owns it).
