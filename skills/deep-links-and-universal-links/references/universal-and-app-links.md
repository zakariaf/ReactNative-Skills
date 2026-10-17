# Verified links: iOS universal links and Android App Links

How the app proves it owns a web domain so that `https://<host>/...` links open the app instead of the
browser, on iOS and on Android, from one contract. Facts below come from Apple's "Supporting associated
domains" and TN3155 "Debugging universal links", Android's "Verify App Links", "Add intent filters for App
Links", "Configure website associations and dynamic rules" and the Android 12 behaviour changes, and Expo's
SDK 57 linking guides, all read on 2026-10-14. Re-verify: `https://docs.expo.dev/linking/ios-universal-links.md`,
`https://docs.expo.dev/linking/android-app-links.md`, and Apple's and Android's pages above.

## Contents

1. Custom scheme vs verified links: which to use
2. One contract, three outputs
3. iOS: the applinks entitlement and the AASA file
4. Android: the App Links intent filter and assetlinks.json
5. Hosting the well-known files (a human step)
6. Variants, domains and certificates
7. Debugging verification
8. Pitfalls and the rule each one became

## 1. Custom scheme vs verified links: which to use

| | Custom scheme `tasks://...` | Verified `https://tasks.example.com/...` |
|---|---|---|
| Who can receive it | any app that registers the scheme (iOS: undefined which; Android: chooser) | only the app the domain names (after verification) |
| Without the app installed | nothing happens (or an error page) | the web page opens |
| Typed in Safari's address bar | asks to open the app (any app registering the scheme) | does not open the app (direct navigation stays in the browser) |
| Needs | `scheme` in app.config.ts (per variant, app-variants-and-environment) | a domain the developer controls, HTTPS hosting, the entitlement / intent filter, the AASA and assetlinks.json files |
| Use for | OAuth redirects (with PKCE), development, internal QA links | everything people share, email links, anything carrying a secret |

Both reach the same gate. Expo recommends verified links for most apps; keep the custom scheme for the
OAuth redirect and QA. A tap on a verified link from a page **on the same domain** stays in the browser
(Safari treats it as navigation); link to the app from the website through another subdomain if needed
(TN3155).

## 2. One contract, three outputs

```
contracts/deep-links.json  (hosts per variant, webPaths, appleTeamId, androidCertFingerprints, wellKnownDir)
   ├─ scripts/deep-links/link-native-config.ts → app.config.ts: ios.associatedDomains, android.intentFilters
   │      └─ Constants.expoConfig (embedded) → the gate's accepted hosts (link-origins.ts)
   └─ write-well-known.mjs → <wellKnownDir>/<host>/apple-app-site-association, assetlinks.json
```

Why one source: the entitlement, the intent filter, the gate and the two files must name the same hosts
and paths. When they drift, links silently open the browser, open the app for pages it then refuses, or
open nothing. `check-deep-links` compares all of them for every variant (`native-links`, `web-paths`,
`well-known`).

Wire the native half once in app.config.ts (`examples/app-config-deep-links.ts`):

```ts
const links = linkNativeConfig(readLinkContract(projectRoot), variant);
// ios: { ..., associatedDomains: links.associatedDomains }
// android: { ..., intentFilters: links.intentFilters }
```

Changing hosts or paths in the native config needs a new native build (the entitlement and the manifest
are compiled in); changing only the hosted AASA paths needs a reinstall to refetch on iOS (section 3).

## 3. iOS: the applinks entitlement and the AASA file

