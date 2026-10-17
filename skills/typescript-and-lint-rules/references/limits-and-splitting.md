# Size and complexity limits, and how to split code

The limits every `.ts`/`.tsx` file meets, why each number was chosen, how lines are counted, and what
to do when one trips. This table is the library's one copy of the limits; other skills cite it. Read
this when a limit error appears or before writing a large module or component.

## Contents

- The limits table
- How lines are counted
- When a limit trips
- Data belongs in JSON
- Platform files
- Why there is no warning tier

## The limits table

All limits are ESLint errors on every `.ts`/`.tsx` file; tests have their own column.

| Metric | Limit | Tests | ESLint default | Rationale |
|---|---|---|---|---|
| Lines per file (code only) | 250 | 400 | 300 | A 250-line file is read whole in one read and fits two or three editor screens. Defect studies show size predicts defects but no universal optimum (Hatton: a 200-400 sweet spot; El Emam: no threshold effect), so 250 is an engineering choice below the default |
| Lines per function (`.ts`) | 40 | off | 50 | between Clean Code's ~20 and the ESLint default; within the Linux kernel's "one or two screenfuls" |
| Lines per function (`.tsx`, components) | 80 | off | 50 | JSX is verbose; bounded further by JSX depth 5 and one component per file |
| Cyclomatic complexity | 10, `variant: 'modified'` | 10 | 20 | McCabe's limit (NIST SP 500-235). The classic count adds 1 per `case`, `?.`, `??` and default parameter, so an exhaustive 11-case switch over a union would fail; `modified` counts a whole `switch` once (verified) |
| Cognitive complexity | 15 | 15 | 15 (Sonar) | bounds the nesting and branching that `modified` complexity no longer counts |
| Nesting depth | 3 | 3 | 4 | "if you need more than 3 levels of indentation, you're screwed anyway" (kernel style) |
| Parameters | 3 | 3 | 3 | beyond three, pass one options object with named fields. Function **types** count too (`(a, b, c, d) => void` in a type fails) |
| Nested callbacks | 3 | 4 | 10 | tests need describe → it → property → callback |
| JSX depth | 5 (root = 0) | 5 | none | a sixth level fails (verified); extract a component |
| Components per file | 1 | any | none | one exported unit per file, easy to locate |
| Classes per file | 1 | 1 | none | same |
| Duplicate string literal | the 3rd occurrence fails | off | none | name a repeated literal once |
| Line width | 100 (Prettier) | 100 | n/a | Airbnb's `max-len` |

Rule names: `max-lines`, `max-lines-per-function`, `complexity`, `sonarjs/cognitive-complexity`,
`max-depth`, `max-params`, `max-nested-callbacks`, `react/jsx-max-depth`, `react/no-multi-comp`,
`max-classes-per-file`, `sonarjs/no-duplicate-string`. Also on: `sonarjs/no-identical-functions`,
`sonarjs/no-collapsible-if`, `sonarjs/no-nested-conditional`, `sonarjs/no-all-duplicated-branches`,
`sonarjs/no-identical-conditions`, `sonarjs/no-inverted-boolean-check`, `no-nested-ternary`.

Test files are `**/*.test.{ts,tsx}`, `test/**`, `jest.setup.ts` and `__mocks__/**`.

`check-configs.mjs` fails any other value in every shape ESLint accepts: a number (`['error', 6]`), an
options object in any key order (`['error', { skipComments: true, max: 120 }]`), any severity spelling
(`'error'`, `"error"`, `2`), and a bare re-declaration (`'max-depth': 'error'`), which falls back to
ESLint's default (300 lines, 50 per function, complexity 20, depth 4, 10 callbacks) (`eslint-limit-changed`).
It also fails any declaration of a limit rule beyond the canonical ones (`eslint-weakened
[option-redeclared]`) and a limit rule switched off beyond the canonical places (`eslint-rule-off`).
Changing a number is a stop-and-ask decision with a `Gate-Change:` trailer, never a fix for one file.

## How lines are counted

- `max-lines` and `max-lines-per-function` use `skipBlankLines: true` and `skipComments: true`: only
  lines holding code count. A line with code and a trailing comment counts.
- A function is counted from its first line (the `function` keyword, or the `(` of an arrow) to its
  closing brace, signature included.
- Nested functions count inside their parent too: a 30-line component with a 20-line inner handler is
  30 lines for the component and 20 for the handler.
- `IIFEs: true`: immediately invoked functions count as functions.
- `check-source.mjs` counts the same way, so the limits hold before `node_modules` exist. On 338 files
  with the limits lowered to 20 lines and 1 parameter, its counts matched ESLint's for all 64 reported
  functions and all 268 parameter lists, with no extra reports (2026-09-28); the worked example's
  44-line function matched again on 2026-10-03.

## When a limit trips

The limit is a symptom detector, not a target. Split by responsibility, never by line count, and never
compress code, join lines or move logic into JSON to get under a limit.

| Limit tripped | Move |
|---|---|
| Long function | Extract the steps into named pure functions in the same file (each exported one gets a TSDoc line in `src/core/`) or, when they form their own responsibility, a sibling module with its own test |
| High complexity or cognitive complexity | Replace condition chains with a lookup table (an `as const` object keyed by a union) or an exhaustive `switch` over a union |
| Deep nesting | Early returns (guard clauses), then extract the inner block into a named function |
| Too many parameters | One `readonly` options object type named `<Function>Options` |
| Deep JSX, long component | Extract a child component into its own file with a `<Component>Props` type; move data shaping into the feature's `use-<feature>-model.ts` |
| Long file | Split by responsibility (parsing vs rules vs formatting), never into `part-1.ts`/`part-2.ts` |
| Duplicate string | A named constant (`const TASK_COMPLETED = 'task-completed'`), or a table |
| Two components in one file | One file per component; the file name is the component name in kebab-case |

`examples/splitting-a-long-function.md` walks through a 44-line, complexity-12 function and its split.

## Data belongs in JSON

Large static data (seed lists, lookup tables, fixtures, word lists) goes in `.json`, not `.ts`: data is
not logic, has no line limit, and loads without parsing TypeScript. Import it with a default import
(`import en from './en.json';`); `resolveJsonModule` comes from the Expo base.

## Platform files

`task-row.ios.tsx` and `task-row.android.tsx` are linted and type-checked like any other file and each
meets the limits on its own. Keep their props identical (one `<Component>Props` type both import), and
prefer `Platform.select` for a one-line difference: a platform split doubles the code that must stay in
sync, so it is for differences that would otherwise push a component over its limit.

## Why there is no warning tier

With `--max-warnings 0` a warning fails anyway, and two thresholds invite gaming ("it is only a
warning"). `check-configs.mjs` fails any `'warn'` severity (`eslint-warn`) and any knip rule below
`error` (`knip-config`).
