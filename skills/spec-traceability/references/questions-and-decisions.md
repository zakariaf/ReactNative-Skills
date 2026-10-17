# Non-negotiables, questions, decisions and scope

The judgement half of the skill: what the spec decides, when an agent must stop and ask, how an open
decision is used and settled, and why out-of-scope work stays out. The message format itself
(one request, answerable in a word, the default meanwhile) belongs to git-commits-and-reporting; this
file says what goes into a requirement question.

## Contents

- What the spec decides, and what it does not
- Non-negotiables
- Silent, ambiguous or contradicting: stop and ask
- Open decisions and their defaults
- Out of scope, and content caps
- Changing the spec
- Behaviour several features need

## What the spec decides, and what it does not

The spec decides **what** the user gets: screens, behaviours, numbers, texts, limits, platforms. The
code and its tests decide **how**: architecture, libraries, file layout, algorithms. A question about
how (which store, which hook, which list component) is answered by the engineering skills, never sent
to the reviewer as a product question. A question about what (how long Undo stays, what an empty list
says, whether Android shows the same prompt as iOS) is answered by the spec, or by the reviewer when
the spec is silent.

Agents get both directions wrong: they ask the reviewer what the spec already answers, and they
silently decide what the spec leaves open. Read the entry first (`spec-lookup.mjs <id>`); ask only
about real gaps.

## Non-negotiables

A non-negotiable is a rule that holds for every screen, feature and release, short enough to remember
and each with an `Enforced by:` line naming the test, lint rule, flow or check that holds it. Good
candidates: the app works offline; saved data survives every update; every screen works with
VoiceOver, TalkBack and the largest text size; layout says start and end, never left and right; no
personal data leaves the device without consent. Four to twelve is a healthy number; fifty means
they are requirements in disguise.

When a task, a design, a library or another requirement would break one, **stop before writing code**
and ask. A silently traded non-negotiable is the bug nobody catches, because every test of the new
work passes. Typical collisions:

| Collision | What happens without the rule | Ask with |
|---|---|---|
| A library that phones home (analytics in an SDK) vs "nothing leaves the device without consent" | the privacy declaration becomes false | the library, what it sends, an alternative that does not |
| A design that pins a button to the left vs "start and end only" | the RTL locale breaks | the design element, the logical equivalent |
| A schema change with no migration vs "data survives updates" | users lose tasks on update | the change, the migration plan |
| A requirement that needs the network vs "works offline" | the list waits on a spinner | the requirement lines, an offline-first variant |

Two non-negotiables can collide with each other (ads need the network, the app is offline-first).
The spec must say how they are reconciled, in a decision with its reasoning; until it does, that is a
question, not something an agent resolves.

## Silent, ambiguous or contradicting: stop and ask

Stop and ask when the spec, about **anything a user would see or feel**:

- is **silent**: an empty state, an error message, a limit, an order, a platform difference the spec
  does not cover (it says what iOS does and nothing about Android's back gesture);
- is **ambiguous**: "about 5 seconds", "fast", "a few", "recent", a word with two readings;
- **contradicts itself**: REQ-2 says Undo lasts 5 seconds, SCR-1 shows it until the next action;
- or the task **contradicts** it: the ticket asks for a fourth free list, REQ-5 caps free lists at 3.

Never invent product behaviour to fill the gap. A requirement question carries:

1. the entry IDs and the **quoted lines** (printed by `spec-lookup.mjs`, never retold);
2. what exactly is unclear, in one sentence;
3. two or three **options**, one marked as the recommended default with its reason;
4. what keeps moving meanwhile (other slices, or the default behind a single constant that is easy to
   change).

Then keep working on everything the question does not block. Questions that need no answer before the
work can continue (wording polish, a colour) go in the report, not in a message.

## Open decisions and their defaults

Every open decision in `decisions.md` carries `Default:`; the checker fails one without
(`entry-field-missing`), because an open decision with no default blocks work. The rules:

- **Use the default and say so** in the report: "DEC-1 is open; Undo uses its default, 5 seconds."
- **Ask only when the default stops working**: it contradicts a non-negotiable, it cannot be built on
  one platform, or new facts make it wrong. Then the question names the decision and the default.
- **A settled decision** has `Status: decided` and a `Decided:` line (with the date and who decided,
  when the team records that). It is never asked again, and it wins over an older default anywhere
  else in the spec or the code.
- Keep the default **in one place in code** (a named constant that cites the decision) so settling it
  differently is a one-line change: `export const UNDO_MS = 5000; // DEC-1 default`.

## Out of scope, and content caps

Agents over-deliver: a widget "because the data is there", a sign-in "because sync will need it",
fifty sample tasks when the spec asks for three. Every extra is code to test, translate, declare to
the stores and maintain, and it may break a non-negotiable.

- Build nothing that `out-of-scope.md` lists, even when a library makes it one line. A test that cites
  an `OOS-` entry or a `dropped` requirement fails `out-of-scope-traced`.
- Numbers in the spec are **limits, not targets**: "up to 3 free lists" is never 4, and "3 starter
  tasks" is never 10.
- Bringing an entry into scope is a product decision: the reviewer changes its status first, then the
  work starts.
- A new screen or requirement the spec lacks is added to the spec, with the next free ID and the
  reviewer's agreement, before code cites it. Inventing `SCR-16 Leaderboard` in a comment is a
  `dangling-id`.

## Changing the spec

- Only the reviewer (or someone they name) changes what an entry requires. An agent may fix typos,
  add an alias, or add an entry the reviewer agreed to, in a `docs` commit.
- IDs are stable forever: never renumber to tidy up, never reuse a dropped number. Old commits,
  tests, flows and reports cite them.
- When a requirement changes, the commit that changes the test expectation carries
  `Spec-Change: <ID> <what changed>` (git-commits-and-reporting owns the trailer; tdd-workflow fails an
  edited assertion without it). The same commit updates the entry, so spec and test agree.
- Run `check-spec-refs.mjs .` after every spec change: a removed entry that is still cited shows up as
  `dangling-id` at once.

## Behaviour several features need

When the spec gives several features the same behaviour (an undo bar, a confirm dialog, the
notification permission flow), build it once in the shared layer the architecture names
(`src/ui/`, `src/services/`, a hook in `src/hooks/`), never copied inside one feature, and cite the
entry where the shared piece is tested. The spec describes the behaviour once for the same reason.
