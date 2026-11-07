# ITap

Browser-native, rehabilitation-inspired hackathon prototype. **Phase 6 provides setup, calibration, countdown, a fixed 15-second trial, local results, validated JSON export, and reset** for air and desk modes. Live acceptance remains pending, including the observed straight-pose palm-calibration rejection and the three-session/tap/noise gates. See the progress record. This is not a validated clinical device. No backend, account, API key, or UI library is required.

## Setup

Use Node **24.12.0** and npm **11.6.2** (pinned in `.nvmrc`, `package.json`, and `packageManager`). With nvm installed:

```sh
nvm install
nvm use
npm ci
npm run assets:prepare
npm run assets:verify
npm run dev
```

`npm install` is also supported for the initial install; subsequent reproducible installs should use `npm ci`. Dependencies and assets require network access during setup. Follow Vite's printed localhost URL. Camera and microphone access require localhost or HTTPS.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server |
| `npx tsc --noEmit` or `npm run typecheck` | Strict application, fixtures, worker/worklet contracts, configuration, and test checking |
| `npx vitest run` or `npm test` | Deterministic Node-environment contract tests |
| `npm run build` | Verify local asset checksums, typecheck, then build `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run assets:prepare` | Copy matching installed WASM assets and fetch versioned model/license; verify every checksum |
| `npm run assets:verify` | Offline checksum and package-version verification; fails on missing/corrupt assets |
| `npm run test:e2e` | Playwright workflows against a production build; run build first |

