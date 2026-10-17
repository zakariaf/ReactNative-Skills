# Example: the listening follow-up in a change report

A shape to imitate when a change adds or tunes sounds or haptics. The checks above it are green; this
section hands the part no checker can prove to a human, and nothing waits for the answer.

---

## Sounds and haptics: for a human to check (not blocking)

**What changed:** the tasks feature has three sounds and pulses (`complete` + light when a task is
done, `goal` + success when the day's goal is reached, `streak` + medium when the streak grows). The UI
moments are unchanged.

**Previews:** `node <skill>/scripts/check-sound-banks.mjs . --wav-dir reports/sfx` wrote
`reports/sfx/tasks/complete.wav`, `goal.wav`, `streak.wav` (48 kHz, 16-bit mono; git-ignored).

**Please check, whenever convenient:**

1. Play the three previews one after another: does each fit its moment? Is `complete` the quietest
   (it plays most often)? Is any of them harsh or too long?
2. On an iPhone with this build: complete a task, then reach the goal. Do the sounds land with the
   animation? With the silent switch on, is the app silent? Does music from another app keep playing?
3. On an Android phone: the same, plus: does music from another app keep playing at full volume (no
   pause, no ducking)? Do the sounds follow the media volume?
4. Only if the app also plays media (a video, a podcast) on iOS: after the media plays and stops, with
   the silent switch on, is the app silent again, and does music from another app mix again?
5. On both phones: do the pulses feel right (light enough for `complete`, distinct for `goal`), and
   does turning the in-app haptics switch off silence them at once?

**If something is off:** say which sound and what is wrong ("goal too long", "complete clicks"); the
fix is one number in its recipe, re-rendered and listed here again.

**Proven by the checks (no need to listen for these):** every recipe is click-free and inside the
level limits (`check-sound-banks`), every sound is cued and every cue has a sound, the engine respects
the silent switch on iOS and takes no audio focus on Android (`check-audio-haptics`), and the adapter
tests pass on the root mock.
