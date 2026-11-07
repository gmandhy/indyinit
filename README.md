# ITap

Browser-native, rehabilitation-inspired hackathon prototype. **Phase 3 adds live camera tracking, a worker skeleton pipeline, estimated angles, and palm-calibration diagnostics** over the tested geometry engines. Hardware acceptance is partial: live calibration rejects the observed straight-hand pose; see the progress record. This is not a validated clinical device. No backend, account, API key, or UI library is required.

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

`npm install` is also supported for the initial install; subsequent reproducible installs should use `npm ci`. Dependencies and assets require network access during setup. Follow Vite's printed localhost URL. Camera access requires localhost or HTTPS.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server |
| `npx tsc --noEmit` or `npm run typecheck` | Strict application, fixtures, worker/worklet contracts, configuration, and test checking |
| `npx vitest run` or `npm test` | Deterministic Node-environment contract tests |
| `npm run build` | Verify local asset checksums, typecheck, then build `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run assets:prepare` | Copy matching installed WASM assets and fetch versioned model/license; verify every checksum |
| `npm run assets:verify` | Offline checksum and package-version verification; fails on missing/corrupt assets |

Versions: React/React DOM 19.3.1, Vite 8.3.6, TypeScript 7.0.2, Vitest 5.1.0, Zod 4.6.7, Tasks Vision 1.2.2, Vite React plugin 6.2.1. All manifest versions are exact; `package-lock.json` pins transitive dependencies and integrity values. Node 24 is an LTS line and satisfies the [Vite Node requirements](https://vite.dev/guide/).

## Try the phase 3 camera harness

1. Select **Live camera** and click **Start camera**. Only video is requested; no microphone, model, worker, or track is created before that action. Allow camera access for this local origin.
2. Open **Diagnostics**. Read the actual camera dimensions, browser, delegate, pipeline-probe result, render/inference FPS, inference duration, result age, and rolling 60-second p95 age. Counts include no-hand results; tracked results are listed separately. These measurements do not certify tracking accuracy.
3. Hold one open palm fully in view with fingers straight, facing the camera. Click **Calibrate palm**. The tested engine requires at least three stable seconds and 45 valid samples. Rejection reasons are visible; closed-pose rejection identifies the estimated joint and threshold. A persistent rejection of a straight hand is a hardware-validation issue, not permission to fabricate calibration.
4. Check overlay alignment and mirror movement for each hand separately. All geometry uses actual source dimensions and the same contain-fit transform; labels stay readable. A 4:3 camera in the 16:9 canvas has side letterboxing.
5. **Stop**, **Reset**, switching source/mode, and unmount release the live camera/worker. Reset clears calibration and returns live input to idle; click Start again. Hide/loss/stale samples invalidate calibration. Live air scoring is phase 4 and remains disabled here.

GPU is attempted in an ES-module worker using local Tasks Vision 1.2.2 module WASM, OffscreenCanvas, and transferred ImageBitmaps. Readiness requires an actual blank-bitmap inference probe, not feature detection alone. A failed GPU init/probe retries CPU explicitly; worker CPU fallback has a named 50 ms minimum interval (at most 20 Hz), so it cannot satisfy the >=24 inference FPS demo gate without further measured tuning. Both paths still require worker/bitmap/OffscreenCanvas/WebGL2 compatibility. Unsupported pipelines fail visibly; there is no hidden main-thread inference or runtime CDN fallback. Raw image bitmaps are released, never recorded.

## Try the preserved replay harness

Select **Synthetic replay** first. This disposes any live owner.


1. Click **Start replay adapter** to prepare synthetic input and check local asset hashes. No camera/microphone permissions are requested.
2. Click **Calibrate synthetic palm**. The real calibration engine requires three seconds and at least 45 stable open-palm samples. This 20 Hz fixture normally supplies 61 observations over 3000 ms.
3. Click **Start synthetic trial** after calibration. A three-second countdown precedes a fixed 15-second synthetic air trial. The engine computes source-pixel collision, continuous 250 ms dwell, release, attempts, lockouts, and reps. The fixture alternates index target entry/release; counts depend on the start time.
4. Toggle **Compact stub composition** during the trial. Both views consume the same controller and high-rate geometry buffer; switching retains the session.
5. **Reset** clears calibration and counters while keeping the prepared adapter ready. Calibrate again. **Stop** returns to idle. Switching exercise/mode invalidates the setup. Desk calibration is explicitly unavailable until phase 4.

The replay is bounded to 60 seconds of artificial observations. Input expiry during a trial, tracking loss, stale input, hand/scale changes, and tab hiding require recalibration and a fresh countdown. No prerecorded success counters are used. Estimated PIP/DIP bends, the MCP proxy, and palm orientation deviation are labeled estimates/proxies. Summary/ROM aggregation and validated export remain phase 6. Replay performance is not live hardware evidence.

## Boundaries and data

- `src/lib/schemas.ts`: strict Zod source of truth for local frames, compact audio impulses, mode-specific calibration, quality, and versioned telemetry. Image/world landmark brands prevent accidental type interchange. Local arrays are forbidden in aggregate telemetry.
- `src/engine/`: browser-independent controller and injected-clock session machine. `src/lib/` contains tested coordinates, world goniometry, time-based display smoothing, robust calibration, orientation hysteresis, and air-target state. Acoustic DSP remains reserved for phase 5.
- `src/adapters/`: owned camera/worker scheduling, numeric diagnostics, asset checks, and replay. Audio ownership remains phase 5. Replay supplies capture-timed input at 20 Hz; ordinary React snapshots publish at 10 Hz, with immediate state transitions. Canvas reads the latest frame/target buffer and shares contain-fit mirrored transforms with the collision coordinate contract.
- `src/hooks/`: owned effect lifecycle; Strict Mode creates a fresh controller after cleanup. `src/components/stubs/` consumes snapshots/commands, never requests permissions or performs sensing.
- `src/workers/`: running local HandLandmarker with explicit GPU/CPU probe/failure/disposal. The audio worklet remains reserved for phase 5. All worker/test code stays in the checked `src` tree with scoped worker globals.
- `fixtures/`: bounded artificial coordinates/timestamps only. No captured media or user recordings. The fixture supplies observations, and the engines compute scores.

Telemetry is a discriminated exercise union with sensor/status refinements. Numeric reconciliation tolerance is 1e-6. Limits are exported from `src/lib/config.ts`; JSON intake has a 16 KiB UTF-8 limit before parsing. Quality coverage is 0 when totalFrames is 0; compensation is null with zero attempts. Telemetry includes hand/configuration revision so baseline context can be checked. Baseline collection/storage and aggregation are not implemented.

Nothing persists or uploads frames, PCM, landmarks, or session summaries. Browser requests load same-origin model/WASM/worker assets (and Vite's local development connection). MediaPipe receives only local bitmaps in the worker; camera frames never enter logging or storage. Download URLs in the preparation script's manifest are setup-only. Aggregate telemetry is minimized, not guaranteed anonymous.

## Local MediaPipe assets

See [asset provenance](docs/assets.md) and [checksums](docs/assets-manifest.json). Preparation copies **all four** JS/WASM files from installed Tasks Vision 1.2.2 and fetches `hand_landmarker/float16/1`. Generated binaries are ignored by Git; the manifest and license/provenance record are committed source inputs. Preserve the Apache license alongside deployed assets. No runtime CDN fallback is provided.

Build refuses absent/corrupt assets. Browser preflight also checks hashes, including when a development server returns an HTML fallback for a missing path, and shows an actionable setup error. Synthetic fixture delivery remains available with an explicit asset error because it does not invoke the model. The GPU worker pipeline has been exercised in development and the production bundle on the local MacBook camera. Other browsers/delegates and disconnected-internet operation still need verification; full hand-calibration acceptance remains pending.

## Phase 3 verification and next phase

See [docs/progress.md](docs/progress.md) for exact commands, measurements, hardware limitations, and the remaining operator procedure. The production GPU check observed 120 render FPS, 30 inference FPS, and 19.9 ms p95 age over a rolling 60-second window with mixed hand/no-hand input. It does **not** establish 60 seconds of stable calibrated tracking. Only one hand's alignment was operator-checked; calibration rejected the straight-finger report with index DIP estimates near 42° against the provisional 20° gate. Angles/thresholds were preserved and that issue remains open.

Finish the phase 3 hardware follow-up before claiming its gate or tuning desk physics. Then begin a fresh chat with the phase 4 roadmap prompt: live air integration and visual desk calibration. Audio/fusion, aggregation/export, and UI replacement remain later phases. No automated Playwright suite is installed; current integration evidence comes from manual real-browser checks plus deterministic lifecycle/transport tests.
