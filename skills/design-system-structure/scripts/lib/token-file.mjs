// token-file.mjs: reads the app's design token file. Plain JSON in two tiers: primitives, then
// semantic roles that reference them with {dot.path} aliases. The W3C design-token (DTCG) spellings
// are accepted too: a leaf { "$value": ..., "$type": ... }, metadata keys starting with "$", and px
// dimensions { "value": 4, "unit": "px" }. resolveTokens() returns the tree with every alias and
// $value replaced by its value, plus a problem per broken alias.
//
//   const { tree, problems } = resolveTokens(JSON.parse(text));
//   getPath(tree, 'type.roles')   -> the roles object, or undefined

const ALIAS = /^\{([^{}]+)\}$/;

export function getPath(tree, path) {
  let node = tree;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDimension = (value) => isPlainObject(value) && Object.keys(value).length === 2 && typeof value.value === 'number' && value.unit === 'px';

/** The alias path a string names ({color.primitive.blue.49} -> 'color.primitive.blue.49'), or null. */
export function aliasOf(value) {
  const match = typeof value === 'string' ? ALIAS.exec(value) : null;
  return match ? match[1] : null;
}

export function resolveTokens(raw) {
  const problems = [];
  const resolve = (node, stack) => {
    const alias = aliasOf(node);
    if (alias !== null) {
      if (stack.includes(alias)) {
        problems.push({ alias, message: `{${alias}} refers to itself through ${stack.map((p) => `{${p}}`).join(' -> ')}` });
        return undefined;
      }
      const target = getPath(raw, alias);
      if (target === undefined) {
        problems.push({ alias, message: `{${alias}} points to no token` });
        return undefined;
      }
      return resolve(target, [...stack, alias]);
    }
    if (Array.isArray(node)) return node.map((item) => resolve(item, stack));
    if (isDimension(node)) return node.value;
    if (isPlainObject(node)) {
      if (Object.hasOwn(node, '$value')) return resolve(node.$value, stack);
      const out = {};
      for (const [key, value] of Object.entries(node)) if (!key.startsWith('$')) out[key] = resolve(value, stack);
      return out;
    }
    return node;
  };
  return { tree: resolve(raw, []), problems };
}

/** The primitive a semantic value names, without the group prefix ('neutral.97'), or null. */
export function primitiveName(raw, path) {
  const alias = aliasOf(getPath(raw, path));
  if (alias === null) return null;
  return alias.replace(/^color\.primitive\./, '');
}
