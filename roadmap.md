# ITap — Roadmap to a Demoable Hackathon Release

## Goal and current state

**Done means a judge can see their real tracked hand, activate an air target, tap a physical desk to trigger a holographic ring with camera/audio matching, inspect a 15-second result, and reset for the next person.** CV and holo desk tapping are mandatory. A polished dashboard, AI report, billing codes, and stretch mechanics are not substitutes for those interactions.

Starting state (2026-11-07): documentation only; no package manifest, application, or tests. The documentation review is complete; implementation phases below are not yet complete. Technical corrections and source references are in [docs/design.md](docs/design.md). Scope is in [docs/features.md](docs/features.md); view boundaries are in [docs/pages.md](docs/pages.md).

Choose Vite + React 19 + strict TypeScript, local MediaPipe Tasks Vision, Canvas 2D, AudioWorklet, Zod, Vitest, and later Playwright. Keep required functionality local and independent of API credentials. Start with fully functional generic HTML/CSS controls; replace them only in phase 7.

## How to execute across chats

Each numbered phase is one new conversation with **one primary prompt** below. Paste the entire prompt in the repository workspace. It is intended to drive implementation through verification, not produce another plan. A phase can need follow-up prompts for hardware evidence or failures; do not start a new phase/chat to conceal unfinished work. Scope is bounded by engine/integration boundaries so a single capable coding-agent prompt can usually complete the software portion. No prompt can guarantee autonomous access to human-operated hardware.

Every phase reads repository instructions and the current design, inspects actual code, preserves unrelated changes, and records a handoff in `docs/progress.md`. That file is created in phase 1 and contains phase status, exact validation commands/results, important decisions, unresolved issues, hardware evidence (or pending checks), and the next phase. Status must distinguish software-complete from hardware-verified. A missing prerequisite is repaired within scope or explicitly reported; never assumed complete from a checklist.

