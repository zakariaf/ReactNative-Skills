__ONE_SENTENCE_OUTCOME_IN_USERS_WORDS__.

Please say "ship" when __APP_NAME__ __VERSION__ (iOS build __IOS_BUILD__, Android build __ANDROID_BUILD__) may go to review. Until then the builds stay in TestFlight and internal testing and I keep working on __OTHER_WORK__.

Evidence: __APP_OR_AREA__ release __VERSION__ on __YYYY_MM_DD__, commit __SHA__

Checks
- Types, lint, format: pass
- Tests: __PASSED__/__TOTAL__ pass (unit __UNIT_COUNT__, golden __GOLDEN_COUNT__), random seed __SEED__
- Coverage: lines __LINES__% (gate 90), logic folders __LOGIC__% (gate 95)   reports/coverage/coverage-summary.json
- Mutation: __SCORE__% (break 75), survivors explained under Details   reports/stryker/mutation.json
- End-to-end: iOS __IOS_FLOWS_PASSED__/__IOS_FLOWS_TOTAL__, Android __ANDROID_FLOWS_PASSED__/__ANDROID_FLOWS_TOTAL__ flows pass, quarantined: __NONE_OR_LIST__   reports/e2e/ios/junit.xml, reports/e2e/android/junit.xml

What changed for users
- __ONE_LINE_PER_BEHAVIOUR_IN_USERS_WORDS__

Please look at (at most 5)
- __SCREENSHOT_OR_GALLERY_ROW__, because __REASON__

Goldens and baselines changed on purpose
- __FILE_OR_FOLDER__: __WHAT_CHANGED_AND_WHY__ (Gate-Change trailer in __SHA__), or "none"

Human checks (not blocking)
- On-device check: __WHAT_TO_TRY_ON_TESTFLIGHT_AND_INTERNAL_TESTING__
- Native-language review of changed texts: __PENDING_TEXTS_OR_NONE_PENDING__

Not tested or not verified
- Sound, haptics and smoothness on a real phone: the on-device check above
- Purchases against the real stores: TestFlight and Play internal testing
- __ANYTHING_ELSE_THAT_DID_NOT_RUN__ (a rehearsal or a dry run belongs here, never under Checks)

Details
- Mutation survivors: __EACH_SURVIVOR_AND_WHY__
- Upload tags: __UPLOAD_TAGS__
