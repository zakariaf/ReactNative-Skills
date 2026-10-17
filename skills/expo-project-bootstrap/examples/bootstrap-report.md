# Example: the report after a bootstrap

A complete, realistic report for the end of a bootstrap session. Imitate the order: the outcome in
plain words, at most one request with its default, what to look at, what is not complete yet, then
the details for the record.

---

The Tasks app now exists: one Expo app with the full toolchain, three installable builds
(development, preview, production) for iOS and Android, and every automatic check switched on.

**One request:** the store id. I used `com.acme.tasks` as you said; if App Store Connect or Google
Play registers a different one, tell me before the first store build (until then nothing depends on
it).

**What you can look at (optional):**
1. `AGENTS.md` at the top of the repository: the working rules every coding session follows.
2. The first commit, "scaffold the app and its gates".

**Not complete yet, on purpose:**
- The full pre-push check (`npm run verify`) stops at the translation check, which arrives with the
  first texts. Every check that exists passes on its own.
- The app shows an empty screen with placeholder icons; the next steps add the app's structure,
  texts, theme and real art. Nothing has been built for a simulator or emulator yet.
- Expo published small updates on 2026-10-12; the dependency check will ask for them from
  2026-10-20, when they are a week old.

Details:
- Checks run (all passed): format, lint (0 problems), type check (2 programs), 239 tests (coverage
  above every threshold), unused-code check, the production export for iOS and Android (Metro and
  the React Compiler bundle both platforms), the licence audit (57 shipped packages), the
  quality-gates guardrail, the dependency check (five early warnings, see above), the Expo config of
  all three variants, `check-skeleton.mjs` PASS.
- Install: Node 26.4.0, npm 11.17.0, 1,308 packages; install scripts reviewed and approved: lefthook
  2.1.14, unrs-resolver 1.12.2, fsevents 2.3.3. npm listed 69 advisories (18 moderate, 51 high) in
  build tools, not in the app; npm's audit is information, not a check.
- The `docs/` folder was left untouched and is excluded from formatting, linting and type checks.
- Next: architecture-and-boundaries (the app's service layer), then error handling and texts; the
  first real screen replaces the starter (`src/app/index.tsx`, `src/features/home/`) through
  scaffold-feature-screen.
