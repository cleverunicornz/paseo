# v3 removal plan: first batch

v3 is the reduced in-container daemon. It keeps the daemon between agent, model gateways and tools (tool API, tool tree, MCP gateway, the stop-readiness and timeline-drain plugin hooks) and the web UI's look and feel. This plan covers only the first batch of what v3 drops, the parts v2 does not use: the website, the desktop app, native mobile, voice and speech, device pairing, and the relay.

Later batches drop projects and workspaces, the sessions sidebar and in-Paseo fork, in-container config and role editing, computer and browser use, and connections and multi-host. Each part below says what it leaves for one of those.

Nothing here is removed in this branch. The removals were proven on scratch branches; see [Proof](#proof).

## Order

Remove the parts in this order; each step was proven on top of the ones before it.

1. Website
2. Desktop app
3. Native mobile build and release
4. Voice and speech, daemon side
5. Device pairing and device push, daemon and CLI side
6. Relay, daemon side and hosted service

Pairing goes before the relay: a pairing offer carries the relay endpoint and the daemon's public key.

## 1. Website

**Removed:** `packages/website/`, `.github/workflows/deploy-website.yml`, the root `dev:website` script and the website's `knip.json` entry.

**Depends on it:**

| Dependent                                                            | What it uses                                                                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/server/config.test.ts` (a v2 gateway suite)     | The published config schema `packages/website/public/schemas/paseo.config.v1.json`; the MCP gateway backend URL patterns are checked against it |
| `packages/server/scripts/generate-config-schema.ts`                  | Writes that schema into the website                                                                                                             |
| `.github/workflows/internal-ci.yml`                                  | Lists the schema in the format check                                                                                                            |
| `packages/app` typecheck                                             | `@types/react-dom`, which only the website declares; the app gets it by hoisting                                                                |
| `public-docs/*.md`, `persisted-config.test.ts`                       | The `$schema` URL `https://paseo.sh/schemas/paseo.config.v1.json`, served by the website                                                        |
| `README*.md`, `CLAUDE.md`, `docs/architecture.md`, `docs/release.md` | Links and descriptions                                                                                                                          |

**What breaks in v2:** the gateway schema checks. Removing the website as is fails 124 cases of `config.test.ts`. Do this first:

- move the schema to `packages/server/schemas/paseo.config.v1.json`, and point the generator, `config.test.ts` and `internal-ci.yml` at it;
- declare `@types/react-dom` (`~19.2.3`, the locked version) in `packages/app`.

The `$schema` URL then needs a new home, or the configs drop it.

## 2. Desktop app

**Removed:** `packages/desktop/`; `.github/workflows/desktop-packages.yml`, `desktop-release.yml` and `desktop-rollout.yml`; the root `dev:desktop`, `dev:win:desktop` and `build:desktop` scripts; the `desktop` entries in `paseo.json`, `knip.json` and `.github/ci-paths.yml`; and the app's Electron-only modules `packages/app/src/desktop/browser/pane/*.electron.*`.

**Depends on it:**

- `packages/server/src/server/exports.test.ts` bundles `packages/desktop/src/daemon/daemon-manager.ts`; drop that entry.
- `scripts/ci-workflow.test.mjs` and `scripts/daemon-launch-contract.test.mjs` read desktop files. They are upstream CI's checks, which the fork does not run.
- `scripts/trace-daemon.mjs` and `scripts/sync-workspace-versions.mjs` name the package; both are inert without it.

**What breaks in v2:** nothing.

**Left for later:** the app's desktop bridge `packages/app/src/desktop/` (about 620 KB, 52 importers in the web UI). It sits behind `getIsElectron()`, which is false in the browser. Removing it means editing those importers, which is web UI work with its own visual proof.

## 3. Native mobile build and release

**Removed:**

- **In `packages/app`:** `eas.json`, `fastlane/`, `Gemfile`, `maestro/`, `e2e/mobile/`, `native-release-version.js` and its test, the Expo config plugins `plugins/`, the Expo native modules `modules/`, the F-Droid stubs `src/fdroid/`, and `src/native/ios-hardware-keyboard-submit.ios.ts`.
- **At the root:** `fastlane/` (F-Droid metadata); `scripts/sync-fdroid-changelogs.*`, `test-mobile-agent-device.sh`, `paseo-ios-simulator-service.*` and `seed-ios-native-cache.mjs`; `.github/workflows/android-apk-release.yml`; the `android*`, `ios*`, `fdroid:*` and mobile e2e scripts; and the F-Droid step of `version`.
- **In `paseo.json`:** the `ios-simulator` service and the native cache seed.

**Depends on it:**

- `packages/app/app.config.js` requires the config plugins, `modules/paseo-scroll/app.plugin` and `native-release-version`. Reduce it to the web keys and the `expo-router` plugin. `expo export --platform web` evaluates this file.
- `packages/app/metro.config.cjs` has F-Droid module overrides; drop them.
- `packages/app/vitest.config.ts` includes `native-release-version.test.ts`.
- `.github/workflows/ci.yml` runs `scripts/sync-fdroid-changelogs.test.mjs`.

**What breaks in v2:** nothing.

**Left for later:** the app's platform splits: 33 `*.native.*` and 4 `*.ios.*`/`*.android.*` source files (`components/markdown-text.{ios,android}.tsx`, `keyboard/shift/internal/translate.{ios,android}.tsx`; there were 5 before this step removed `src/native/ios-hardware-keyboard-submit.ios.ts`). TypeScript resolves several of them through `.d.ts` shims and base files that re-export the native implementation (for example `components/draggable-list.tsx`, `git/diff-document/surface.tsx`, `audio/audio-engine.d.ts`). Each split collapses to its web implementation, one module at a time. `packages/expo-two-way-audio` goes with the app side of voice.

## 4. Voice and speech, daemon side

**Removed:**

- **Server modules:** `packages/server/src/server/speech/`, `dictation/` and `session/voice/`; `voice-config.ts`, `voice-permission-policy.ts`, `voice-types.ts`, `agent/stt-manager.ts` and `agent/tts-manager.ts`.
- **Tests and scripts:** the voice e2e suites, the speech scripts and the `speech:*` package scripts.
- **Packaging:** the speech exports of `exports.ts`, the copy of `silero_vad.onnx` in `build:lib`, and the `sherpa-onnx-node` dependency.

**Depends on it** (all edited in the proof):

| Dependent                                                                | Change                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.ts`                                                             | Drops the speech options, `VoiceSessions`, the voice and dictation messages, the speak-tool permission auto-allow, and two methods only voice called (`handleSendAgentMessage`, `hasActiveAgentRun`) |
| `websocket-server.ts`                                                    | Drops the speech service, dictation options and voice bridges; `server_info.capabilities` now says dictation and voice mode are unavailable                                                          |
| `bootstrap.ts`, `config.ts`                                              | Drop the speech service, the speech config resolution and the voice LLM settings                                                                                                                     |
| `agent/tools/paseo-tools.ts`, `agent/tools/types.ts`                     | Drop the `speak` tool and the voice caller context (locked cwd, child labels), which only voice sessions supplied                                                                                    |
| `test-utils/paseo-daemon.ts`                                             | Drops the speech options                                                                                                                                                                             |
| `config.test.ts`, `agent/mcp-server.test.ts`, the websocket-server tests | Their voice cases go with the part; the constructor calls lose two positional arguments                                                                                                              |

**What breaks in v2:** nothing. The `paseo-tools.ts` change is behaviour-preserving for every caller but the voice session: without it, the caller context was always null.

**Order constraint:** the daemon keeps advertising dictation and voice mode, as unavailable. Without capabilities, the web UI reads the daemon as an old one and keeps the dictation button enabled against a daemon that ignores it.

**Left for later:**

- **The app's voice UI:** `src/voice/`, `src/dictation/`, `contexts/voice-context.tsx`, `components/realtime-voice-overlay.tsx`, `components/dictation-controls.tsx`, the `use-dictation*`, `use-dictation-audio-source*`, `use-audio-recorder*` and `use-is-dictation-ready` hooks, the capture half of the audio engine (`startCapture`, `stopCapture`, mute, `onCaptureData`, `onVolumeLevel` in `src/audio/audio-engine-types.ts` and its `.web`/`.native` implementations), and `packages/expo-two-way-audio`. Its importers include the composer (`composer/index.tsx`, `composer/input/input.tsx`), which is the web UI session view; that change needs a visual before/after of the session view. The other importers are `app/_layout.tsx`, `contexts/session-context.tsx`, `plugins/catalog-sync.tsx` and `screens/settings-screen.tsx`.
- **Audio playback stays: it is a public plugin API.** The client plugin contract has `playAudio(source: { base64, mimeType }): Promise<void>` (`packages/plugin/src/client/contracts.ts:135`, documented in `public-docs/plugins/reference.md`). The app implements it with the voice code's audio engine:
  - `plugins/client-runtime.ts` builds each plugin's `playAudio` with `createPlayAudio` from `@/audio`, over `Pick<AudioEngine, "play">`;
  - `plugins/registry.ts` requires that engine (`audio: Pick<AudioEngine, "play">`) to install a catalog;
  - `plugins/catalog-sync.tsx` takes it from `useVoiceAudioEngineOptional()` and, **when there is no engine, installs no client plugins at all**. Removing `contexts/voice-context.tsx` as is would therefore turn off every client plugin, not only voice.

  So the voice step keeps `src/audio/`'s playback (`createAudioEngine`'s `play`, `stop`, `clearQueue`, `isPlaying`; `play-audio.ts`, `playback.ts`, `file-playback.ts`, `pcm/`) and keeps `playAudio` in the plugin contract unchanged. It moves the engine's provider out of `voice-context.tsx` into a provider of its own that `catalog-sync.tsx` and `screens/settings-screen.tsx` (its "Test audio" row) read. Dropping or changing `playAudio` would be a breaking plugin API change and is not part of this plan. Proof for that step:
  - the existing `plugins/registry-lifecycle.test.ts`, `plugins/registry-requirements.test.ts`, `audio/play-audio.test.ts` and `audio/playback.test.ts`;
  - a new test that `catalog-sync` installs a host's client plugins, with a working `playAudio`, when no voice provider is mounted;
  - the web UI build, and the session view's visual before/after above.

  The first-batch proof below does not touch the app's voice code, so plugin playback is unchanged on every proven step.

- **The CLI:** onboarding still asks about voice and writes the now-ignored keys.
- **Config and protocol:** the persisted config keeps its `features.dictation`, `features.voiceMode` and `providers.local` keys, accepted and ignored. The protocol keeps the voice messages for old clients.

## 5. Device pairing and device push

**Removed:**

- **Server:** `packages/server/src/server/pairing-offer.ts` and `pairing-qr.ts`, the server's `./pairing` export, `qrcode` and `@types/qrcode`, and device push `packages/server/src/server/push/`.
- **CLI:** `packages/cli/src/commands/daemon/pair.ts`, `output/pairing.ts`, and onboarding's pairing step.

**Depends on it** (edited in the proof):

| Dependent                                          | Change                                                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session/daemon/daemon-session.ts`                 | `daemon.get_pairing_offer` answers with an `rpc_error` ("This daemon does not pair devices.")                                                                                                |
| `session.ts`                                       | `register_push_token` is ignored and `push.unregister.request` is acknowledged, so old clients do not wait; the push token leaves the client metadata                                        |
| `websocket-server.ts`                              | Drops the push sender and the `pushTokenRevocation` feature; the attention plan still decides in-app notifications                                                                           |
| `bootstrap.ts`, `test-utils/paseo-daemon.ts`       | Drop `pushNotificationSender`                                                                                                                                                                |
| `exports.ts`, `cli.ts`, `commands/daemon/index.ts` | Drop the pairing export and the `pair` command                                                                                                                                               |
| Server tests                                       | Pairing and push cases of `session.test.ts`, `daemon-session.test.ts`, `bootstrap.smoke.test.ts`, the websocket-server notification tests and `client-activity.e2e.test.ts` go with the part |

**What breaks in v2:** nothing.

**Left for later**, with connections and multi-host:

- The app's pairing screens: `components/pair-link-modal.tsx`, `components/pair-link-credentials.ts`, `app/pair-scan.tsx`, `hosts/pair-scan-model.ts`, `desktop/components/pair-device-section.tsx` and `pair-device-modal.tsx`, and `data/daemon-pairing.ts`. They are reached from the welcome screen, the settings screen, `settings/host-page.tsx`, `open-project-screen.tsx` and `data/push-router.ts`. Until then, the pair-device screen shows the daemon's error.
- The app's push registration `src/push-notifications/`, used by `contexts/session-context.tsx` and `runtime/host-runtime.ts`.
- The CLI's script tests `tests/03-daemon.test.ts` and `tests/17-onboard.test.ts`, which still run `paseo daemon pair`. Neither internal-ci nor the server suites run them.

## 6. Relay

**Removed:**

- **Server:** `packages/server/src/server/relay-runtime.ts` and `relay-transport.ts`, their tests, and the relay e2e suites.
- **The hosted relay service:** `packages/relay/src/cloudflare-adapter.ts`, `cutover-proxy.ts`, `e2e.test.ts` and `live-relay.e2e.test.ts`, `packages/relay/wrangler.toml`, the `./cloudflare` export, and `.github/workflows/deploy-relay.yml`.

**Depends on it** (edited in the proof):

| Dependent                                                           | Change                                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `bootstrap.ts`                                                      | Starts no relay runtime and stops none                                                                            |
| `session/daemon/daemon-session.ts`, `session/daemon/diagnostics.ts` | `daemon.get_status` reports `relay: null`; diagnostics drop the relay entries                                     |
| `websocket-server.ts`                                               | Stops advertising the `relayConfig` feature, so clients hide relay settings                                       |
| Server tests                                                        | The Hub enrollment relay smoke test goes; the reload smoke test and the Hub server-info test expect `relay: null` |

**What breaks in v2:** nothing. Before this step, a v2 daemon connects to `relay.paseo.sh` unless its config disables the relay (`config.relayEnabled ?? true` in `bootstrap.ts`).

**Stays:**

- `packages/relay` keeps its E2EE library (`crypto`, `encrypted-channel`, `./e2ee`). The client's relay transport `packages/client/src/daemon-client-relay-e2ee-transport.ts` needs it.
- `packages/server/src/utils/checkout-git.ts` takes its diff frame limit from `maxBase64EncryptedPlaintextByteLength`.
- `daemon-keypair.ts` stays: it is also the Hub relationship identity (`hub/relationship-controller.ts`).
- The relay config keys (`config.ts`, the CLI's `--relay`/`--no-relay`) still parse and do nothing.

**Left for later**, with connections and multi-host: the client's relay transport, the app's relay connections in `runtime/host-runtime.ts` (a file v2 changed), connection offers (`packages/protocol/src/connection-offer.ts`, `packages/server/src/server/connection-offer.ts`), and then `packages/relay` itself.

## Inherited from the v2 line

v3 starts from this branch's head, so it carries session mode as `candidate/v2` has it. One known gap is being fixed on the v2 line and v3 inherits the fix.

**G-1:** a refused agent can be resumed. A plugin's `agent.closed` hook, or any client, can resume a refused agent through the Paseo API. The refusal clears (`sessionMemberRefusals` in `agent-manager.ts`), and the gateway forwards for the resumed agent until its runtime next reports a model. The dedicated test in `plugin-tool-call.e2e.test.ts` covers only the gateway identity, not this.

The v2 line fixes it in `d12accdd`, which was not yet on GitHub when this plan was written. v3 takes that commit once it lands on `candidate/v2`: by this branch's merge of `candidate/v2` before v3 is cut, or by a port into v3 afterwards.

## Proof

Each part was removed on a scratch branch, never pushed to `candidate/v2`, one commit per step, on top of #13 at `815c669`. Every commit ran `internal-ci.yml` by `workflow_dispatch`, which runs:

- **The `daemon` job:**
  - the server build and `typecheck:server`, lint, and the format check;
  - v2's suites: session mode (`agent-manager`, `provider-snapshot-manager`, `plugin-provider`, `single-agent`), gateway (`mcp-gateway`, `agent-tokens`, model gateway launch and proxy), plugins (lifecycle handlers, `plugin-process`, plugins runtime, `timeline-item-hook`, `plugin-tool-call`), `timeline-drain`, `stop-readiness`, `agent-mcp`, local tools and the tool tree;
  - the app's and protocol's session-runtime suites, the bundled web UI build, the release pack, and the session image's install of the packed release.
- **The `web-ui-base-path` job:** the web UI under a prefix in Chromium.
- **The `server-unit` job:** the whole server unit suite.

Branch `leaf/v3-removal-proof-2`:

| Step                                               | Commit    | CI run                                                                          | Result                                                                                           |
| -------------------------------------------------- | --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Website, as is                                     | `b3ce479` | [38147899933](https://github.com/cleverunicornz/paseo/actions/runs/38147899933) | Fails as expected: `config.test.ts` only, 124 cases, in `daemon` and `server-unit`               |
| Website, schema moved, `@types/react-dom` declared | `c8bf433` | [38147904826](https://github.com/cleverunicornz/paseo/actions/runs/38147904826) | All three jobs pass                                                                              |
| Desktop app                                        | `3dcfaca` | [38153230095](https://github.com/cleverunicornz/paseo/actions/runs/38153230095) | All three jobs pass; `server-unit` 6578 passed                                                   |
| Native mobile                                      | `b7836bf` | [38153239936](https://github.com/cleverunicornz/paseo/actions/runs/38153239936) | All three jobs pass; `server-unit` 6578 passed                                                   |
| Voice and speech                                   | `018fb14` | [38153249472](https://github.com/cleverunicornz/paseo/actions/runs/38153249472) | All three jobs pass; `server-unit` 6465 passed                                                   |
| Pairing and push                                   | `d60f2e7` | [38153259461](https://github.com/cleverunicornz/paseo/actions/runs/38153259461) | All three jobs pass; `server-unit` 6448 passed                                                   |
| Relay                                              | `e95dafd` | [38153268944](https://github.com/cleverunicornz/paseo/actions/runs/38153268944) | Fails on lint only: the smoke test kept the Hub transport type imports of the relay test it lost |
| Relay, lint fixed                                  | `46e009d` | [38154213011](https://github.com/cleverunicornz/paseo/actions/runs/38154213011) | All three jobs pass; `server-unit` 6438 passed                                                   |

The website runs ran on the first scratch branch, `leaf/v3-removal-proof`, at the same commits. That branch's desktop and native mobile commits (`ed0115f`, `07cfc0b`) also deleted the voice files without voice's import edits, by a staging mistake; their failed runs are not evidence. `leaf/v3-removal-proof-2` replaces them. Its voice and pairing commits have the same trees as `a8016e8` and `0a19570` on the first branch; [38147934594](https://github.com/cleverunicornz/paseo/actions/runs/38147934594) at `a8016e8` passed.

internal-ci does not typecheck the app. On the workbench the app typecheck passed after the website step (at `2c778ff`, which `c8bf433` rebased without touching the app) and at the relay step (`e95dafd`; `46e009d` only drops unused test imports); only the first three steps touch the app. Before `@types/react-dom` was declared, it failed with missing `react-dom` declarations. The local tools e2e suite (`local-tools.e2e.test.ts`) fails there now and then at teardown, on #13's own tree as well, when Codex's background plugin clone races the temp directory's removal. CI is the record for that suite.
