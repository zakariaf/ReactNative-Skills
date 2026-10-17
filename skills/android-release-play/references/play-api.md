# The Google Play Developer API

The calls `scripts/release-android/play-client.ts` makes on the local lane, with Node's own `fetch`
and a JWT signed by `node:crypto`: no npm package, no Google client library. Release tooling only;
the app itself reaches the network through `src/api` (networking-and-server-state). The EAS lane
makes the same calls inside EAS Submit.

## Contents

- Authentication
- Uploading a bundle
- Changing a track
- Answers and stops
- What the API cannot do

## Authentication

A service account (human-steps.md) signs a JWT, which Google exchanges for an access token:

| Field | Value |
|---|---|
| header | `{ "alg": "RS256", "typ": "JWT" }` |
| `iss` | the service account's e-mail (`client_email` of the JSON key) |
| `scope` | `https://www.googleapis.com/auth/androidpublisher` |
| `aud` | `https://oauth2.googleapis.com/token` |
| `iat`, `exp` | now, and now plus 3600 seconds |

`POST https://oauth2.googleapis.com/token` with `content-type: application/x-www-form-urlencoded`,
`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` and `assertion=<jwt>` answers
`{ "access_token": "...", "expires_in": 3599 }`. The token stays in the client's closure for the run
and goes out only as `authorization: Bearer <token>`. The token endpoint is a constant, never read
from the key file. "Now" comes from `scripts/clock/system-clock.ts`, the one tooling module that reads
the wall clock (dependency-management).

## Uploading a bundle

All under `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/<package>/`, the
upload under `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/<package>/`.
One edit carries one change and is committed at the end; an edit that is never committed expires.

| Step | Call | Body | Answer used |
|---|---|---|---|
| `edits.insert` | `POST .../edits` | none | `id` |
| `edits.bundles.upload` | `POST .../edits/<edit>/bundles?uploadType=media` | the bundle bytes, `application/octet-stream` | `versionCode` Google read from the bundle |
| `edits.tracks.update` | `PUT .../edits/<edit>/tracks/<track>` | `{ "track": "internal", "releases": [{ "versionCodes": ["15"], "status": "completed", "releaseNotes": [{ "language": "en-US", "text": "..." }] }] }` | |
| `edits.commit` | `POST .../edits/<edit>:commit` (`?changesNotSentForReview=true` only with `--changes-not-sent-for-review`) | none | the release is live on the track, or waits to be sent for review |

`uploadBundle` runs the four calls; the track is the contract `uploadTrack`, the status `completed`
(or `draft` for a draft app), and release notes go out in the contract `releaseNotesLanguage`
(default `en-US`; the language of the app's default store listing). Before the first call the CLI
refuses a stamp whose versionCode an Android upload tag already holds (`usedVersionCodeProblems`), so
a second `upload` of the same bundle never reaches Google.

## Changing a track

`setTrackRelease` runs `edits.insert`, `edits.tracks.update` and `edits.commit` with a release built
by `rollout.ts`: `inProgress` with a `userFraction` for a staged rollout step, `completed` at 1,
`halted` to stop. The versionCode was uploaded earlier (to a testing track), so promotion needs no
bytes. `versionCodes` must include every code the track should keep serving; this library promotes
one code per release.

## Answers and stops

Every non-2xx answer becomes a `PlayStop` with a reason. The CLI prints it and exits 1, never
retrying: a retry can lock the service account, upload twice or burn a version code.

| Reason | Answer | What a person does |
|---|---|---|
| `api-not-enabled` | 403 with `SERVICE_DISABLED` or "has not been used in project" | enable the Google Play Android Developer API in the service account's Google Cloud project |
| `draft-app` | 400 "Only releases with status draft may be created on draft app" | upload as a draft (`--draft-app`, or `releaseStatus: "draft"`) and roll it out in the Console, or finish the app's setup tasks |
| `version-code-used` | 400/403 "version code that has already been used" | nothing: build again with the next number; never lower `ANDROID_VERSION_CODE` |
| `policy-declarations` | Google's message names a declaration, App content or a policy declaration, violation or requirement (checked before the 401/403 rule, since Play answers some with 403; a bare "policy", as in "denied by IAM policy", is not enough) | complete App content (Data safety, advertising ID, permissions declarations) |
| `auth` | 401 or 403 otherwise ("The caller does not have permission", "denied by IAM policy") | give the service account release permission for this app in Play Console (Users and permissions), or replace a deleted key |
| `app-not-found` | 404 ("Package not found") | create the app in Play Console with this application id; the first upload is a person's |
| `changes-not-sent-for-review` | `edits.commit` answers "Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true" (Google's wording as developers report it; the parameter itself is documented, verified on 2026-10-14 at developers.google.com/android-publisher/api-ref/rest/v3/edits/commit; not reproduced) | decide whether to commit without review: with the developer's word the same command runs again with `--changes-not-sent-for-review`, and a person sends the changes for review in Play Console |
| `http-error` | anything else | read Google's one-line message in the stop; ask before any retry |

The message names the step, the reason, the HTTP status and Google's one-line `error.message`; never
the token, a header or the key. These stops match git-commits-and-reporting's stop-and-ask list.

## What the API cannot do

- Create an app, accept policies, fill App content or Data safety: Play Console only.
- Grant itself more permission than the service account was given in Play Console.
- Make a one-time product before a build with the BILLING permission was uploaded (in-app-purchases).
- Undo an upload or free a versionCode.