Use **GPT-6.1 Sol** for the phases below, with the indicated reasoning effort. These are implementation recommendations based on task complexity, not guaranteed completion times. [OpenAI's model-selection guidance](https://developers.openai.com/api/docs/guides/model-selection) identifies Sol for complex technical work and higher effort for more demanding deliverables. Model availability can differ by account; verify the picker when starting. If unavailable, choose the available coding-capable model and record the substitution. These are coding-agent models, not the optional app reporting model.

| Phase | Priority | Outcome | Model / effort | Depends on |
| --- | --- | --- | --- | --- |
| 1 | P0 | Runnable skeleton, contracts, replaceable stubs | GPT-6.1 Sol / medium | Reviewed docs |
| 2 | P0 | Tested geometry and deterministic exercise engines | GPT-6.1 Sol / high | 1 |
| 3 | P0 | Real camera/CV loop proven on demo hardware | GPT-6.1 Sol / high | 2 |
| 4 | P0 | Live air targets and desk visual calibration | GPT-6.1 Sol / high | 3 |
| 5 | P0 | Continuous audio and tested temporal fusion | GPT-6.1 Sol / high | 4 |
| 6 | P0 | Complete live tapping trial and local results | GPT-6.1 Sol / high | 5 |
| 7 | P1 | Replace stub presentation, preserve engines | GPT-6.1 Sol / high | 6 live gate |
| 8 | P1 | Rehearsed, reproducible demo release | GPT-6.1 Sol / high | 7 |
| 9 | Optional P1 | Protected AI draft report | GPT-6.1 Sol / high | 8; time available |

Critical path: **1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8**. Phase 6 is the first complete feature demo. Phase 8 is the hackathon completion gate. Phase 9 and all P2 experiments may be skipped without making the project incomplete.

## Phase 1 — Foundation, contracts, and generic stubs

**Deliver:** installable frontend, strict typed boundaries, local asset setup, fixture adapter, controller shell, and interchangeable generic views. No feature polishing or pretend measurements.

**Acceptance:** documented install/dev/test/build commands work; a labeled synthetic fixture reaches the stub view through the controller; strict schemas reject invalid payloads; importing pure modules needs no DOM or hardware; two minimal view compositions can consume the same snapshot/commands. Asset provenance and license/checksum records exist. All later phase commands typecheck relevant TS files rather than an empty project-reference root.

**Model:** GPT-6.1 Sol, medium reasoning.

```text
Implement phase 1 of roadmap.md in this repository. Read AGENTS.md, docs/design.md, docs/features.md, docs/pages.md, and roadmap.md first; inspect the actual tree and preserve unrelated changes. This is implementation, not another planning task.

Scaffold Vite + React 19 + strict TypeScript with compatible pinned dependencies, a pinned supported Node version, npm lockfile, Vitest, and documented dev/typecheck/test/build commands. Establish the modules and typed FrameSample, AudioImpulse, Calibration, SessionSnapshot, controller commands, and strict exercise/mode-specific Zod telemetry contracts from design sections 2 and 6. Keep browser adapters separate from pure engines. Do not add a mandatory backend or UI library.

Create minimal semantic HTML/CSS stubs for controls, calibration status, viewport, diagnostics, and results. Use a visibly labeled synthetic replay adapter through the same controller contract; never invent live sensor success. Demonstrate a second minimal composition using that contract without changing engines. Set up matching local MediaPipe WASM/model assets with a reproducible preparation/verification command and provenance/license/checksum record; surface missing assets explicitly.

Add meaningful schema/contract tests, run npx tsc --noEmit, npx vitest run, and npm run build, and fix failures. Ensure the typecheck command actually includes application and worker/test code. Write README.md setup instructions and docs/progress.md with exact commands/results, decisions, pending hardware checks, and phase 2 handoff. Stop at the phase boundary; do not implement UI polish or report APIs. If a dependency cannot be fetched, record the exact blocker and do not fake the asset or passing build.
```

## Phase 2 — Pure geometry and exercise state machines

**Deliver:** coordinate transforms, goniometry, calibration aggregation, orientation proxy, target/dwell/release logic, and session transitions, all deterministic and independent of React.

**Acceptance:** tests cover straight/right-angle bends, rotations/scaling, malformed/nonfinite/degenerate inputs, nonsquare video and mirrored inverse mapping, calibration rejection, roll/tilt lockout and hysteresis, one blocked attempt per episode, dwell reset/rearm, stale frames, and valid/invalid lifecycle transitions. Synthetic fixtures exercise real engines.

**Model:** GPT-6.1 Sol, high reasoning.

```text
Implement phase 2 of roadmap.md. Read AGENTS.md, docs/design.md, docs/features.md, docs/pages.md, roadmap.md, and docs/progress.md; inspect the existing foundation and preserve unrelated work.

Implement the pure math and state contracts in design sections 3 and 4: typed image/world spaces, aspect-correct contain-fit forward/inverse mirrored coordinates, world-landmark PIP/DIP flexion and explicitly labeled MCP proxy, separate palmWorld/palmPixels robust calibration, time-based display smoothing, orthonormal palm orientation comparison with hysteresis, and event-based attempt/lockout counting. Implement air-target collision, continuous dwell, release-to-rearm, and deterministic session transitions using an injected monotonic clock. Put thresholds and units in named configuration. Handle no-hand as data absence, but throw descriptive pure-function errors for malformed math inputs.

Write deterministic tests in src/lib/__tests__ before wiring these engines into the existing labeled replay/stub harness. Cover the phase 2 acceptance cases in roadmap.md, including nonsquare/letterboxed/mirrored layouts, hand-switch invalidation, stale data, and no duplicate scoring. Keep React and devices out of pure modules. Run npx tsc --noEmit, npx vitest run, and npm run build; fix failures. Update docs/progress.md with completed scope, evidence, remaining issues, and phase 3 handoff. Do not add real hardware adapters or visual polish in this phase.
```

## Phase 3 — Real CV and hardware lifecycle

**Deliver:** user-started live camera, local hand tracking, correctly aligned skeleton, estimated PIP display, palm calibration, and measured diagnostics in the generic harness.

**Acceptance:** production assets load locally; repeated start/stop and Strict Mode leave no active resources; one-frame-in-flight scheduling never grows a backlog; no-hand/permission/model errors are actionable. On the demo laptop, record 60 seconds of render/inference FPS and p95 result age; use design budgets (target 60 render FPS, >=24 inference FPS, p95 <=120 ms). Verify left/right placement and overlay alignment. This hardware gate precedes tuning desk physics.

**Model:** GPT-6.1 Sol, high reasoning.

```text
Implement phase 3 of roadmap.md. Read AGENTS.md, docs/design.md, docs/features.md, docs/pages.md, roadmap.md, and docs/progress.md; inspect and preserve existing work. Confirm phases 1–2 are implemented and passing.

Implement the real camera and MediaPipe Tasks Vision adapters plus skeleton renderer using pinned local assets. Initialize only from user action, request video independently of audio, and cleanly own/dispose tracks, callbacks, landmarker, worker, and transferred bitmaps including late initialization and Strict Mode remounts. Implement a worker-based inference path and prove browser support for the selected delegate/bitmap pipeline. If necessary provide an explicit measured throttled main-thread or CPU fallback; never hide it. Deduplicate camera frames, keep at most one in flight, preserve capture timestamps and sequences, and discard stale results.

Wire actual landmarks through the tested geometry/calibration engines to generic stubs. Show correct one-time mirroring and letterboxing, estimated PIP, tracked/lost state, separate render/inference FPS, inference duration, and result age; throttle React snapshots to 10–15 Hz. Handle permission denial, missing assets, hand loss, stop, reset, and device errors visibly. Add relevant lifecycle/transport tests and run typecheck, Vitest, and production build.

Perform the phase 3 live hardware checks when hardware access is available. If human positioning or permission is needed, finish the software and provide a short exact operator procedure; mark hardware verification pending instead of claiming success. Record measurements, browser/device/delegate, commands/results, and phase 4 handoff in docs/progress.md. Keep the UI generic and stop at this phase boundary.
```

## Phase 4 — Air targets and visual desk calibration

**Deliver:** first interactive CV demonstration plus the visual half of desk tapping. One air sequence and one manually positioned desk ring are sufficient.

**Acceptance:** live air dwell/reset/lockout works; desk setup detects measurable lift/contact movement in an oblique view; impossible camera angles fail explicitly; visual candidates occur once per contact/release cycle and only within the ring. Synthetic tests cover changed camera geometry, tracking loss, inadequate excursion, motion direction, wrist movement, and contact-band hysteresis. Visual candidates are not labeled audio-verified.

**Model:** GPT-6.1 Sol, high reasoning.

```text
Implement phase 4 of roadmap.md. Read AGENTS.md, docs/design.md, docs/features.md, docs/pages.md, roadmap.md, and docs/progress.md; inspect the working CV harness. Verify the phase 3 hardware gate or clearly retain it as pending while doing independent software work.

Connect the tested air-target engine to live capture: a reachable short target sequence anchored in the calibrated image basis, continuous dwell, orientation lockout feedback, exit-to-rearm, and exactly-once reps. Keep rendering separate from scoring.

Implement the desk visual calibration and detector from design sections 4.2 and 5.1. Let the operator place one ring through the inverse coordinate transform, capture resting fingertip position, then collect 3–5 guided lifts/taps to learn a projected lift/contact axis, contact band, excursion, and wrist tolerance. Reject occlusion, tiny projected movement, invalid/stale samples, and invalidated camera/hand geometry. Detect lifted/descending/contactCandidate/released transitions using capture-time motion and target overlap. Emit timestamped visual candidates; do not call them fused or verified taps. Recalibration and cancellation must reset all pending state.

Add deterministic visual/target integration tests and use them before live wiring. Run npx tsc --noEmit, npx vitest run, and npm run build. Perform or document the exact live checks for air and desk candidates; do not claim unperformed checks passed. Update docs/progress.md with calibration decisions, measured limits, evidence, and phase 5 handoff. Retain generic controls; no dashboard polish or report endpoint.
```

## Phase 5 — Audio capture, clock alignment, and fusion

**Deliver:** continuous local microphone DSP, sample timestamps, calibrated shared clock/offset, and bounded symmetric one-to-one event matching connected to the debug harness.

**Acceptance:** tests cover impulses between video frames, varied sample rates/block sizes, silence/noise/clipping, audio-before-video and reverse order, matching boundaries, delayed delivery, duplicates, ties, refractory/release behavior, reset, and no stale cross-session matches. Live calibration shows distinguishable visual/audio/fused events. Microphone denial permits explicit kinematic-only mode without breaking CV. No PCM leaves the audio-processing boundary.

**Model:** GPT-6.1 Sol, high reasoning.

```text
Implement phase 5 of roadmap.md. Read AGENTS.md, docs/design.md, docs/features.md, docs/pages.md, roadmap.md, and docs/progress.md; inspect existing vision, desk calibration, and event contracts.

Implement pure acoustic DSP and temporal coincidence matching in src/lib/acousticTap.ts with deterministic tests in src/lib/__tests__ before integration. Follow design section 5: rolling time-window RMS, quiet background calibration, peak/onset hysteresis, impulse-excluded noise adaptation, configured refractory interval, finite input validation, and bounded event queues. Handle actual sample rate/block sizes. Match nearest unmatched visual/audio events symmetrically using shared-clock capture/sample timestamps, calibrated offset, the configured 80 ms initial tolerance, and a separate bounded delivery-lateness budget. Each source event and contact cycle can score at most once. Test all phase 5 acceptance cases, not just matching happy paths.

Implement AudioWorklet capture and its lifecycle adapter, requesting microphone separately and resuming context from user action. Keep PCM local; emit compact events and a throttled meter, with silent output. Inspect supported capture settings, report calibration failures, align clocks explicitly, and invalidate buffers on suspend/reset/device or session changes. Extend guided spaced tap calibration to estimate offset/residual uncertainty. Wire real and replay events to a generic diagnostic view distinguishing visual, acoustic, and fused events. Handle unavailable microphone as explicitly selected kinematic-only mode, not verified taps.

Run typecheck, Vitest, and build, fix failures, and inspect the data path for media egress. Perform or document live calibration/noise/permission checks. Record exact evidence, calibrated parameters, remaining hardware gates, and phase 6 handoff in docs/progress.md. Do not add UI polish, AI, or claim clinical contact verification.
```

## Phase 6 — End-to-end P0 demo and results

**Deliver:** integrated setup -> countdown -> 15-second desk trial -> local results/export -> reset, plus working air mode, using replaceable generic views.

**Acceptance:** one ring activation per accepted fused event; tap/early/late/rhythm/amplitude metrics reconcile with exported telemetry; absent/aborted data stays null; mode changes abort cleanly. Playwright replay tests cover complete flows and recovery. Live demo passes three trials and the design's 20-tap and 20-noise/no-contact checks. Inspect network traffic to confirm local processing. This gate is mandatory before cosmetic work.

**Model:** GPT-6.1 Sol, high reasoning.

```text
Implement phase 6 of roadmap.md. Read AGENTS.md, docs/design.md, docs/features.md, docs/pages.md, roadmap.md, and docs/progress.md; inspect and preserve the established engines and adapters.

Complete the P0 end-to-end workflow with generic stubs: device setup, valid mode-specific calibration, countdown, air exercise or a fixed 15-second desk trial, results, JSON export, and repeatable reset. Wire fused accepted events to one holographic desk ring flash and exactly-once score, requiring visual release before rearming. Keep fused, kinematic-only, and synthetic replay identities explicit throughout. Handle tracking loss, hidden tab, sensor-mode changes, stop, trial boundaries, bounded late-event matching, and aborted sessions according to the design.

Implement deterministic telemetry aggregation and a local summary using the strict schemas: null-safe ROM/baselines, early and late windows, frequency, rhythm SD, rate change, relative acoustic amplitude, and quality data. Avoid storage unless needed; if implementing local baselines, add compatibility/version checks and clear controls. Add metric/schema tests and Playwright replay tests for full flows, permission/error recovery, restart, and labeled fallback. Test UI/controller integration without moving algorithms into components.

Run typecheck, Vitest, production build, and browser tests. Inspect request payloads and source paths for media egress. Carry out the live release checks in design section 8 on the demo setup where possible, including three 15-second fused trials, 20 deliberate taps, and 20 noise/no-contact trials. Record actual counts/performance and limitations, not just 'works'. If hardware requires the operator, provide the precise procedure and leave that gate pending. Fix defects within scope, then update docs/progress.md and README with the complete core demo flow. Do not start phase 7 UI polish until live P0 gates pass.
```

## Phase 7 — Replace stubs with the final presentation

**Deliver:** concise setup/workstation/results UI, readable mirrored canvas overlays, useful feedback, and a collapsible diagnostics view. The underlying controllers and algorithms remain independently tested.

**Acceptance:** both live exercises and replay still pass; styling/view replacement does not alter scoring or timing; accessible focus/text status, reduced motion, narrow-window overflow, and demo/projector legibility are checked. Sensor mode/source remains visible. No made-up charts, historical gains, test status, or clinical claims.

**Model:** GPT-6.1 Sol, high reasoning.

```text
Implement phase 7 of roadmap.md. Read AGENTS.md, docs/design.md, docs/features.md, docs/pages.md, roadmap.md, and docs/progress.md. Confirm the phase 6 real CV and fused desk-tapping gates passed; if not, resolve or report the concrete prerequisite instead of hiding it with polish.

Replace the generic view layer with a coherent hackathon workstation: short setup/calibration instructions, a prominent live hand/target viewport, legible countdown and tap feedback, estimated PIP and orientation status, concise results, reset/export actions, and collapsible diagnostics. Follow docs/pages.md. Keep the same SessionSnapshot/commands and engine ownership; presentation components must not acquire hardware or compute math/DSP. Add Tailwind/Lucide/Recharts only if they earn their dependency cost. Show only real measurements and honest unavailable states; visibly label replay and kinematic-only mode.

Verify keyboard focus, non-color-only statuses, reduced motion, clear error recovery, readable unmirrored text, target alignment after resize, narrow-window overflow, and demo-laptop/projector legibility. Keep no audio feedback during microphone scoring by default. Run typecheck, Vitest, build, and browser tests; inspect the rendered screens and rerun live core smoke checks after layout changes. Fix regressions and document visual/hardware evidence honestly in docs/progress.md with phase 8 handoff. Do not add AI reporting, accounts, prescriptions, or P2 mechanics.
```

## Phase 8 — Release hardening and rehearsal

**Deliver:** reproducible production demo build, setup checklist, known limitations, evidence, 60-second script, and clearly labeled backup replay. Prepare a static HTTPS deployment or documented localhost production preview; external publishing requires its own existing authorization.

**Acceptance:** fresh install, local assets, production build, all automated checks, and live hardware gates pass. Demo starts without runtime CDN/API dependence; microphone denial, no hand, hidden tab, and restart are explainable/recoverable. No outstanding core correctness issue is hidden by replay. No claim of clinical validation is made.

**Model:** GPT-6.1 Sol, high reasoning.

```text
Complete phase 8 of roadmap.md. Read AGENTS.md, docs/design.md, docs/features.md, docs/pages.md, roadmap.md, docs/progress.md, and README.md; inspect the implementation and prior evidence.

Audit and harden the required demo rather than expanding scope. Reproduce install/build from the lockfile, verify model/WASM provenance and local asset loading in a production preview, and test without an external internet connection after preparation. Run typecheck, all unit tests, build, and browser tests. Inspect for media uploads/logging, exposed secrets, stale asynchronous events, unbounded buffers, and resource leaks. Fix concrete release blockers and retest affected paths.

Rehearse the 60-second live flow and repeat design section 8 hardware/performance/tap/noise gates on the actual demo laptop, browser, camera angle, microphone, and desk. Record actual evidence in docs/demo-checklist.md and docs/progress.md. If you cannot operate hardware, finish independent checks, provide the operator checklist, and explicitly leave release acceptance pending. Synthetic replay is a clearly labeled backup, never a substitute for real CV/fused-tap acceptance.

Write docs/demo-script.md with a concise judge walkthrough, setup/preflight, restart and permission recovery, known limitations, and the labeled replay backup. Update README with reproducible production preview and optional static HTTPS hosting steps; do not publish externally without authorization. Mark hackathon release complete only when required software and live gates pass. List remaining optional work separately and do not begin it automatically.
```

## Phase 9 — Optional AI draft summary, only after release

**Deliver:** an explicitly invoked report draft with strict data boundaries and a local fallback. Skip this phase if the event schedule is tight or no server/credentials are available.

**Acceptance:** browser bundle has no secret; request is only validated aggregate telemetry; malicious/oversized inputs, timeouts, rate limiting, provider refusal, malformed output, and unavailable credentials preserve local results. No billing codes, invented symptoms, automatic targets, or unsupported medical conclusions.

**Model:** GPT-6.1 Sol, high reasoning.

```text
Implement optional phase 9 of roadmap.md only. Read AGENTS.md, docs/design.md, docs/features.md, docs/pages.md, roadmap.md, and docs/progress.md and confirm the core release is complete. Inspect current official provider documentation before implementing API integration.

Add an optional SOAP-style draft summary behind a report service interface, with the deterministic local template as the default/fallback. Vite has no built-in API routes: choose and document a small server/serverless adapter compatible with the intended host. Store API keys only on that server, use explicit configuration for the report model, and never expose secrets through VITE_* variables. The browser sends only strict validated aggregate telemetry after an explicit action; enforce bounded request/output sizes, validation, request timeout, and rate limiting on the server. No media or landmark arrays may be submitted or logged.

Label template versus LLM source and unreviewed draft status. Missing subjective data stays 'not collected'; do not infer diagnoses, billing eligibility, or treatment prescriptions, and do not change exercise targets from generated text. Keep network/provider/refusal/schema failures recoverable without losing the session results. Add contract/security/failure-path tests, run all established checks, and document server setup, privacy boundaries, and credentials requirements without requesting secrets in chat. Update docs/progress.md and README. Do not publish externally or implement P2 mechanics automatically.
```

## Deferred P2 and scope control

P2 is intentionally not part of the completion path and has no implementation phase authorized by this roadmap. After the hackathon, choose one experiment and create its own bounded fresh-chat phase with a prompt, model, evidence requirements, and revised design: ghost replay first, bimanual mirroring second, oscillation analysis only after sampling/noise validation. Do not bundle all three into a final “finish everything” prompt.

When time runs short, omit phase 9 and P2, simplify phase 7 to the minimum legible presentation, and preserve phase 8 verification. Do not cut either live CV or fused holo desk tapping. There is no defensible calendar estimate yet because the deadline, hardware behavior, and available working hours were not supplied; gates and the first hardware trial determine the remaining risk.
