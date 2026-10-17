# Example: the evidence of a passing run

What `check-e2e-report.mjs` prints for a full run on both platforms and the screenshot matrix, and how
a slice or release report quotes it (git-commits-and-reporting owns the report format). The numbers
are illustrative; paste the lines your run printed, never these.

```
$ node <skill>/scripts/check-e2e-report.mjs . --platform ios --screenshots
evidence: End-to-end (ios): 7/7 flows pass, quarantined: none (reports/e2e/ios/junit.xml)
evidence: Network (ios, allowlist): no disallowed socket (reports/e2e/ios/network.txt empty; 2 sampler(s) alive to the end, 412 samples)
evidence: Large text (ios): 4/4 a11y flow runs pass at the largest size (phone and tablet, en and ar); open the screenshots in reports/e2e/ios/large-text/
evidence: Screenshots (ios): 48 captured in 8 sets, 0 changed (reports/screenshots/ios/index.html)
check-e2e-report: 59 flows and screenshots checked, 0 problems
RESULT: PASS
```

In the report:

- **E2E (iOS 26.5, tasks-e2e-phone / tasks-e2e-tablet):** 7/7 flows, large text 4/4, no disallowed
  socket with both samplers alive to the end; matrix 48 screenshots, 0 changed. The same on Android
  (tasks-e2e-phone AVD; name the system image's API level the run used).
- **Quarantined:** none.
- **Looked at:** the large-text screenshots (task rows wrap to two lines in `ar`, nothing clipped).
- **For the reviewer:** gallery rows `ios/tablet/ar-dark/tasks` and `android/phone/en-dark/tasks`
  (new empty-state illustration, baselines updated with `Gate-Change: tasks empty state redesign`).

A run that was filtered (`--include-tags`) or skipped the large-text step fails `run-filtered` and is
never quoted as evidence. Without the network line (a sampler failed `network-sampler`) or the
screenshot line (a combination failed `screenshot-capture-failed`), the run is not evidence either.
