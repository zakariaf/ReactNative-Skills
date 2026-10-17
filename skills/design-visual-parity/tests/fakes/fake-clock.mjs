// node --import <this file> pins the wall clock of a script to $FAKE_NOW (an ISO instant), so the
// self-test can run check-signoff.mjs --draft "at 01:17 in Berlin on 1 October" (TZ=Europe/Berlin,
// FAKE_NOW=2026-09-30T23:17:00Z) and expect the local day. Only `new Date()` and Date.now() change.
const fixed = Date.parse(process.env.FAKE_NOW ?? '');
if (!Number.isNaN(fixed)) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }

    static now() {
      return fixed;
    }
  }
  globalThis.Date = FakeDate;
}
