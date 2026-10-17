# Signing and the App Store Connect key

How an iOS build is signed without anyone clicking in Xcode, what the team API key must be, and the rules that keep the key and the tokens made from it from ever leaking. The local lane signs with the key itself; on EAS the same rules hold for EAS-managed credentials (`eas credentials`, owned by `eas-build-and-submit`).

## Contents

- What signs what
- The key: kind, role, location
- The three environment variables
- Rules for the key and for tokens
- Where the key may be read, and by whom
- The keychain
- Entitlements
- Leak response
- What was verified and what was not

## What signs what

| Step | What Xcode does | Needs |
|---|---|---|
| **Archive** (`xcodebuild archive -allowProvisioningUpdates` plus `-authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID`) | talks to the developer portal with the key: registers the App ID for the bundle id if needed, creates or downloads a development profile, signs the archive with an **Apple Development** certificate whose private key is in the login keychain; creates that certificate when the team has none usable on this Mac (not verified with a key alone; fallback: the developer signs in once in Xcode > Settings > Accounts) | the team key, an unlocked login keychain, `DEVELOPMENT_TEAM` (from `ios.appleTeamId` at prebuild time) |
| **Export** (`xcodebuild -exportArchive`, `method app-store-connect`, `signingStyle automatic`) | re-signs for distribution with a **cloud-managed** Apple Distribution certificate, whose private key stays with Apple, and an App Store profile | a team key with the Admin role |
| **Validate / upload** (`xcrun altool`) | authenticates with the same key | `--api-key <id> --api-issuer <issuer>`; altool finds `AuthKey_<id>.p8` itself |

There is exactly one signing method: automatic signing with the team API key. Never export or import `.p12` files, never create profiles by hand, never switch signing method to get past an error (the failure playbook says what to do instead). Check the identities a Mac holds with `security find-identity -v -p codesigning` (it prints names and hashes, never keys).

## The key: kind, role, location

| Item | Rule |
|---|---|
| Kind | a **team** key. Individual keys cannot use the provisioning endpoints. altool names individual keys `ApiKey_<id>.p8` (then `--api-key-subject user`); team keys are `AuthKey_<id>.p8`, but only App Store Connect > Users and Access > Integrations shows the real kind and role |
| Role | **Admin**. Only the Account Holder or an Admin can create cloud-managed distribution certificates; an App Manager key can upload but not sign |
| Created by | the developer (human step "API key") |
| Location | `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`, mode `600`, outside the repo |
| Checked by the agent | path and mode only: `test -f "$KEY_PATH"` and `stat -f %Sp "$KEY_PATH"` must print `-rw-------`. The file is never opened |

## The three environment variables

The developer puts them in the shell profile (`~/.zshenv`), never in the repo:

```sh
export ASC_KEY_ID=<Key ID>          # 10 characters, e.g. 2X9R4HXF34
export ASC_ISSUER_ID=<Issuer ID>    # UUID from Users and Access > Integrations
export APPLE_TEAM_ID=<Team ID>      # 10 characters; app.config.ts passes it to ios.appleTeamId
```

Every tool uses exactly these three names. The key path is derived: `~/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8`. `APPLE_TEAM_ID` must be set **before prebuild**, because prebuild writes `ios.appleTeamId` into the Xcode project as `DEVELOPMENT_TEAM`; without it the archive fails with "requires a development team" (`check-release-setup` rule `team-id` checks the config line). CI keeps them as masked secrets of the job (`ci-pipeline-and-gates`), the key file restored to the same path with mode 600 and deleted after the job.

## Rules for the key and for tokens

1. **Never open, print, copy, move, commit or log the `.p8` file.** Tools receive only the three ids.
2. **Tokens are secrets too.** Never print the JWT, the `Authorization` header, or a full request with headers. Error messages from `ascRequest` carry Apple's error codes only.
3. **Code that reads the key never passes it on a command line or through an environment variable, and never writes it to a temporary file.**
4. **Real AdMob ids are not secrets** (every store build carries them), but they live in one config file and reach the runtime only in live builds (`admob-ads-and-consent`).
5. **Stop and ask, never retry,** on a signing or authorisation failure: retry loops can lock the account or burn build numbers.

