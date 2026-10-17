#!/usr/bin/env node
// A fixture checker: its presence, and the flags its SPEC declares, are what the index's
// command-unknown rule looks for.
const SPEC = { usage: '[repo-root] [--strict]', options: { strict: { type: 'boolean' } } };
console.log(SPEC.usage === '' ? 'RESULT: FAIL (1 problems)' : 'RESULT: PASS');
