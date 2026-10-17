// not-weaker.mjs: compares a repo's gate data with the skill's baseline and lists every place where
// the repo's value is weaker than (or missing from) the baseline. Tighter values pass.
//
// Direction of each number, by path:
//   eslint rule options (max, limits)        repo <= baseline   (a lower limit is stricter)
//   eslint options named min... (minimum...) repo >= baseline   (a higher floor is stricter)
//   eslint rule severity (index 0)           repo == baseline
//   jest.coverageThreshold.*                 repo >= baseline
//   perf.*                                   repo <= baseline   (budgets)
//   a11y.*                                   repo >= baseline   (minimums, font scale)
//   everything else                          repo == baseline
// Arrays of strings (gatedPaths, deny, ask, globs, npmrcLines) must contain every baseline entry,
// except under typescript.* where they must be equal (types and conditions change the program), under
// jest.* where they must be equal too (an added "!" glob or ignore pattern takes code or tests out of
// the gates, a dropped one changes the scope), and except an "exclude" list (lefthook), which may only
// shrink: each entry takes files out of a gate.
// Arrays of objects with a "name" (lefthook jobs) are matched by name; other arrays by position.

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberDirection(path) {
  const [top] = path;
  if (top === 'eslint' && path[1] === 'ruleSets') {
    if (path.at(-1) === 0) return 'equal';
    // An option named min... (ban-ts-comment's minimumDescriptionLength) is a floor: higher is stricter.
    return /^min/i.test(String(path.at(-1))) ? 'min' : 'max';
  }
  if (top === 'jest') return 'min';
  if (top === 'perf') return 'max';
  if (top === 'a11y') return 'min';
  return 'equal';
}

const show = (value) => JSON.stringify(value);
const label = (path) => path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${part}`)).join('').replace(/^\./, '');

/** Returns [{ path, message }] for every weakened, changed or missing gate value. */
export function findWeaker(baseline, actual, path = []) {
  if (path.length === 1 && path[0] === '$comment') return [];
  if (actual === undefined) return path.at(-1) === 'exclude' ? [] : [{ path: label(path), message: `is missing (baseline ${show(baseline)})` }];
  if (typeof baseline === 'number') {
    if (typeof actual !== 'number') return [{ path: label(path), message: `expected a number like ${baseline}, got ${show(actual)}` }];
    const direction = numberDirection(path);
    if (direction === 'max' && actual > baseline) return [{ path: label(path), message: `was raised to ${actual} (baseline ${baseline}; a higher limit is weaker)` }];
    if (direction === 'min' && actual < baseline) return [{ path: label(path), message: `was lowered to ${actual} (baseline ${baseline}; a lower minimum is weaker)` }];
    if (direction === 'equal' && actual !== baseline) return [{ path: label(path), message: `is ${actual}, baseline ${baseline}` }];
    return [];
  }
  if (Array.isArray(baseline)) {
    if (!Array.isArray(actual)) return [{ path: label(path), message: `expected a list, got ${show(actual)}` }];
    const primitives = baseline.every((item) => !isObject(item) && !Array.isArray(item));
    if (primitives && path.at(-1) === 'exclude') {
      return actual.filter((item) => !baseline.includes(item)).map((item) => ({ path: label(path), message: `adds the entry ${show(item)} (an exclude takes files out of a gate)` }));
    }
    const exact = path[0] === 'typescript' || path[0] === 'jest';
    if (primitives && !exact && !(path[0] === 'eslint' && path[1] === 'ruleSets')) {
      return baseline.filter((item) => !actual.includes(item)).map((item) => ({ path: label(path), message: `lost the entry ${show(item)}` }));
    }
    if (primitives && exact) {
      return show(baseline) === show(actual) ? [] : [{ path: label(path), message: `is ${show(actual)}, baseline ${show(baseline)}` }];
    }
    if (baseline.every((item) => isObject(item) && typeof item.name === 'string')) {
      return baseline.flatMap((item) => {
        const match = actual.find((other) => isObject(other) && other.name === item.name);
        return match ? findWeaker(item, match, [...path, item.name]) : [{ path: label([...path, item.name]), message: 'is missing' }];
      });
    }
    return baseline.flatMap((item, index) => findWeaker(item, actual[index], [...path, index]));
  }
  if (isObject(baseline)) {
    if (!isObject(actual)) return [{ path: label(path), message: `expected an object, got ${show(actual)}` }];
    return Object.entries(baseline).flatMap(([key, value]) => findWeaker(value, actual[key], [...path, key]));
  }
  return baseline === actual ? [] : [{ path: label(path), message: `is ${show(actual)}, baseline ${show(baseline)}` }];
}