## Where the key may be read, and by whom

| Reader | How | Why it is allowed |
|---|---|---|
| `xcodebuild` | `-authenticationKeyPath` names the file | Apple's own tool signs with it |
| `xcrun altool` | finds `AuthKey_<id>.p8` in `~/.appstoreconnect/private_keys` by itself | Apple's own tool |
| `scripts/asc/asc-credentials.ts` | `readFileSync` into memory, to sign one 15-minute ES256 JWT | the only project file allowed to read it (`check-release-setup` rule `key-read`) |

Claude Code's `.claude/settings.json` denies `Read(~/.appstoreconnect/**)`, `Read(**/*.p8)`, `Read(**/AuthKey_*)`, `Read(**/*.p12)` and `Read(**/*.mobileprovision)` (the canonical settings file has them; rule `claude-deny`). Those rules cover the agent's own file tools and recognised shell reads, not child processes (the release script must be able to sign), so rule 1 is the real guard and the deny rules are defence in depth. Other agents: put the same read denials in their own permission file.

Commits: `.gitignore` lists `*.p8`, `AuthKey_*`, `ApiKey_*`, `*.p12`, `*.mobileprovision`, `*.xcarchive`, `*.ipa` (rule `gitignore-secrets`), and the pre-commit no-secrets job (`quality-gates`) refuses staged key or signing files even with `git add -f`. Before a release, `git grep -n "BEGIN PRIVATE KEY"` must find nothing; rule `key-material` scans every file outside installed skills, `node_modules` and generated folders.

## The keychain

The archive runs `codesign` with a key in the login keychain, which must be unlocked: normal in the developer's logged-in desktop session, **not** in an SSH session. Preflight: `security show-keychain-info ~/Library/Keychains/login.keychain-db` must exit 0 (its exit code on a locked keychain is not verified).

- `errSecInternalComponent` from `codesign` means the keychain is locked. Stop; the developer runs `security unlock-keychain ~/Library/Keychains/login.keychain-db` in Terminal, or starts the run from the desktop. The agent never handles the password.
- A macOS dialog "codesign wants to access key ..." means the key's access list does not include codesign yet; the developer clicks **Always Allow** once.

## Entitlements

- Prebuild writes `ios/<App>/<App>.entitlements` from the config plugins (push, Sign in with Apple, associated domains). Every entitlement must be allowed by the App ID; automatic signing adds capabilities the plugins request when the key has the Admin role.
- A StoreKit test harness or a debug configuration may add `get-task-allow`; the gate proves it is absent from the signed export (`codesign -d --entitlements - --xml <App>.app`, rule `get-task-allow`).
- `aps-environment` is `production` in an App Store export; a development value there means a wrong configuration was archived.

## Leak response

If key material ever appears in the repo, a log or a report: stop, and ask the developer to revoke the key in App Store Connect > Users and Access > Integrations, create a new team key with the Admin role, replace the file and update `ASC_KEY_ID` / `ASC_ISSUER_ID`. Then check `git log -p -S "BEGIN PRIVATE KEY"` and the `reports/` folder; a key that reached a pushed commit is compromised even after a history rewrite.

## What was verified and what was not

Verified on 2026-10-14 (Xcode 26.6, altool 26.40.1): every ExportOptions key used here appears in `xcodebuild -help` (`testFlightInternalTestingOnly`: "this build cannot be distributed via external TestFlight or the App Store"); altool lists `--upload-package`, `--validate-app`, `--build-status`, `--api-key`, `--api-issuer`, `--api-key-subject` and `--wait`; both export options templates pass `plutil -lint`; the JWT signer verifies with Node `crypto.verify` using a throwaway P-256 key (the template's test). Earlier, on the source project, an unsigned device archive (`CODE_SIGNING_ALLOWED=NO`) succeeded and the live REST API answered a throwaway key with `401 NOT_AUTHORIZED`, parsed into `errors[0].code`.

Not run (needs a real team key, and an agent never uses it outside a real release): a signed archive and export, `--validate-app`, `--upload-package`, any REST call with a real key, the entitlement check on a distribution-signed app. Record what the first real release shows (the failure playbook lists the open questions).
