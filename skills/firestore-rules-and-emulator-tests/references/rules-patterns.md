# Security rules patterns

How to write Firestore and Cloud Storage security rules that are closed by default and open exactly
what the app needs, with the reason for each pattern. Read this before adding a collection, a Storage
folder or a field, and when a rule denies a write the app really makes. Examples use a Tasks app
(lists, tasks, an activity log, a Premium entitlement); the templates hold the same rules complete.

## Contents

- What the rules are for
- The file skeleton and `rules_version = '2'`
- Deny by default
- Shared helpers: `isSignedIn()` and `isOwner(uid)`
- Client-writable documents: allow-lists and types
- Timestamps: `request.time`, never the client clock
- Append-only collections
- Server-only documents
- Reads: `get` and `list`
- Recursive wildcards
- Storage rules: owner path, content type and size
- Limits that change how rules are written
- Deploying rules
- Dated facts

## What the rules are for

The app's client talks to Firestore and Storage directly, so the rules are the only server-side
check between any client (the app, a modified build, a script with the app's public config) and the
data. The Admin SDK (Cloud Functions, a webhook, a script with a service account) bypasses rules
entirely, so rules only ever describe what a *client* may do. A rule that is wrong is a data leak or
a data loss for every user at once, which is why each rule has a test that proves it and a test that
proves its denial (the emulator-tests reference).

## The file skeleton and `rules_version = '2'`

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() { return request.auth != null; }
    function isOwner(uid) { return isSignedIn() && request.auth.uid == uid; }
    match /users/{uid}/tasks/{taskId} { ... }
  }
}
```

- **Always `rules_version = '2';` on the first statement line.** Version 1 is the default when the
  line is missing. Version 2 makes a recursive wildcard match zero or more path segments (version 1:
  one or more, and only at the end of a path) and is required for collection group queries. Storage
  rules need version 2 for the same wildcard behaviour and for cross-service rules.
- Functions defined inside `match /databases/{database}/documents` see `request` and `resource`; put
  the helpers there, once, and call them from every block.
- One `match` block per collection (or Storage folder), written out in full. The checker finds a
  block's tests by this path, below `/databases/{database}/documents` (Firestore) or `/b/{bucket}/o`
  (Storage).

## Deny by default

There is no catch-all `match /{document=**}` block. A path no block names is denied, so a new
collection is closed until its block and its tests land in the same change. An explicit
`allow read, write: if false;` catch-all adds nothing (no allow is already a denial) and invites the
next person to "temporarily" change `false` to `true`.

The two rules to never write, even for a day:

- `allow read, write: if true;` (or `allow read, write;` with no condition): open to the internet.
- The console's test-mode rule, `allow read, write: if request.time < timestamp.date(Y, M, D);`:
  everyone may read and write everything until that date. Projects created in test mode start with it
  (about 30 days, according to secondary sources only: FlutterFlow's documentation and community posts
  read on 2026-10-21; the console itself was not opened). Replace it with this skill's skeleton before
  the first deploy.

## Shared helpers: `isSignedIn()` and `isOwner(uid)`

```
function isSignedIn() { return request.auth != null; }
function isOwner(uid) { return isSignedIn() && request.auth.uid == uid; }
```

Every block that holds a user's data calls `isOwner(uid)` with the `{uid}` of its path. The data's
owner is in the path (`users/{uid}/...`), not in a field, so a client can never claim someone else's
data by writing a field. `request.auth != null` alone is "any signed-in user", which includes every
anonymous account anyone can create; it is never enough for user data.

## Client-writable documents: allow-lists and types

A create names every allowed key and every required key, and checks each field's type and bounds:

```
allow create: if isOwner(uid)
  && request.resource.data.keys().hasOnly(['title', 'listId', 'done', 'createdAt', 'updatedAt'])
  && request.resource.data.keys().hasAll(['title', 'done', 'createdAt'])
  && isTitle(request.resource.data.title)
  && request.resource.data.done is bool
  && request.resource.data.createdAt == request.time;
```

An update names the keys it may change, with `diff().affectedKeys()`, so fields set once (`createdAt`,
an owner id, a server-written flag) stay as they were:

```
allow update: if isOwner(uid)
  && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['title', 'listId', 'done', 'updatedAt'])
  && isTitle(request.resource.data.title)
  && request.resource.data.done is bool
  && request.resource.data.updatedAt == request.time;
