# Worked loop: the Tasks screen of the demo app

One pass through the whole loop for the frame `tasks-default` (screen `tasks`), on the iPhone 16 Pro
profile, then the Android one. The outputs are shortened; the line formats are the scripts' own.

## 1. Look first

```sh
node <skill>/scripts/check-mockup.mjs .
node <skill>/scripts/check-harness.mjs .
```

```
check-mockup: 3 frames checked, 0 problems
RESULT: PASS
check-harness: 22 harness files checked, 0 problems
RESULT: PASS
```

The references exist (`shoot-design.mjs . --check` passed when the design was approved), so the loop
starts at the device.

## 2. The device and the build

```sh
node <skill>/scripts/setup-parity-device.mjs . --device iphone-16-pro --appearance light --name tasks-parity-a
npm run build:ios:sim -- --variant preview --sim parity-a      # ios-simulator-build
```

```
setup created tasks-parity-a 0F3C2B6E-1A2B-4C3D-9E8F-123456789ABC
setup overriding the status bar (9:41, full bars, 100 % battery)
udid 0F3C2B6E-1A2B-4C3D-9E8F-123456789ABC
RESULT: PASS
```

The build is installed on that UDID (`xcrun simctl install 0F3C2B6E-... <App>.app`).

## 3. The machine side, first run

```sh
node <skill>/scripts/run-parity.mjs . --frame tasks-default --device iphone-16-pro --name tasks-parity-a
```

```
Maestro driver port 61042 for this run (free port)
frame tasks-default: reference tasks-default (base)
FAIL .parity/iphone-16-pro/tasks-default/light-en/app.png [bounds] tasks-default iphone-16-pro light-en: tasks.summary: geometry off: dx +0.0 dy +3.0 dw +0.0 dh +0.0 pt (design 16.0,122.0 370.0 x 20.0; app 16,125 370 x 20; tolerance +-2 pt) Fix: Match the design box: padding, gap, min-height, border width, margins and safe-area insets (the design style is in design.layout.json).
FAIL .parity/iphone-16-pro/tasks-default/dark-ar/app.png [structure] tasks-default iphone-16-pro dark-ar: tasks.add-button: shape differs: a 4.7 pt thick difference (14.0 x 14.0 pt) at +16.0,+11.0 from the element's top-left, inside its crop-only part tasks.add-button.icon (1 blob; ...)
tasks-default iphone-16-pro light-en         FAIL 1 (first: [bounds] tasks.summary: geometry off: dx +0.0 dy +3.0 ...)
tasks-default iphone-16-pro light-ar         FAIL 1 (first: [bounds] ...)
tasks-default iphone-16-pro dark-en          FAIL 1 (first: [bounds] ...)
tasks-default iphone-16-pro dark-ar          FAIL 2 (first: [bounds] ...)
RESULT: FAIL (5 problems)
```

## 4. Fix, one rule at a time

- `bounds` first (it moves everything below): `tasks.summary` sits 3 pt low in every run. The
  reference layout says `"rect":{"x":16,"y":122,...}` and the mockup's CSS has `.summary { margin: 4px
  16px 12px }`; the app had a `marginBlockStart` of 7 from an old token. Use the 4 pt spacing token.
- Then `structure` in dark RTL only: `crops/tasks.add-button.png` shows the plus icon missing. The icon
  took its colour from `onPrimary` and the dark theme's value was the button fill itself; the theme
  token was wrong (design-system-structure), not the screen.

After each fix: swap the bundle (devices-and-capture.md, "Fast iteration"), run step 3 again.

```
tasks-default iphone-16-pro light-en         PASS
tasks-default iphone-16-pro light-ar         PASS
tasks-default iphone-16-pro dark-en          PASS
tasks-default iphone-16-pro dark-ar          PASS
Look at every sheet (sheet.png, zoom-*.png, eye-*.png, crops/) before signing off:
  .parity/iphone-16-pro/tasks-default/light-en/sheet.png
  ...
RESULT: PASS
```

## 5. The look

For each of the four runs: read `sheet.png`, `zoom-1.png` to `zoom-4.png` and `eye-1.png` (the add
icon and the three check boxes, design | app). In dark RTL the plus icon is centred and the check boxes
sit at the row's start (right side), the chevron-free rows need nothing mirrored, the footer wraps on one
line in Arabic. Nothing differs.

```sh
node <skill>/scripts/check-signoff.mjs . --draft .parity/iphone-16-pro/tasks-default/dark-ar
```

```json
{
 "frame": "tasks-default",
 "device": "iphone-16-pro",
 "theme": "dark",
 "lang": "ar",
 "scrollY": 0,
 "sheetSha256": "9b1f...e2",
 "date": "2026-10-14",
 "looked": ["sheet.png", "zoom-1.png", "zoom-2.png", "zoom-3.png", "zoom-4.png", "eye-1.png"],
 "eyeChecks": { "icons": "open", "pictures": "open", "shadows": "open", "alignment": "open", "wrapping": "open", "direction": "open", "feel": "open" },
 "differences": []
}
```

Fill the answers (`match`, or `n/a` for `pictures`: the frame has none), record the fixed icon under
`differences` (`{ "what": "add icon missing in dark (theme token)", "status": "fixed" }`), and put the
entry into `design/parity/signoff.json`. The same for the other three runs.

## 6. Android

```sh
node <skill>/scripts/setup-parity-device.mjs . --device android-parity --appearance light --name tasks-parity-a
node <skill>/scripts/run-parity.mjs . --frame tasks-default --device android-parity --name tasks-parity-a
```

The Android runs flag one more thing: `[structure] tasks.task-row.bread` in every run, a band along the
row's bottom. The crop shows the emulator drawing the row 1 pt taller: the row used
`minHeight: 51.5`, which Android rounds up to the next pixel and iOS rounds down. The design says 52;
fix the value, capture again, look, record.

## 7. Prove it and report

```sh
node <skill>/scripts/check-signoff.mjs . --screen tasks
```

```
reference tasks-default (base)
tasks-default                    iphone-16-pro/light-en done | iphone-16-pro/light-ar done | iphone-16-pro/dark-en done | iphone-16-pro/dark-ar done | android-parity/light-en done | android-parity/light-ar done | android-parity/dark-en done | android-parity/dark-ar done
summary reports/parity/summary.json (a report's "Design match" line names this file)
check-signoff: 8 frame runs checked, 0 problems
RESULT: PASS
```

The report line: `Design match: Tasks matches its approved design reference on iPhone and Android,
light and dark, en and ar (0 waivers)   reports/parity/summary.json`, with the dark RTL `sheet.png`
linked and the two fixes named. Then shut down `tasks-parity-a` on both platforms, by UDID and serial.
