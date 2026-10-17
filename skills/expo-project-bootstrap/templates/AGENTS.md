# __APP_NAME__: working rules for agents

Every coding agent (Claude Code, Codex, Cursor, ...) reads this file first. It is short on purpose: the
detail lives in the project skills, and the checks enforce it.

## Sources of truth

- **The skills.** Start every task with `react-native-conventions-index`: it says which skill covers the
  work and in which order. A skill's rules and its definition of done win over habits and memory.
- **The gates.** `quality-gates.json`, `eslint.config.mjs`, the tsconfig set, `knip.json`, `lefthook.yml`
  and `.claude/settings.json` are the agreed quality bar. A failing gate is fixed in the code, never by
  loosening the gate.
- **The stack.** Expo SDK 57, React Native 0.86, React 19.2, TypeScript 6 (strict), Expo Router in
  `src/app/`, the `@/` alias for `src/`. Versions come from `contracts/dependency-policy.json`; never
  install a package at npm `latest` without the dependency-management skill.

## Every session

1. Start from a green tree: `npm run -s check:fast`. If it is red before you change anything, say so
   first.
2. Work in small steps, test first (tdd-workflow). Run the related tests after each change.
3. Before you stop: `npm run -s check:fast` again; before a push, `npm run verify`.

## Commands

| Command                 | What it runs                                                                |
| ----------------------- | --------------------------------------------------------------------------- |
| `npm run -s check:fast` | Prettier, ESLint, both TypeScript programs, the Jest tests of changed files |
| `npm run verify`        | every gate, cheapest first, stopping at the first failure                   |
| `npm test`              | all Jest projects                                                           |
| `npm run typecheck`     | `tsconfig.json` (Node and tests) and `src/tsconfig.json` (the app)          |
| `npx expo start`        | the development server (development variant)                                |

## Stop and ask the developer

- Before editing a gated file (the `ask` rules in `.claude/settings.json` prompt for them) or any change
  that needs a `Gate-Change:` commit trailer.
- Before anything irreversible or outward-facing: store uploads, EAS submissions or updates, publishing,
  deleting data, rotating or reading keys, spending money.
- When a human step is missing (Xcode licence, Android SDK licences, signing credentials, store
  accounts). Name the step and the default that applies until it is done.

## Safety

- Never open, print, copy or commit signing keys, keystores, `.p8` files or `credentials.json`.
- Never bypass a hook (`--no-verify`, `LEFTHOOK=0`).
- Simulators and emulators are always named: `xcrun simctl <cmd> <udid>`, `adb -s <serial>`,
  `maestro --device <id>`. Never target "booted" or the only connected device.

## Commits

Conventional Commits (`feat(tasks): ...`), one logical change each, staged by name (never `git add -A`).
A change to a gated path carries `Gate-Change: <reason>`. Push only when the developer asks.