**Entitlement.** `ios.associatedDomains: ['applinks:tasks.example.com']`: service prefix, host only, no
`https://`, no path, no trailing `/`, no port (Expo's most common mistake list, TN3155). `*.example.com`
covers subdomains; the AASA for a wildcard is served from the root domain. With EAS Build the Associated
Domains capability is synced to the App ID automatically; with a local build enable it on the App ID in the
Apple Developer portal (ios-release-testflight, eas-build-and-submit).

**Alternate mode.** `applinks:dev.example.com?mode=developer` bypasses Apple's CDN for devices in Developer
Mode, with development-signed builds only. Never in production (`native-links` fails it).

**The AASA file** (`https://<host>/.well-known/apple-app-site-association`, no extension):

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["A1B2C3D4E5.com.example.tasks"],
        "components": [{ "/": "/tasks/*" }, { "/": "/lists/*" }, { "/": "/verify-email" }]
      }
    ]
  }
}
```

- `appIDs` are `<Team ID>.<bundle id>` of every variant that uses this host.
- `components` (iOS 13+) match path (`"/"`), query (`"?"`) and fragment (`"#"`), with `"exclude": true` for
  pages that must stay on the web. `*` matches any characters within the pattern, `?` one character. The
  legacy `appID` + `paths` format still works; never mix the two in one file (TN3155).
- At most 128 KB uncompressed. Valid JSON; no `webcredentials` unless the entitlement has it too.

**How iOS fetches it.** Since iOS 14 the device asks Apple's CDN, not the app's server. The CDN fetches the file
within about 24 hours of a change; a device downloads it at install and app update, then checks roughly once
a week. There is no CDN invalidation: to see a new AASA on a test device, reinstall the app (or use
developer mode). So add paths before the app version that needs them ships.

**Smart App Banner.** Pages people open in Safari can offer the app with
`<meta name="apple-itunes-app" content="app-id=<App Store id>">` (web-support for the site).

## 4. Android: the App Links intent filter and assetlinks.json

**Intent filter** (what `linkNativeConfig` writes):

```ts
{
  action: 'VIEW',
  autoVerify: true,
  category: ['BROWSABLE', 'DEFAULT'],
  data: [{ scheme: 'https' }, { scheme: 'http' }, { host: 'tasks.example.com' }, { pathPattern: '/tasks/.*' }],
}
```

- `autoVerify` is required: without it Android 12+ resolves the link to the browser, and older versions show
  a chooser. Android's guide asks for both `http` and `https` data elements; no other scheme in the same
  filter (it prevents verification). The custom scheme lives in its own filter, which `scheme` creates.
- All `<data>` elements of one filter merge (every scheme with every host and path), so one filter per set
  of hosts that share paths is right.
- Paths: Android 14 and lower read only the manifest, so the filter lists a `pathPattern` per web path
  (`/tasks/*` becomes `/tasks/.*`). Android 15+ with Google services can refine paths from
  `dynamic_app_link_components` in assetlinks.json, but never widen the manifest scope.
- Multiple hosts: Android 12+ verifies each host on its own; Android 11 and lower verify the app only when
  every host in the manifest verifies. Each subdomain needs its own assetlinks.json (a wildcard host is
  verified at the root host).

**assetlinks.json** (`https://<host>/.well-known/assetlinks.json`, `Content-Type: application/json`):

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.example.tasks",
      "sha256_cert_fingerprints": ["14:6D:E9:83:...:E5"]
    }
  }
]
```

**Which fingerprint.** The SHA-256 of the certificate that signs what people install:
- EAS-managed keys: `eas credentials -p android` shows each build profile's SHA256 fingerprint.
- Play App Signing (the default for new apps): Google re-signs uploads with the app signing key, so the
  upload key's fingerprint (from `keytool -list -v -keystore <upload keystore>`) is wrong for installs from
  Play; copy the "Digital Asset Links JSON" from Play Console > Release > Setup > App signing. List both
  when internal testers install builds signed with the upload key.
- Debug and preview builds signed with other keys need their own fingerprints (their own package too,
  since each variant has its own id).

Reading a fingerprint is safe; reading or copying the keystore or its passwords is not part of this skill.

## 5. Hosting the well-known files (a human step)

`node ${CLAUDE_SKILL_DIR}/scripts/write-well-known.mjs .` writes `<wellKnownDir>/<host>/` for each host.
A person deploys each folder to `https://<host>/.well-known/` and confirms:

- HTTPS with a certificate every device trusts; **no redirect** (a 301/302 on the AASA fails on iOS; the
  apex-to-www redirect is the usual culprit); reachable from every IP address and user agent (no bot
  protection, geo-blocking or auth in front of `/.well-known/`).
- `assetlinks.json` served as `application/json`; the AASA as JSON (`application/json` is safe).
- `curl -v https://<host>/.well-known/apple-app-site-association` and
  `curl -A "Link-Check-Bot/1" https://<host>/.well-known/assetlinks.json` return 200 and the files.
- When the app's own Expo Router web output serves the domain, copy that host's pair into
  `public/.well-known/` (the generator keeps one folder per host, so several hosts stay apart).

The agent stops here and asks the developer to deploy; uploading to a website is outward-facing.

## 6. Variants, domains and certificates

- Each variant has its own bundle id and package, so each variant that should open links needs its hosts
  in the contract and its fingerprints. Production usually owns the real domain; preview can share it (the
  AASA then lists both app ids, and on Android the most recently installed app wins identical paths) or use
  `preview.example.com` (cleaner: testers' links never fight the store app).
- Development builds normally have no hosts: test verified links on preview builds, or give development a
  developer-mode host.
- A variant without hosts gets no `applinks` entitlement and no App Links filter, so a missing capability
  never breaks its signing. `linkNativeConfig()` then leaves `associatedDomains` out entirely: prebuild
  (`@expo/config-plugins` `ios/Entitlements.js`) writes the entitlement for any array, an empty one too,
  and EAS capability sync would turn Associated Domains on for an App ID with no domain. Spread it in only
  when present (`examples/app-config-deep-links.ts`); `native-links` fails on an empty array.
- **Pitfall: an update published with another variant's config.** The gate reads its schemes and hosts
  from `Constants.expoConfig` (directly and through expo-linking's `collectManifestSchemes()`). With
  expo-updates, once the app runs a downloaded update that object is the update manifest's
  `extra.expoClient`, the app config as it evaluated on the machine that ran `eas update`, not the config
  embedded in the build (read in expo-constants 57.0.20 `build/Constants.js`: only an embedded launch
  returns the build's own config). An `eas update` run with `APP_VARIANT=development` against the
  production channel therefore swaps the accepted scheme to the development one and the hosts to none:
  after the restart every verified link and every custom-scheme link of the production build is refused
  as a foreign host or scheme, while the OS still delivers them. Publish every update with the build's
  `APP_VARIANT`, which app-variants-and-environment sets per EAS environment (`eas update --environment
  production`), and treat "links stopped opening after an update" as this until proved otherwise.

## 7. Debugging verification

**iOS**
- Paste the link in Notes and long-press it: "Open in <App>" means the association works (TN3155).
- Settings > Developer > Universal Links > Associated Domains Development, then Diagnostics with the full
  URL (iOS with Developer Mode on).
- `sudo swcutil dl -d <host>` downloads the AASA as the system does; `sudo swcutil verify -d <host> -j
  <file> -u <url>` checks that a URL matches (macOS).
- A sysdiagnose's `swcutil_show.txt` shows `Site/Fmwk Approval: approved | denied` per app id and the last
  and next CDN check.
- A link opens Safari after once working: the person chose "Open in Safari" (that choice sticks per domain);
  long-press and choose the app again.

**Android** (always name the device: `adb -s <serial>`)
- `adb -s <serial> shell pm get-app-links <package>`: `verified` per host; `none` means not done yet (wait
  20 seconds or more after install), `legacy_failure` or a code ≥ 1024 means the file or fingerprint is wrong.
- Android 12+: `adb -s <serial> shell pm set-app-links --package <package> 0 all`, then
  `adb -s <serial> shell pm verify-app-links --re-verify <package>`, wait, and read `get-app-links` again.
- `adb -s <serial> shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://<host>/tasks/task-7" <package>`.
- The device needs the internet for verification; an emulator without Google services cannot verify.

## 8. Pitfalls and the rule each one became

- **`applinks:https://example.com`** in the entitlement: universal links never worked (`native-links`).
- **An https intent filter without `autoVerify`**: Android 12+ users always landed in the browser
  (`native-links`).
- **The upload key's fingerprint** in assetlinks.json with Play App Signing on: verification failed for
  every install from Play (`link-contract` asks per variant; the reference says which key).
- **A web path the app cannot open** (`/settings/*` in the AASA): the app started for that page and showed
  its first screen (`web-paths`).
- **A changed AASA expected to apply at once**: devices kept the old file for days; ship paths ahead.
- **A redirect from the apex to www** in front of the AASA: iOS refused the association.
- **Generated files edited by hand on the server**: drifted from the app config (`well-known` compares
  them with what the contract and the config give).
