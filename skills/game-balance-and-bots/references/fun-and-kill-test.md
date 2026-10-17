# Fun within seconds: the kill test

Bots cannot feel fun, but they can measure its preconditions: how soon the first win moment comes,
whether the twist actually happens, and whether choices matter. This reference turns what prototype
bot runs revealed about game ideas into tests every game passes before anyone polishes it.

## Contents

- Why seconds matter
- The three bot-measurable preconditions
- The kill test
- What prototype bots revealed
- Designing the opening for an early payoff
- Choosing payoff and twist events
- When a game fails: stop and ask

## Why seconds matter

- Phone sessions are short (a few minutes), and board, card and puzzle games keep players longest
  when the first minute is clear. Small games that last "grab attention in the first half second".
- A strong shape for a small game is "a base everyone knows, plus one twist that changes decisions".
  The base is familiar; the twist must show up early and often, or the game is the base game with new
  paint.
- Generated or quickly built games fail silently on balance and pacing: they look right and are
  unplayable. Checking state with bots beats guessing.

## The three bot-measurable preconditions

1. **An early payoff.** A reasonable player reaches the first win moment within the first moves on
   the easiest level: 1-3 moves when a move is a considered placement or press, 2 when it is a single
   tap such as a roll, 1-3 seconds for a real-time game (whose curve counts seconds). Measured by
   `firstPayoffShare` (the `firstPayoff` rule).
2. **The twist happens.** The game's special mechanic fires at least once per level for a reasonable
   player (`twistPerRun`, the `twist` rule).
3. **Choices matter.** Random play mostly loses; a reasonable player wins most easy levels; a
   far-sighted player wins more (the bands and the `skillGap` rule). "If a script could beat it, naive
   bots should lose" is a design test.

## The kill test

Run it on an idea's first playable rules, before art, sound or screens:

1. Write `create`, `listMoves`, `applyMove`, `outcome` and the bot hooks with payoff and twist tags.
2. Run the sim at the easiest difficulty with `random`, the reasonable player and `lookahead` (100
   seeds each).
3. Pass when: the reasonable player reaches the first payoff within the window above in at least 90 %
   of runs; it sees at least one twist per run; random wins clearly less than it does.
4. If the reasonable player fails, try the upper bound: can even `lookahead` (which sees the seeded
   future) reach a payoff early? If a search that sees every future move cannot find a payoff within
   about 13 moves, the friction is structural, not a tuning number: the idea needs a design change,
   and that is the developer's decision.

## What prototype bots revealed

Small playable prototypes of five game ideas were run against simple bots before any of them was
built. The numbers decided which ideas survived:

| Prototype | What the bots showed | Verdict |
|---|---|---|
| A: a lane-defence block puzzle (clearing a column fires at the enemy in its lane) | The first move clears a line and defeats an enemy; but as first specified the pace was near-unwinnable: a bot lost all 200 games within about 6 placements. Easing two pacing numbers (enemies step every 2nd placement, spawn every 3rd) roughly doubled survival. | Kept; balance needed design work, which bots can do |
| B: a grid chase where robots crash into each other and pushed scrap can crush them | Robots crash within 2-3 taps and a level takes a few turns, but over 300 games a one-move-lookahead bot got about 0.25 chances per game to crush a robot with scrap; almost all wins came from robot-on-robot crashes. | Twist too weak; strengthen it before building |
| C: a snake that captures critters by closing a loop | Closing a loop reads instantly, but catching anything does not happen within seconds: enclosing one cell takes an 8-segment ring, the starting snake has length 5, and critters slip out while the loop is drawn. A search that saw every future critter move found no catch within 13 moves; a greedy bot caught 1 critter in 20,000 moves. | Killed (structural friction, not a tuning number) |
| D: merging tiles that clash with incoming enemies | Feedback is instant, but most clashes are one-for-one trades; every run ended overrun in about 15-20 moves, whatever the bot did. | Dropped: the decision is murky and naive and smart play end alike |
| E: a tilt puzzle that slides a flock into a pen | A breadth-first solver proves every generated field winnable and gives par (about 13 ms for 50 fields). A random tilter wins only about 12 % of fields and takes about 2× par when it does. | Kept: the puzzles need thought (a clear skill gap) |

Lessons that became rules:

- Measure the twist, not just the win rate (B passed on fun and failed on twist).
- Use a future-seeing search as the upper bound before declaring an idea dead (C).
- A random bot that loses about as fast as a smart one means choices do not matter (D); a random bot
  that wins more than the reasonable player means the rules punish the sensible choice (the Pig
  example's first run, tuning-playbook.md).
- Pacing numbers from a spec are guesses; the first sim run usually shows the game is far too hard or
  too easy (A, and the Pig example).

## Designing the opening for an early payoff

The fastest fix for a late first payoff is the opening layout, generated from the seed like everything
else:

- **A block or line game:** prepare one column and one row two cells short and deal the pieces that
  finish them, with a weak enemy waiting where the cleared line fires. The first placement can then
  pay off; test it directly over many seeds ("some first move produces a payoff event").
- **A chase game:** keep a pair of enemies near a collision in every opening, or a pickup right next to
  the start (the arena-chase example puts the first spark 150 units from the player: collected within a
  second in every run).
- **A puzzle:** the payoff is solving it, so keep the first boards' par short (Lights Out's first row:
  3x3 boards cleared within two presses), with a deliberate trap in the obvious first move later on.

Then let the sim's `firstPayoff` rule guard it.

## Choosing payoff and twist events

Decide the tags before the first sim run and write the reason in the bands' `notes`:

| Game type | `payoff` | `twist` |
|---|---|---|
| Lights-out style toggle puzzle | the board goes dark | a press that toggles a whole cross |
| Push-your-luck dice (Pig) | a roll that survives | a bust that throws away points already rolled |
| Real-time chase (arena-chase) | a pickup collected | the special move clearing danger (a pulse throwing chasers back) |
| Lane defence | an enemy defeated | a cleared line firing at an enemy |
| Crash puzzle | two enemies collide | an enemy crushed by a pushed object |
| Merge game | an enemy smashed | a merged piece beating an enemy it could not before |

## When a game fails: stop and ask

If the kill test fails after reasonable tuning (the opening is prepared, the pressure is calm, and even
the lookahead bot cannot reach an early payoff or a regular twist), do not keep polishing. Stop and
tell the developer in plain words: what the bots measured, what was tried, and one or two design
changes that would address it. The developer decides whether to change the idea, move it down the
list, or drop it. A person's play-test is the final judge of fun in every case: bots measure pace, not
joy.
