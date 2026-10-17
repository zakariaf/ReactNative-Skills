// engine-run.mjs: runs one game's real rules modules (create, listMoves, applyMove, outcome and
// the persistence parsers) over seeded random games, then with the game's own bot, and reports
// contract breaks. Not an entry point.

import { errorText } from './app-modules.mjs';
import { RULE_FILES } from './rules-checks.mjs';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEEDS = [1, 2, 3];
/** A saved run may hold any difficulty 0..100, so create() must accept the whole range. */
const DIFFICULTIES = [0, 50, 100];
/** ENDLESS_DIFFICULTY: the endless run of a game that has one; it only ever ends lost. */
const ENDLESS = 100;
const MAX_MOVES = 150;
/** The salt the kit's playBot gives a bot's own stream. */
const BOT_STREAM_SALT = 0x5bd1e995;

/** xorshift32: the checker's own deterministic move picker (never Math.random). */
function picker(seed) {
  let x = (seed * 2654435761) >>> 0 || 1;
  return (count) => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x % count;
  };
}

function isPlain(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** First value in `value` that JSON cannot carry unchanged, as a path message, or null. */
export function jsonProblem(value, path = 'state') {
  if (value === undefined) return `${path} is undefined`;
  if (typeof value === 'number' && !Number.isFinite(value)) return `${path} is ${value}`;
  if (['function', 'symbol', 'bigint'].includes(typeof value)) return `${path} is a ${typeof value}`;
  if (typeof value !== 'object' || value === null) return null;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = jsonProblem(item, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isPlain(value)) return `${path} is a ${value.constructor?.name ?? 'non-plain object'}`;
  for (const [key, item] of Object.entries(value)) {
    const found = jsonProblem(item, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function outcomeProblem(result, moveCount, gameId) {
  if (result === null || typeof result !== 'object') return `outcome returned ${JSON.stringify(result)}`;
  if (result.kind === 'lost' && !String(result.reasonKey).startsWith(`${gameId}.`)) return `lost reasonKey "${result.reasonKey}" is not a ${gameId}.* catalog key`;
  if (result.kind === 'won' && !(Number.isInteger(result.score) && result.score >= 0)) return `won score ${result.score} is not a whole number >= 0`;
  if (!['playing', 'won', 'lost'].includes(result.kind)) return `outcome kind "${result.kind}" is not playing, won or lost`;
  if (moveCount > 0 !== (result.kind === 'playing')) return `listMoves has ${moveCount} moves while outcome is ${result.kind} (it must be empty exactly when the game is over)`;
  return null;
}

function stepProblem(engine, state, move) {
  const before = JSON.stringify(state);
  let result;
  try {
    result = engine.applyMove(state, move);
  } catch (error) {
    return { problem: `applyMove threw for a move listMoves offered (${JSON.stringify(move)}): ${errorText(error)}` };
  }
  if (JSON.stringify(state) !== before) return { problem: 'applyMove changed its input state (it must return a new state and leave the old one untouched)' };
  if (!result || !Array.isArray(result.events)) return { problem: 'applyMove did not return { state, events }' };
  const shape = jsonProblem(result.state);
  if (shape) return { problem: `state is not JSON-safe: ${shape}` };
  const moveShape = jsonProblem(move, 'move');
  if (moveShape) return { problem: `move is not JSON-safe: ${moveShape}` };
  const badEvent = result.events.find((event) => typeof event?.kind !== 'string' || !KEBAB.test(event.kind));
  if (badEvent !== undefined) return { problem: `event ${JSON.stringify(badEvent)} has no kebab-case kind` };
  return { next: result.state };
}

function roundTripProblem(persistence, state, move) {
  if (persistence === null) return null;
  const parsedState = persistence.parseState(JSON.parse(JSON.stringify(state)));
  if (JSON.stringify(parsedState) !== JSON.stringify(state)) return 'parseState does not return a saved state unchanged';
  if (move !== undefined) {
    const parsedMove = persistence.parseMove(JSON.parse(JSON.stringify(move)));
    if (JSON.stringify(parsedMove) !== JSON.stringify(move)) return `parseMove does not return ${JSON.stringify(move)} unchanged`;
  }
  return null;
}

const jsonKind = (value) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value);

/**
 * Saved data a parser must refuse (rule 14: never cast saved JSON): JSON of another kind, and for an
 * object an empty object and one top-level field of the wrong type. A cast accepts them all.
 */
function damagedCopies(value) {
  const others = [null, {}, [], 'damaged', 42, true].filter((item) => jsonKind(item) !== jsonKind(value)).map((copy) => ({ copy, what: JSON.stringify(copy) }));
  if (jsonKind(value) !== 'object' || Object.keys(value).length === 0) return others;
  const fields = Object.keys(value).map((key) => {
    const wrong = typeof value[key] === 'string' ? 12345 : 'damaged';
    return { copy: { ...value, [key]: wrong }, what: `"${key}" set to ${JSON.stringify(wrong)}` };
  });
  return [...others, { copy: {}, what: '{}' }, ...fields];
}

/** parseState/parseMove of the first played state and move must return null for damaged data. */
function damagedParseProblem(persistence, state, move) {
  if (persistence === null) return null;
  const accepts = (parse, value) => damagedCopies(JSON.parse(JSON.stringify(value))).find((item) => parse(item.copy) !== null)?.what;
  const badState = accepts(persistence.parseState, state);
  if (badState !== undefined) return `parseState accepts damaged data (${badState}); it must return null`;
  const badMove = move === undefined ? undefined : accepts(persistence.parseMove, move);
  return badMove === undefined ? null : `parseMove accepts damaged data (${badMove}); it must return null`;
}

/** A random mover for the seeded games: picks one of the legal moves. */
function randomChooser(start) {
  const pick = picker(start.seed * 101 + start.difficulty);
  return (_state, moves) => moves[pick(moves.length)];
}

/** The game's own bot as a chooser: random play rarely wins a puzzle, the bot reaches won states. */
function botChooser(bot, rng) {
  let current = rng;
  return (state, moves) => {
    const choice = bot(state, moves, current);
    current = choice.rng;
    return choice.move;
  };
}

function endlessProblem(start, result) {
  return start.isEndless && result?.kind === 'won' ? `the endless run (difficulty ${ENDLESS}) was won with score ${result.score}; an endless run only ever ends lost` : null;
}

/** Plays one seeded game; returns the first problem found (or null) and the move line. */
function playOne(engine, persistence, start, gameId, choose) {
  let state = engine.create(start.seed, start.difficulty);
  const created = JSON.stringify(state);
  if (JSON.stringify(engine.create(start.seed, start.difficulty)) !== created) return { problem: 'create gives two different states for the same seed and difficulty', line: [] };
  const shape = jsonProblem(state);
  if (shape) return { problem: `state is not JSON-safe: ${shape}`, line: [] };
  const opening = engine.outcome(state);
  if (opening?.kind !== 'playing') return { problem: `create() starts a game whose outcome is ${opening?.kind}; every level, daily and endless run must start in play`, line: [] };
  const line = [];
  while (line.length < MAX_MOVES) {
    const moves = engine.listMoves(state);
    const result = engine.outcome(state);
    const outcome = outcomeProblem(result, moves.length, gameId);
    if (outcome) return { problem: outcome, line };
    const endless = endlessProblem(start, result);
    if (endless) return { problem: endless, line, rule: 'endless-won' };
    if (moves.length === 0) break;
    const move = choose(state, moves);
    if (!moves.some((legal) => JSON.stringify(legal) === JSON.stringify(move))) return { problem: `the bot chose ${JSON.stringify(move)}, which is not one of the moves listMoves offered`, line, rule: 'testing-bot' };
    const step = stepProblem(engine, state, move);
    if (step.problem) return { problem: step.problem, line };
    const trip = roundTripProblem(persistence, step.next, move) ?? (line.length === 0 ? damagedParseProblem(persistence, step.next, move) : null);
    if (trip) return { problem: trip, line, rule: 'persistence-roundtrip' };
    state = step.next;
    line.push(move);
  }
  const replay = () => JSON.stringify(line.reduce((current, move) => engine.applyMove(current, move).state, engine.create(start.seed, start.difficulty)));
  if (replay() !== replay()) return { problem: 'replaying the same moves from the same seed gives a different state', line };
  return { problem: null, line };
}

async function loadEngine(modules, paths) {
  const engine = {};
  for (const [file, name] of Object.entries(RULE_FILES)) {
    const module = await modules.load(`${paths.rulesDir}/${file}`);
    if (typeof module[name] !== 'function') throw new Error(`${file} does not export a function ${name}`);
    engine[name] = module[name];
  }
  let persistence = null;
  if (modules.exists(paths.persistence)) {
    const module = await modules.load(paths.persistence);
    const spec = Object.values(module).find((value) => value && typeof value === 'object' && typeof value.parseState === 'function');
    if (spec) persistence = spec;
  }
  return { engine, persistence };
}

/** The game's TestingSpec (bot + examples) and the kit's seedRng, or null while they do not exist. */
async function loadTesting(modules, paths, games) {
  if (!modules.exists(paths.testing)) return null;
  const module = await modules.load(paths.testing);
  const spec = Object.values(module).find((value) => value && typeof value === 'object' && typeof value.bot === 'function' && value.examples);
  if (!spec) throw new Error(`${paths.testing} exports no TestingSpec ({ bot, examples })`);
  const rngRel = `${games.rngDir}/sfc32.ts`;
  const seedRng = modules.exists(rngRel) ? (await modules.load(rngRel)).seedRng : null;
  return { spec, seedRng: typeof seedRng === 'function' ? seedRng : (seed) => [seed >>> 0, 1, 2, 3] };
}

const EXAMPLE_KINDS = { start: 'playing', middle: 'playing', win: 'won', lose: 'lost' };

/** Each example state is JSON-safe and its outcome matches its name (start, middle, win, lose). */
function exampleProblems(engine, spec, gameId) {
  const problems = [];
  for (const [id, kind] of Object.entries(EXAMPLE_KINDS)) {
    const make = spec.examples[id];
    if (typeof make !== 'function') {
      problems.push(`examples.${id} is missing`);
      continue;
    }
    const state = make();
    const shape = jsonProblem(state, `examples.${id}()`);
    const outcome = engine.outcome(state);
    const found = shape ?? outcomeProblem(outcome, engine.listMoves(state).length, gameId);
    if (found) problems.push(`examples.${id}: ${found}`);
    else if (outcome.kind !== kind) problems.push(`examples.${id}() is ${outcome.kind}, expected ${kind}`);
  }
  return problems;
}

const FIXES = {
  'persistence-roundtrip': 'parseState/parseMove must return exactly what was saved and null for damaged data (build a fresh typed object from the JSON field by field; never cast it).',
  'testing-bot': 'The bot returns one of the moves it was given, with the rng it was given (advanced if it drew).',
  'endless-won': "At ENDLESS_DIFFICULTY the tuning's endless row has no goal and outcome never returns won (check isEndlessDifficulty before the win).",
};

function reportRun(report, paths, result, start) {
  if (!result.problem) return;
  const rule = result.rule ?? 'engine-contract';
  const file = { 'persistence-roundtrip': paths.persistence, 'testing-bot': paths.testing }[rule] ?? paths.rulesDir;
  report.problem({ file, rule, message: `${start.by} seed ${start.seed} difficulty ${start.difficulty}: ${result.problem}`, fix: FIXES[rule] ?? 'Fix the engine function named in the message; add the failing seed as an example test first.' });
}

/**
 * Runs the engine over SEEDS x DIFFICULTIES with random moves and, once the game's testing file
 * exists, with its own bot (which reaches wins) and its four example states. Reports at most one
 * problem per game played.
 */
export async function runEngineContract(modules, games, paths, isEndlessGame, report) {
  let loaded;
  let testing = null;
  try {
    loaded = await loadEngine(modules, paths);
  } catch (error) {
    report.problem({ file: paths.rulesDir, rule: 'engine-load', message: `the rules modules cannot run headless: ${errorText(error)}`, fix: 'Rules import only src/core and their own files; nothing from React Native, Skia, Expo or app code.' });
    return 1;
  }
  try {
    testing = await loadTesting(modules, paths, games);
  } catch (error) {
    report.problem({ file: paths.testing, rule: 'testing-examples', message: `cannot run headless: ${errorText(error)}`, fix: "Export <CONST>_TESTING: TestingSpec with bot and examples; import only the game's rules and src/core." });
  }
  let runs = 0;
  const choosers = [{ by: 'random play', make: (start) => randomChooser(start) }];
  if (testing) choosers.push({ by: "the game's bot", make: (start) => botChooser(testing.spec.bot, testing.seedRng(start.seed ^ BOT_STREAM_SALT)) });
  for (const chooser of choosers) {
    for (const difficulty of DIFFICULTIES) {
      for (const seed of SEEDS) {
        runs += 1;
        const start = { seed, difficulty, by: chooser.by, isEndless: isEndlessGame && difficulty === ENDLESS };
        let result;
        try {
          result = playOne(loaded.engine, loaded.persistence, start, paths.gameId, chooser.make(start));
        } catch (error) {
          result = { problem: `the engine threw: ${errorText(error)}` };
        }
        reportRun(report, paths, result, start);
      }
    }
  }
  if (testing) {
    runs += 1;
    let problems;
    try {
      problems = exampleProblems(loaded.engine, testing.spec, paths.gameId);
    } catch (error) {
      problems = [`an example state could not be built or rated: ${errorText(error)}`];
    }
    for (const message of problems) report.problem({ file: paths.testing, rule: 'testing-examples', message, fix: 'examples.start and .middle are playing, .win is won (whole score >= 0), .lose is lost with a <game-id>.* reason; build them from create() and applyMove.' });
  }
  return runs;
}