Versions: React/React DOM 19.3.1, Vite 8.3.6, TypeScript 7.0.2, Vitest 5.1.0, Zod 4.6.7, Tasks Vision 1.2.2, Vite React plugin 6.2.1. All manifest versions are exact; `package-lock.json` pins transitive dependencies and integrity values. Node 24 is an LTS line and satisfies the [Vite Node requirements](https://vite.dev/guide/).

## Try the live visual harness

1. Select **Live camera** and click **Start camera**. Only video is requested; no microphone, model, worker, or track is created before that action. Allow camera access for this local origin.
2. Open **Diagnostics**. Read the actual camera dimensions, browser, delegate, pipeline-probe result, render/inference FPS, inference duration, result age, and rolling 60-second p95 age. Counts include no-hand results; tracked results are listed separately. These measurements do not certify tracking accuracy.
3. Hold one open palm fully in view with fingers straight, facing the camera. Click **Calibrate palm / begin setup**. The tested engine requires at least three stable seconds and 45 valid samples. Rejection reasons are visible; closed-pose rejection identifies the estimated joint and threshold. A persistent rejection of a straight hand is a hardware-validation issue, not permission to fabricate calibration.
4. Check overlay alignment and mirror movement for each hand separately. All geometry uses actual source dimensions and the same contain-fit transform; labels stay readable. A 4:3 camera in the 16:9 canvas has side letterboxing.
5. **Stop**, **Reset**, switching source, and unmount release the live camera/worker/audio resources. Changing exercise/mode keeps a working camera, aborts the trial, and clears calibration/audio. Reset clears calibration and returns live input to idle; click Start again. Hide/loss/stale samples invalidate calibration. Use **Cancel calibration / trial** to clear pending state while keeping the live camera running. Recalibrate before another trial.

After palm calibration accepts, click **Start air trial**. A three-second countdown precedes a 15-second trial. A short reachable sequence uses frozen calibrated image axes and translates with the wrist. Hold the index fingertip in the ring continuously for 250 ms, then exit to rearm and advance. Excess palm-orientation deviation blocks an attempt (>18° lock / <14° unlock); the readout is a proxy, not an anatomical wrist angle. Off-screen targets suspend dwell. No-hand, stale input, and geometry changes invalidate scoring.

For the visual desk interaction:

1. Select **Desk / kinematic-only**, then Start camera and calibrate the palm in the fixed oblique desk view. A top-down view can hide the lift; move the camera before starting calibration. Keep the hand visible and wrist steady throughout setup.
2. Click inside the video to place one ring under the resting index fingertip. The shared inverse mirrored/letterboxed transform stores source pixels. The whole ring must fit. Clicking again replaces the ring and clears all guided recordings. Ordinary viewport resizing preserves source placement; actual camera geometry changes require recalibration.
3. Click **Capture resting fingertip**, then hold still in the ring for >=500 ms / >=8 samples. Click **Record one lift / return** while resting, lift once, return, hold still for at least three observations, and click **Save this cycle**. Complete 3–5 cycles, then **Finish visual calibration**. Each recording must finish within five seconds. Named rejection reasons require retry or a new setup.
4. Diagnostics show measured projected excursion, learned lift-to-contact direction, contact band, and wrist speed limit. No audio offset is measured here. Click **Start kinematic trial**; after the countdown, lift clearly and return inside the ring. The ring briefly highlights each accepted kinematic tap; candidate state is shown separately. Held contact does not repeat; another lift is required. Contact confirmation uses capture-time motion and a later settling/reversal observation, with no tap dwell.
5. **Visual candidates are not fused or verified taps.** Accepted air reps stay separate. Use the separate fused setup below for audio/visual coincidences. Reset, cancellation, tracking loss, hidden tab, stale input, hand/scale/geometry changes, or ring replacement clear pending contact/calibration state. Completed and interrupted trials produce a local result; aborted early/late comparisons remain unavailable.

The phase 3 live palm-calibration issue still blocks a hardware-verified demonstration of these flows. Do not widen the open-palm threshold to bypass it without investigation/evidence. Exact pending checks and provisional limits are in [docs/progress.md](docs/progress.md).

GPU is attempted in an ES-module worker using local Tasks Vision 1.2.2 module WASM, OffscreenCanvas, and transferred ImageBitmaps. Readiness requires an actual blank-bitmap inference probe, not feature detection alone. A failed GPU init/probe retries CPU explicitly; worker CPU fallback has a named 50 ms minimum interval (at most 20 Hz), so it cannot satisfy the >=24 inference FPS demo gate without further measured tuning. Both paths still require worker/bitmap/OffscreenCanvas/WebGL2 compatibility. Unsupported pipelines fail visibly; there is no hidden main-thread inference or runtime CDN fallback. Raw image bitmaps are released, never recorded.

## Try the preserved replay harness

Select **Synthetic replay** first. This disposes any live owner.


1. Click **Start replay adapter** to prepare synthetic input and check local asset hashes. No camera/microphone permissions are requested.
2. Click **Calibrate synthetic palm**. The real calibration engine requires three seconds and at least 45 stable open-palm samples. This 20 Hz fixture normally supplies 61 observations over 3000 ms.
3. Click **Start synthetic trial** after calibration. A three-second countdown precedes a fixed 15-second synthetic air trial. The engine computes source-pixel collision, continuous 250 ms dwell, release, attempts, lockouts, and reps. The fixture alternates index target entry/release; counts depend on the start time.
4. Toggle **Compact stub composition** during the trial. Both views consume the same controller and high-rate geometry buffer; switching retains the session.
5. **Reset** clears calibration and counters while keeping the prepared adapter ready. Calibrate again. **Stop** returns to idle. Switching exercise/mode invalidates the setup. For desk replay, select the desk mode, calibrate, place the ring beneath the fixture fingertip, capture rest and hold for at least 500 ms. Record three visual cycles, pressing **Replay one lift / tap** once per recording, waiting 800 ms, then saving. Fused replay additionally needs three timing recordings using the same tap button and wait. Finish timing, start the trial, and use the tap button for each artificial tap.

The replay is bounded to 60 seconds of artificial observations. Input expiry during a trial, tracking loss, stale input, hand/scale changes, and tab hiding require recalibration and a fresh countdown. No prerecorded success counters are used. Estimated PIP/DIP bends, the MCP proxy, and palm orientation deviation are labeled estimates/proxies. Local summaries and validated export use the computed observations, including estimated ROM for air trials. Replay performance is not live hardware evidence.

## Try fused desk diagnostics

1. Select **Desk / fused coincidence** before setup. Click **Start camera** and **Start / retry microphone (keep quiet)** separately. Keep quiet for 1.5 seconds. Diagnostics show the actual context sample rate/block size, supported/actual processing settings, RMS/noise/threshold, and explicit audio-to-performance clock anchor. Clipped/noisy/missing input fails visibly. Browser processing constraints are requests, not guarantees.
2. Complete the same palm/ring/rest/3–5 visual cycles above; finish visual calibration. Then record **3–5 additional timing taps**, one lift/tap/return per **Record timing tap** window, at least 600 ms apart. Avoid speech/impacts. Wait at least 250 ms after contact before **Save timing pair**. Exactly one visual candidate and one acoustic onset must occur per window; each window expires after five seconds.
3. Click **Finish timing calibration**. The app learns the median audio-minus-visual onset offset and maximum absolute residual. Residual >40 ms or offset magnitude >1000 ms rejects the set and clears pairs for retry. Do not assume a zero hardware offset. Geometry, onset thresholds, timing and wrist gates remain provisional until measured on the demo setup.
4. Start a fused trial. Diagnostics distinguish visual candidates, acoustic impulses and coincidences, showing a bounded capture/sample-time trace. Audio uses the 10 ms rolling RMS onset time and peak RMS amplitude. Matching uses an 80 ms tolerance after offset correction and an independent 250 ms delivery budget, with one use per source event/contact cycle. Coincidence is not proof of physical contact. Each accepted event highlights the ring once and increments the accepted counter. After 15 seconds and the bounded 250 ms late-event grace, inspect Results and click **Export validated JSON**. Exported counts, frequency, early/late rates, rate change, rhythm SD, relative acoustic statistics and quality come from the same collector.
5. Microphone denial does not stop CV. Retry microphone, or explicitly select **Desk / kinematic-only** and recalibrate. No automatic fallback or verified count is invented. Suspend, mute/end/device change, clock discontinuity, hidden tab, reset and session changes invalidate pending state. Stop releases both devices. No app audio feedback is played while listening.

## Boundaries and data

- `src/lib/schemas.ts`: strict Zod source of truth for local frames, compact audio impulses, mode-specific calibration, quality, and versioned telemetry. Image/world landmark brands prevent accidental type interchange. Local arrays are forbidden in aggregate telemetry.
- `src/engine/`: browser-independent controller and injected-clock session machine. `src/lib/` contains tested coordinates, world goniometry, time-based display smoothing, robust calibration, orientation hysteresis, air-target state, guided desk calibration, and capture-time visual contact candidates. `acousticTap.ts` contains rolling RMS, background/onset/peak DSP, bounded symmetric coincidence matching, and spaced timing calibration.
- `src/adapters/`: owned camera/worker scheduling, numeric diagnostics, asset checks, and replay. Audio ownership is independent of camera permission; reset/stop/dispose invalidate sample epochs and clock anchors. Replay supplies capture-timed input at 20 Hz; ordinary React snapshots publish at 10 Hz, with immediate state transitions. Canvas reads the latest frame/target buffer and shares contain-fit mirrored transforms with the collision coordinate contract.
- `src/hooks/`: owned effect lifecycle; Strict Mode creates a fresh controller after cleanup. `src/components/stubs/` consumes snapshots/commands, never requests permissions or performs sensing.
- `src/workers/`: running local HandLandmarker with explicit GPU/CPU probe/failure/disposal. `src/audio/tapProcessor.ts` is compiled as a local AudioWorklet: PCM stays there; only impulses and a throttled numeric meter leave it; output is silent. All worker/test code stays in the checked `src` tree with scoped worker globals.
- `fixtures/`: bounded artificial coordinates/timestamps only. No captured media or user recordings. The fixture supplies observations, and the engines compute scores.

Telemetry is a discriminated exercise union with sensor/status refinements. Numeric reconciliation tolerance is 1e-6. Limits are exported from `src/lib/config.ts`; JSON intake has a 16 KiB UTF-8 limit before parsing. Quality coverage is 0 when totalFrames is 0; compensation is null with zero attempts. Telemetry includes hand/configuration revision so baseline context can be checked. Aggregation is memory-only; baseline collection/storage is not implemented. Baseline comparisons remain null. A cancelled countdown has no result; an interrupted started trial has an aborted result with early/late comparisons null. Reset clears the result and calibration.

Nothing persists or uploads frames, PCM, landmarks, or session summaries. Browser requests load same-origin model/WASM/worker assets (and Vite's local development connection). MediaPipe receives only local bitmaps in the worker; camera frames never enter logging or storage. Download URLs in the preparation script's manifest are setup-only. Aggregate telemetry is minimized, not guaranteed anonymous.

## Local MediaPipe assets

See [asset provenance](docs/assets.md) and [checksums](docs/assets-manifest.json). Preparation copies **all four** JS/WASM files from installed Tasks Vision 1.2.2 and fetches `hand_landmarker/float16/1`. Generated binaries are ignored by Git; the manifest and license/provenance record are committed source inputs. Preserve the Apache license alongside deployed assets. No runtime CDN fallback is provided.

Build refuses absent/corrupt assets. Browser preflight also checks hashes, including when a development server returns an HTML fallback for a missing path, and shows an actionable setup error. Synthetic fixture delivery remains available with an explicit asset error because it does not invoke the model. The GPU worker pipeline has been exercised in development and the production bundle on the local MacBook camera. Other browsers/delegates and disconnected-internet operation still need verification; full hand-calibration acceptance remains pending.

## Verification and live acceptance

See [docs/progress.md](docs/progress.md) for exact commands, measurements, hardware limitations, and the remaining operator procedure. The production GPU check observed 120 render FPS, 30 inference FPS, and 19.9 ms p95 age over a rolling 60-second window with mixed hand/no-hand input. It does **not** establish 60 seconds of stable calibrated tracking. Only one hand's alignment was operator-checked; calibration rejected the straight-finger report with index DIP estimates near 42° against the provisional 20° gate. Angles/thresholds were preserved and that issue remains open.

Phase 6 automated evidence and pending hardware checks are recorded in [docs/progress.md](docs/progress.md). Build before browser tests:

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

If Google Chrome is already installed, `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` selects that browser without downloading Playwright Chromium. The default uses Playwright's matching Chromium. Tests use only localhost port 4176 and artificial observations or deliberately denied device requests. They verify full air/fused/kinematic workflows, export reconciliation, reset/restart, hidden-tab/mode aborts and permission/asset recovery. The replay request audit records URL, method and payload size and requires same-origin GETs with no request bodies; it does not establish live media privacy or accuracy.

For live acceptance, use the exact operator checks in the Phase 6 progress entry: resolve palm calibration, measure stable tracking, complete three fused 15-second trials, then record 20 deliberate taps (at least 18 accepted) and 20 noise/no-contact trials (at most one false acceptance). Inspect Network during those live runs. Until recorded, Phase 6's live gate is pending and Phase 7 presentation work must wait.