```

- `request.resource.data` is the whole document after the write, `resource.data` before it.
- Type checks: `is string`, `is bool`, `is int`, `is number`, `is timestamp`, `is list`, `is map`;
  bounds with `.size()` for strings and lists. An optional field is `!('listId' in request.resource.data) || request.resource.data.listId is string`.
- Without `hasOnly`, a client adds `isPremium: true` or a 1 MB field to its own document and the app
  reads it back as truth. Without the type check, `done: "yes"` reaches every reader.
- Keep the allow-list equal to the app's document schema (the valibot schema the client writes with);
  a field added to the schema without the rule is denied, and its test shows it.

## Timestamps: `request.time`, never the client clock

Write `createdAt`/`updatedAt` with `serverTimestamp()` and check `== request.time`. The rule then
accepts only the server's time of this write; a client cannot backdate or future-date a document.
This holds offline too: the SDK sends the sentinel when it reconnects, and the comparison is made
then.

## Append-only collections

An event log, an audit trail, a history: `allow create` with its allow-list, and no update or delete
rule at all. Missing methods are denied, so an entry, once written, stays exactly as written.

```
match /users/{uid}/activity/{eventId} {
  allow read: if isOwner(uid);
  allow create: if isOwner(uid)
    && request.resource.data.keys().hasOnly(['kind', 'taskId', 'at'])
    && request.resource.data.kind in ['task-created', 'task-completed', 'task-deleted']
    && request.resource.data.taskId is string
    && request.resource.data.at == request.time;
}
```

The tests prove the update and the delete are denied for the owner, not only for another user.

## Server-only documents

A document only the server decides (a Premium entitlement from a store webhook, a quota counter, a
moderation result) has no client write rule. The Admin SDK writes it and bypasses the rules; the
client may read its own:

```
match /entitlements/{uid} {
  allow get: if isOwner(uid);
}
```

Never `allow write: if isOwner(uid)` "because the app sets it after a purchase": then any client
grants itself Premium. The tests prove the owner's own create, update and delete are denied.

## Reads: `get` and `list`

`read` is `get` (one document) plus `list` (queries). A query is allowed only when the rule holds for
every document it could return, so `allow read: if isOwner(uid)` on `users/{uid}/tasks/{taskId}` lets
the owner query their own tasks and nobody query all users' tasks. Give `get` alone when the app never
queries the collection (the entitlement above): a `list` you do not need is one more way to read.

## Recursive wildcards

`match /users/{uid}/{document=**}` matches every document below `users/{uid}`, in every collection,
including collections added next year. A write allowed there skips every allow-list and type check
the specific blocks have, because Firestore allows a request when *any* matching block allows it. The
checker fails a write, create, update or delete on a recursive wildcard (`wildcard-write`). Write one
block per collection. In Storage the same holds for `{allPaths=**}`.

## Storage rules: owner path, content type and size

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function isOwner(uid) { return request.auth != null && request.auth.uid == uid; }
    function isAcceptedImage() {
      return request.resource.contentType.matches('image/(jpeg|png|webp)')
        && request.resource.size < 5 * 1024 * 1024;
    }
    match /users/{uid}/attachments/{fileName} {
      allow read: if isOwner(uid);
      allow create, update: if isOwner(uid) && isAcceptedImage();
      allow delete: if isOwner(uid);
    }
  }
}
```

- The owner is the `{uid}` folder, exactly as in Firestore.
- `request.resource.contentType` is what the client declares; checking it keeps HTML, scripts and
  archives out of a bucket the app serves images from. `request.resource.size` is in bytes; cap it at
  what the app's resizer produces, so a client that skips resizing is denied, not billed.
- `request.resource` exists on create and update only; `resource` (the stored file) on read, update
  and delete.
- Storage rules that read Firestore (`firestore.get(...)`, for example to check an entitlement) are
  possible with version 2; this skill's templates do not use them, and they were not tested here.

## Limits that change how rules are written

From the Firestore rules reference, read on 2026-10-21 (re-verify:
https://firebase.google.com/docs/firestore/security/rules-structure):

- At most 10 `exists()`, `get()` and `getAfter()` calls for a single-document request or a query, 20
  for a batched write or transaction; over the limit the request is denied. Keep ownership in the path
  so most rules need no lookup.
- Nested match depth at most 10, path length at most 100 segments, function call depth at most 20,
  at most 1,000 expressions evaluated per request.

## Deploying rules

`firebase deploy --only firestore:rules,storage --project <real project>` replaces the live rules for
every user at once. It is outward-facing: the agent stops and asks the developer, after the emulator
tests pass, and never deploys from a branch the developer has not merged. Deploy commands use the
real project; emulator commands never do (the toolchain-and-ci reference).

## Dated facts

| Fact | Verified | Re-verify |
|---|---|---|
| Version 1 is the default; version 2 makes `=**` match zero or more segments and is required for collection group queries | 2026-10-21, Firebase docs "Structuring security rules" | https://firebase.google.com/docs/firestore/security/rules-structure |
| The templates' rules (allow-lists, `request.time`, append-only, server-only, Storage type and size) behave as the tests say on Firestore emulator 1.22.0 and the Storage rules runtime 1.1.3 | 2026-10-21, `npm run test:rules` in a scratch app: 20 tests passed; breaking an allow-list, an owner check, a delete rule or the image check each failed a test | `npm run test:rules` |
| The console's test mode starts with a date-limited open rule (about 30 days) | 2026-10-21, secondary sources only (FlutterFlow docs, community posts) | open a new project's Firestore Rules tab in the console |
