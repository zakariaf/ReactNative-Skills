# Solvers, par and solver hints

How to prove a level winnable and compute its exact par with the search kit in
`src/core/game/solver/`, how to keep the search small, how a witness proves levels of a game that draws
at random, and how the same solver gives hints.

## Contents

- The search kit
- A game's solver in three decisions
- Wrapping the engine (`engineProblem`)
- A custom search problem (canonical move order)
- Keys: when two states are the same
- BFS or IDA*
- Admissible heuristics by game shape
- Budgets
- Games that draw at random: the witness solver
- Never trust a solver: `verifyLine`
- Hints from the solver
- Testing a solver

## The search kit

`src/core/game/solver/`:

| File | What it gives |
|---|---|
| `search-problem.ts` | `SearchProblem<S, M>` = `{ start, moves(s), apply(s, m), isGoal(s), isDeadEnd(s), key(s) }`; `engineProblem(engine, key, start)` wraps a game engine (won = goal, lost = dead end) |
| `bfs-solve.ts` | `bfsSolve(problem, maxNodes)`: breadth-first, the first goal found has the fewest moves, so its line length is par |
| `ida-star-solve.ts` | `idaStarSolve(problem + heuristic, { maxNodes, maxDepth })`: iterative-deepening A*, exact with an admissible heuristic, memory proportional to depth |
| `engine-solver.ts` | `createBfsSolver({ engine, key })`, `createIdaStarSolver({ engine, key, heuristic, maxDepth })`: a ready `Solver` for `LevelsSpec.solver` |
| `verify-line.ts` | `verifyLine(engine, start, line)`: replays a claimed line with the real `applyMove`; `wins`, `illegal-move`, `ended-early` or `does-not-win` |
| `witness-solver.ts` | `createWitnessSolver({ rules, policy, botSeed })`: winnability for games that draw during play |

Results: `{ kind: 'solved', par, line, final }` (`final` is the state the line ends in),
`{ kind: 'unsolvable' }` (the whole space was searched), `{ kind: 'budget-exceeded' }` (gave up: never
treat it as unsolvable). All of it is pure and deterministic (fixed move order, no randomness), so a
solver's answer is the same in Jest, in the generator and on an iPhone or an Android phone.

## A game's solver in three decisions

1. **What is a search state?** Usually the engine state (`engineProblem`). Use a smaller custom state
   when moves commute or when the engine carries data the search does not need.
2. **Which moves, in which order?** `listMoves` for a start; a canonical order when many orders reach
   the same position.
3. **When are two states the same?** The `key`. A good key is the whole difference between a search
   that is fast and one that never finishes.

Put the solver in `src/games/<game-id>/levels/<game-id>-solver.ts`, export
`<GAME_CONST>_SOLVER: Solver<State, Move>`, and give it its own tests.

## Wrapping the engine (`engineProblem`)

For most puzzles (a sliding puzzle slides, a peg puzzle jumps, a box puzzle pushes) the engine is
already the search problem:

```ts
export const SLIDING_TILES_SOLVER = createIdaStarSolver({
  engine: { listMoves, applyMove, outcome },
  key: (state) => state.tiles.join(','),                // positions only: the move count is excluded
  heuristic: (state) => manhattanDistance(state.tiles), // admissible: every tile needs that many slides
  maxDepth: 40,
});
```

A lost state (`outcome` lost) is a dead end and is never expanded; a move limit therefore prunes the
search for free.

## A custom search problem (canonical move order)

When moves commute, the same position is reached in many orders and plain BFS explodes. Lights Out's
presses commute and a second press on a cell undoes the first, so a solution is a set of cells; the
template's solver searches press sets in index order (each cell at most once):

```ts
type Pressing = { readonly cells: readonly Cell[]; readonly next: number };

moves: (node) => Array.from({ length: cols * rows - node.next }, (_, offset) => toMove(node.next + offset)),
apply: (node, move) => {
  const index = move.row * cols + move.col;
  return { cells: toggleCells(node.cells, neighbourhood(cols, rows, index)), next: index + 1 };
},
key: (node) => `${node.cells.join('')}/${String(node.next)}`,
```

Every candidate set is visited once, breadth-first still meets the fewest presses first, and a 4x4
board with par up to 8 needs at most 39,203 nodes instead of 16^8. The line it returns is a list of
ordinary game moves, so `verifyLine` replays it through the real engine.

Other canonical orders: place identical pieces in increasing cell order; treat symmetric boards once (a
canonical rotation in the key); skip a move that immediately undoes the previous one.

## Keys: when two states are the same

- The key includes everything that changes what can still happen: positions, a tray, remaining pieces,
  the RNG state if the future draws depend on it.
- It excludes what does not: the move count (breadth-first already visits a position first at its
  smallest depth), cosmetic ids, scores that do not affect the rules.
- With a custom move order, include the order cursor (`next`) or the search may lose optimality.
- Keys are strings; join small integers with separators (`'1,0,3|2'`). `JSON.stringify` works but is
  slower.

## BFS or IDA*

