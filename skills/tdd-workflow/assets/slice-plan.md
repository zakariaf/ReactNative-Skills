# Slice: <the behaviour in one sentence>

Fill this in before the first test (keep it in the session notes or the change report, not in the app).

## Requirement

- <ID or issue>: "<the requirement, printed from the spec or the issue, never from memory>"

## The behaviour

<what a user, a screen or another module can observe afterwards>

## First failing test

- File: `<src/features/<feature>/<unit>.test.ts>`
- Title: `it('<third-person verb> ... (<ID>)')`
- Expected red: an assertion diff (`Expected: <value>`, `Received: <stub value>`), not an import or type error.
- Copied from a template: every `__PLACEHOLDER__` replaced, then `npx prettier --write <test file>`.

## Files the code will touch

- `<src/...>`

## Layer and order

- Layer: <pure logic | persistence | service | store or model hook | component or screen | route | flow>
- Everything this layer depends on is already tested: <yes, or the slice that comes first>

## Evidence the slice needs

- [ ] Red run pasted (the assertion lines)
- [ ] Green run: `npx jest --ci <test file>`
- [ ] Pure logic: examples + properties + one pinned exact value
- [ ] Android-only behaviour: `<unit>.android.test.tsx` red then green under `--selectProjects android`
- [ ] UI: screenshots of each changed screen on both platforms, light and dark, LTR and RTL when shipped, compared with the approved baseline
- [ ] `npm run -s check:fast` green
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-tests.mjs .` prints `RESULT: PASS`
- [ ] Commit: `<type>(<scope>): <subject>` with the requirement in the body, then `check-test-edits.mjs . --range <base>..HEAD` prints `RESULT: PASS`

## Red run

```text
<paste the assertion lines of the red run>
```
