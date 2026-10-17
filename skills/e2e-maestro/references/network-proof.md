# The runtime network proof

What the socket sampler proves while the flows run, how it finds the app's sockets on each platform,
and what to do with a line in `network.txt`. The static half of the network policy (fetch only in
`src/api/` behind the `ApiClient` port, the SDK inventory, the privacy declarations) belongs to
networking-and-server-state and privacy-and-store-declarations; this is the part only a running app
can show.

## Contents

- The three modes
- How the sampler works on iOS
- How the sampler works on Android
- Proof the samplers were watching
- Allowed hosts
- Reading network.txt
- Limits

## The three modes

`contracts/e2e.json` `network` (required):

| Mode | The run fails on | Use for |
|---|---|---|
| `offline-only` | any connected socket to a host other than loopback | apps that never use the network (privacy-and-store-declarations' offline-only profile), and every offline journey's proof |
| `allowlist` | a socket to an address none of `allowHosts` resolves to | apps with an API: list the API host and any host the test build legitimately reaches |
| `off` | nothing (needs `why`) | a test build that only talks to a local mock server, until the sampler can tell it apart |

Loopback (`127.*`, `::1`, `::ffff:127.*`) is always allowed: a test build may talk to itself.

iOS simulators have no airplane mode, so an offline journey sets the debug link's `offline=1` (every
`ConnectivityPort` reader follows it, debug-menu-and-test-hooks) and the sampler shows that nothing
went out anyway. A JavaScript-only counter would miss native SDKs; the sampler sees every socket of
the app's process.

## How the sampler works on iOS

A simulator app is a macOS process, so the host can see its sockets without `sudo`:

1. `pgrep -f 'Devices/<udid>/.*\.app/<Executable>( |$)'` finds the app's process on this simulator
   only (`appProcessPattern`): other sessions run the same app on their own simulators, and their
   traffic is not this run's (a sampler that watched every copy once filled a run's report with
   another session's sockets to an ad network). Any bundle folder, because `clearState` reinstalls the
   app as `<bundle id>-<timestamp>.app`.
2. `lsof -nP -i -a -p <pid>` lists its sockets once a second; every connected line (`->`) whose peer
   is not loopback is a candidate (`lsofPeers`).

App Store traffic (StoreKit) runs in system daemons and is invisible here. Seen on iOS 26.5
(2026-10-14): the pattern found the preview build's process (`TasksPreview`) on its own simulator
only; the reference app opened no socket, so no peer line has been observed yet.

## How the sampler works on Android

The emulator's processes are inside the emulator, so the sampler reads the kernel's socket tables:

1. `adb -s <serial> shell pm list packages -U <package>` gives the app's uid, and
   `adb -s <serial> shell pidof <package>` tells whether the app runs right now.
2. `adb -s <serial> shell cat /proc/net/tcp` (and `tcp6`, `udp`, `udp6`) once a second; rows owned by
   that uid with a non-zero remote address are its connected sockets (`procNetPeers` decodes the
   little-endian hex addresses, IPv4-mapped IPv6 included).

Play Services and other system apps have their own uids and do not count. Seen on an Android API 35
emulator (2026-10-14): `pm list packages -U` gave the uid and `adb shell` reads `/proc/net/tcp6` in
the format the parser expects; the reference app opened no socket, so no peer line has been
observed yet. The API 36 default image (`android.systemImage`) has not run the sampler end to end
yet; rerun once on it and note the result here.

## Proof the samplers were watching

An empty `network.txt` looks the same whether the app stayed quiet or the sampler was blind: a sampler
that crashed at import, matched no process (a wrong executable or package) or died halfway leaves the
same empty file. So each sampler rewrites `network.txt.sampler-<device id>.json` after every sample
(`samples`, `appSamples`: samples that found the app's process, `lastError`: the last pgrep, lsof or
adb failure), and at the end the runner (`proveSamplersAlive`, `sampler-evidence.ts`):

1. reads every status, waits 2.5 s (two more samples), reads them again;
2. finds a problem when a status is missing (the sampler never started), the process exited before the
   end, the sample count did not grow (it stopped), or `appSamples` is 0 (it never found the app);
3. stops the samplers, writes `network-samplers.json` next to `network.txt`, and fails the run on any
   problem.

`check-e2e-report` (`network-sampler`) requires that file whenever the mode is not `off`, an entry for
every device of `run.json` (the phone and the large-text tablet), each with samples, app samples and
no problem. Only then does it print the network evidence line. Because no peer line has been observed
on either platform yet (see above), this liveness proof is what makes an empty file mean something.

## Allowed hosts

In `allowlist` mode the sampler resolves each `allowHosts` entry every 30 seconds through the
machine's resolver (`dns.lookup(host, { all: true })`) and allows those addresses. A simulator uses
the host's resolver and an emulator forwards to it, so the app and the sampler see the same answers
at the same moment. A CDN can still rotate addresses between two lookups: the report then names the
address, and `dig -x <address>` tells you whose it is.

## Reading network.txt

Each line is `<platform> <device> <protocol> <peer>`, written once per peer. For each:

1. Find who opened it: the address's owner (`dig -x`, `whois`), the app's own code (`src/api/` only,
   through the `ApiClient`), and every SDK in the test build (ads, analytics, crash reporting, push).
2. An SDK that phones home in a test build belongs behind its port and off by default in test builds
   (crash-reporting-and-observability, analytics-and-consent, push-notifications). Ads are off in the
   E2E build (`ADS_MODE=off`, `contracts/e2e.json` `buildExtra`); a line from an ad network means the
   build guard was bypassed or the ads switch leaks. Ads flows belong in a manual flow folder.
3. If the host is intended, add it to `allowHosts` together with the reviewer: it is also a privacy
   declaration (privacy-and-store-declarations). Never add a host just to get a green run, and never an
   ad network's.

`check-e2e-report` fails on any line (`network-sockets`), and on a missing `network.txt` or
`network-samplers.json` or a sampler that was not watching when the mode is not `off`
(`network-sampler`).

## Limits

- The sampler samples once a second: a connection that opens and closes in between is missed. It
  proves "no long-lived or repeated traffic", not "no packet ever"; the static checks cover the rest.
- `lsof` and `/proc/net` show connected sockets, not DNS lookups or traffic through system services.
- A run with `network.mode` `off` has no runtime proof, and its evidence line says so.
- `offline=1` simulates connectivity state: every `ConnectivityPort` reader sees offline, but fetch,
  DNS and native SDKs still have the network. The sampler proves nothing went out; it does not prove
  the app's real request-failure path (fetch errors, paused mutations, retries). An app whose offline
  handling depends on that path also runs its offline journeys on the Android emulator under real
  airplane mode (`subflows/airplane-mode.yaml`, guarded to Android; flows.md "Platform differences").