| Use | When |
|---|---|
| BFS (`createBfsSolver` / `bfsSolve`) | par up to about 10 and a few hundred thousand reachable states; simplest, exact, detects unsolvable |
| IDA* (`createIdaStarSolver` / `idaStarSolve`) | deeper puzzles (par 10 to 40) where BFS runs out of memory; needs an admissible heuristic; reports `budget-exceeded` at `maxDepth`, never a false `unsolvable` |

Both are exact: the returned par is the true minimum when the heuristic never overestimates.

## Admissible heuristics by game shape

A heuristic may never exceed the true number of moves left:

| Game shape | Heuristic |
|---|---|
| Walking on a grid, mazes | Manhattan distance divided by the longest step one move covers |
| Toggle puzzles (Lights Out) | lit cells divided by the most cells one move can toggle (5), rounded up |
| Sliding puzzles | the sum of each tile's Manhattan distance to its home (one slide moves one tile one cell) |
| Sliding groups, tilt puzzles | 0 or 1 (one more move at least while not solved); simple but safe |
| Clearing games | remaining items divided by the most one move can clear, rounded up |

When unsure, use 0: IDA* then behaves like iterative deepening, still exact, just slower.

## Budgets

- `maxNodes` caps expanded nodes (deterministic, unlike a time limit, which differs between a CI
  runner, a fast iPhone and a budget Android phone). The generator may use a large budget (60,000 to a
  few million); the levels contract test uses the plan's budget; hints on the device stay small (the
  template: 60,000, measured in Node for 4x4 boards; measure a bigger board on a real low-end Android
  device under Hermes before raising it).
- A candidate over budget is skipped by the plan: the table never contains a level the solver could
  not prove.
- Never raise a test's budget to make a failing level pass; regenerate or fix the solver.

## Games that draw at random: the witness solver

A search needs the whole future of a level to follow from its start state. A game that draws during
play (Pig rolls a die from the RNG stream in its state on every roll; a block game refills its tray)
has an enormous branching future, and "par" means nothing when the next draws are random. Such a game
proves each level with a witness instead: `createWitnessSolver({ rules, policy, botSeed })`.

- `solve(start, maxNodes)` lets `policy` (the game's reasonable player, for Pig hold-at-20) play from
  `start` with its own RNG seeded by `botSeed` (tie-breaks only; the game's own draws stay in its
  state). `maxNodes` caps the legal moves the player is shown in total (Pig: 2,000, far above a whole
  won level of about 150).
- A win returns `{ kind: 'solved', par: line.length, line, final }`. A loss or the cap returns
  `budget-exceeded`, never `unsolvable`: a reasonable player losing proves nothing about the level. The
  plan tries the next candidate seed.
- `par` is only a filter (reject levels won in fewer moves than the game's minimum, Pig 12) and is
  never shown; the stars are a score rule set from the final state (`generators-and-plans.md`).
- The policy lives in `rules/` (Pig: `rules/pig-hold-policy.ts`), because level files may import only
  `src/core` and the game's `rules/`, `levels/` and `geom/`; `testing/<game-id>-testing.ts` re-exports
  it as the game's bot for the balance sims. If the game already has a bot written inline in
  `testing/` (game-rules-engine's Pig example defines its own `holdAtTwentyBot`), move its body into
  `rules/` and replace the inline bot with the re-export
  (`export { holdAtTwentyPolicy as holdAtTwentyBot } from '@/games/pig/rules/pig-hold-policy';`).
  Two copies of the same policy drift apart on the first tweak, and the witness then proves levels for a
  player the balance sims no longer measure.
- The bot seed and the policy never change; changing either regenerates the packs with a
  `Gate-Change:` trailer. A witness game has no solver hints (`hints: { kind: 'none' }`).

`examples/pig-levels/levels/pig-solver.ts` is the whole solver file, and its test proves the witness
wins a level, replays through the engine, is repeatable, and reports a lost start as `budget-exceeded`.

## Never trust a solver: `verifyLine`

A solver bug can claim a par that is not reachable. `levelsContractProblems` re-solves every shipped
level (a witness replays from its fixed bot seed) and replays the line with `verifyLine` through the
real engine; a line that is illegal, keeps playing after the end or does not win is reported, and so is
a recorded par that differs from the solver's (par levels only).

## Hints from the solver

A puzzle game's hints come from its exact solver. In the rules (`rules/<game-id>-engine.ts`):

```ts
hints: { kind: 'solver', suggest: suggestToggle },
```

with `suggestToggle(state)` = the first move of a shortest line within a small budget, or `null`
(already solved, unsolvable, over budget). The host highlights the move and charges the hint budget;
`null` means "no hint available", never a crash. Keep `suggest` pure: the same state always suggests the
same move. A hint runs on the JS thread inside a press handler: keep its budget small enough that the
press still feels instant on a low-end Android phone (performance-budgets measures it).

## Testing a solver

- Examples: a hand-built one-move board (par 1), an already solved board (par 0, empty line), an
  unsolvable board (`unsolvable`), a tiny budget (`budget-exceeded`).
- Properties (fast-check, fixed seed): for any seed and difficulty in the level range, the solver solves
  within budget, par is at most the construction bound (scramble presses), and `verifyLine` returns
  `wins` with `moves === par`. For two exact solvers (BFS and IDA*), property-test that they agree on
  par.
- The levels contract test proves the shipped table; the goldens pin it (`goldens-and-quality.md`).
