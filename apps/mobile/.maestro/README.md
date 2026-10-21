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

The script sets `CHATCRDT_E2E_BUILD=1`, `EXPO_PUBLIC_QA_READOUT=1`,
`EXPO_PUBLIC_API_URL=http://localhost:3001` and `EXPO_PUBLIC_WS_URL=ws://localhost:3001/sync`.
It then builds and installs:

- iOS: `expo run:ios --configuration Release --no-bundler`. ATS already allows
  localhost (`NSAllowsLocalNetworking`).
- Android: `expo prebuild` (the `config/withE2eLocalhostCleartext.js` plugin
  adds a release-only network security config, cleartext for localhost,
  127.0.0.1 and 10.0.2.2 only), then `expo run:android --variant release --no-bundler`.
  The script removes the e2e network config when it finishes, so a later
  production build doesn't pick it up.

## Then run as often as needed

```sh
DEVICE_UDID=<simulator-udid|emulator-serial> apps/mobile/.maestro/run.sh
```

`run.sh` refuses a debug/dev-client build (no embedded bundle on iOS, debuggable
package on Android) and sets `adb reverse tcp:3001` on Android. Flow 01 fails on a
labelled step if the build lacks the QA readout.

## The QA readout can't ship to production

The readout (`chat-message-count`, `chat-order-digest`, `chat-ws-status`) is gated
only by the build-time `EXPO_PUBLIC_QA_READOUT=1` (`src/qa/qaReadout.ts`).
`metro.config.js` runs `config/qaReadoutGuard.js`, which fails any production
bundle (`expo export`, or `export:embed --dev false` from the Xcode/Gradle release
bundle step) that has the flag without `CHATCRDT_E2E_BUILD=1`.
