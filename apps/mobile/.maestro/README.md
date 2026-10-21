# Maestro E2E (offline-first sync)

Three flows plus a headless client B. `run.sh` drives them end to end. Its header
has the full story and prerequisites (maestro, bun, node >= 22.6, docker infra, migrations).

The flows run against an **e2e build**: release configuration, JS bundle embedded,
QA readout on, API at `localhost:3001`. No Metro at run time.

## Build once per native or JS change

```sh
apps/mobile/.maestro/scripts/build-e2e.sh ios <simulator-udid>
apps/mobile/.maestro/scripts/build-e2e.sh android <adb-serial>
```

The script sets `EXPO_PUBLIC_QA_READOUT=1`, `EXPO_PUBLIC_API_URL=http://localhost:3001`,
`EXPO_PUBLIC_WS_URL=ws://localhost:3001/sync`, `EXPO_NO_DOTENV=1` (no `.env*` loading)
and `CHATCRDT_E2E_BUILD=<per-run token>`, which it also writes to
`apps/mobile/.e2e-build-token` for the length of the build. The build only counts as
e2e when the two match (`config/e2eBuildToken.js`), so a `CHATCRDT_E2E_BUILD` in a
`.env` can't unlock the readout or the cleartext config. It then builds and installs:

- iOS: `expo run:ios --configuration Release --no-bundler`. ATS already allows
  localhost (`NSAllowsLocalNetworking`).
- Android: `expo prebuild` (the `config/withE2eLocalhostCleartext.js` plugin
  adds a release-only network security config, cleartext for localhost,
  127.0.0.1 and 10.0.2.2 only), then `expo run:android --variant release --no-bundler`.
  When it finishes, however it ends, the script removes the e2e network config,
  the e2e JS bundle and the release outputs packaged from it, so a later
  production build can't pick them up.

## Then run as often as needed

```sh
DEVICE_UDID=<simulator-udid|emulator-serial> apps/mobile/.maestro/run.sh
```

`run.sh` refuses a debug/dev-client build (no embedded bundle on iOS, debuggable
package on Android) and a release build without the QA readout (no
`chatcrdt-qa-readout:1` marker in the embedded bundle), before it touches the server
or the room. On Android it sets `adb reverse tcp:3001`. `DEVICE_UDID` is required for
Android (any adb serial).

## The QA readout can't ship to production

The readout (`chat-message-count`, `chat-order-digest`, `chat-ws-status`) is gated
only by the build-time `EXPO_PUBLIC_QA_READOUT=1` (`src/qa/qaReadout.ts`).
Two checks, both covered by tests that fail if they're unhooked
(`src/qa/qaReadoutWiring.test.ts`):

- `metro.config.js` runs `config/qaReadoutGuard.js`, which fails any production
  bundle (`expo export`, or `export:embed --dev false` from the Xcode/Gradle release
  bundle step) that has the flag outside the e2e build.
- Android's Gradle bundle task is incremental and used to reuse the last bundle
  without starting Metro, so a release right after an e2e build shipped the e2e
  bundle. `config/withQaReadoutBundleCheck.js` (prebuild) makes the flag and the e2e
  token inputs of that task, so it re-bundles. It also fails a release bundle that
  carries the readout marker outside the e2e build, and an e2e bundle that lacks
  it. iOS re-bundles on every build, so Metro's guard always runs there.
