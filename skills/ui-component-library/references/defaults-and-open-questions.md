# Defaults and open questions

The choices the templates make where a design is often silent, why, and what is not verified on a
device yet. Say which of these a change touches when reporting, and ask the reviewer before changing
a value the app's design fixed.

## Defaults the templates choose

| Where | Default | Why |
|---|---|---|
| Destructive button | surface fill, `danger` label and edge (never a red face) | the label pair danger on surface is already judged by the contrast contract, and the edge keeps a shape cue |
| Primary per screen | one | the main action stays findable; a pair is secondary + primary |
| Disabled controls | the press surface's muted face (`sunken`), presses ignored, `accessibilityState.disabled` | one look everywhere; the state is announced, not only drawn |
| Dialog buttons | safe choice first, rows wrap at large text | the start position is the expected way out; wrapping never truncates |
| Toast | surface, hairline edge, small shadow, polite live region plus an announcement | readable in both schemes without an inverse colour role; iOS does not read live regions |
| Confetti | nothing under reduce motion; five pieces, once | a celebration is decoration; bounded moments (motion-and-animation) |
| Slider step for screen readers | a tenth | coarse enough for swipes, fine enough for a volume |
| Hold to confirm | `MOTION_MS.holdToConfirm`, empties in `MOTION_MS.fast`, `ReduceMotion.Never` | a safety timer, not decoration |
| Busy indicator | a three-block wave on `MOTION_MS.slow`; still under reduce motion | an app with its own loading motion adds a dedicated duration token (design-system-structure) |
| Badge tilt | none unless asked, at most `badge.maxTilt`, never mirrored | a tilt is a printed look, not a direction |
| Check marks | drawn, never mirrored | a check reads the same in every language |
| Chevrons | drawn, pointing to the reading direction's end | a chevron is a direction |
| Icons | slots (`IconSlot`), the library draws none | works with any icon set; the component picks size and colour |
| Overlays | React Native `Modal` (or an Expo Router modal route) | both screen readers stay inside; Android back for free |
| Lists | `List` for short bounded groups; data lists are `FlatList` of `ListRow` | react-components-and-hooks owns list choice (FlatList by default, FlashList when measured) |
| Specs | generated from the token file; `asRenderedBorders` off | a native design draws its own borders; browser references opt in |

## States worth a design decision

Built as described, but often missing from a design: pressed segments and option cards, a slider
while dragging, the hold button half held, toasts stacked, empty and filtered-empty states, dialogs
at 200 % text, every component in dark mode and in a right-to-left language. Ask the designer, or
show the built state to the reviewer, before shipping.

## Open questions (verify on devices)

1. `boxShadow` on many toasts or thumbs at once: expected to be cheap on iOS and Android 9+, not
   measured here. performance-budgets measures frames.
2. The ripple clip of `PressableSurface` on rows with no radius inside a clipped `List` on
   Android: expected to clip to the list's corners through `overflow: 'hidden'`; check on an
   emulator.
3. `Modal` with `statusBarTranslucent` and `navigationBarTranslucent` on Android 14 and older
   (where edge to edge is not enforced) with three-button navigation: the scrim should cover both
   bars; check on an emulator per Android version the app supports below 15. On 15 and 16 the
   source says it is edge to edge regardless; one emulator pass confirms it.
4. TalkBack's adjust gestures on the Slider and the activate action on the HoldButton: the handlers
   are proven in Jest; the feel needs a human TalkBack and VoiceOver pass (accessibility-as-code's
   release checklist).
