# ITap — Hackathon Engineering Specification

## 1. Goal, scope, and evidence

Build a browser-native hand exercise prototype in which a judge sees their tracked hand, reaches on-screen targets, and taps a real desk to activate a holographic target overlay. A complete demo includes local CV hand tracking, a 15-second tapping session with camera/audio event matching, and a truthful results summary. “Holo” means a camera overlay, not a physical projection or reconstructed 3D desk.

This is a rehabilitation-inspired prototype, not a validated medical device. Angles are model estimates; tap speed and acoustic amplitude do not establish nerve conduction, motor cortex speed, force, or a diagnosis. Remove the previous unsupported 70% adherence statistic, 2–3° accuracy implication, insurance guarantees, and HIPAA-compliance claim. Local processing is a privacy design decision, not proof of regulatory compliance. Event matching reduces some false positives but cannot prove physical contact.

Priority order:

- **P0:** build foundation, CV, geometry, air targets, desk calibration, audio/visual tapping, session results, and reliable demo operation using generic UI stubs.
- **P1:** replace the stubs with a coherent presentation and rehearse the release. An AI draft report is optional, after the core works.
- **P2:** ghost replay, bimanual targets, exploratory oscillation analysis; none blocks hackathon completion.

[../roadmap.md](../roadmap.md) owns execution order and fresh-chat prompts. [features.md](features.md) owns scope; [pages.md](pages.md) owns presentation states. No official judging rubric was supplied; confirm it before adding track-specific requirements.

## 2. Architecture and stack

### 2.1 Decisions

Use **Vite + React 19 + strict TypeScript**, HTML5 Canvas 2D, `@mediapipe/tasks-vision`, Web Audio `AudioWorklet`, Zod, and Vitest. Add Playwright for browser integration tests. Use plain semantic HTML and minimal CSS first; Tailwind, Lucide, and Recharts may be introduced during UI replacement only if useful. No Three.js, database, authentication, or server is required for P0. Vite is chosen because all required sensing and processing are local; Next.js server components and API routes add no value to that critical path.

At scaffolding time select mutually compatible stable versions and a supported Node LTS satisfying Vite's requirements; pin Node, package versions, and the lockfile. Document exact versions rather than using runtime `@latest` URLs. Copy the WASM files from the installed MediaPipe package and a versioned hand model into local public assets with provenance, license, and checksum recorded. Missing assets must fail with an actionable setup error. Assets are build-time downloads, never runtime dependencies on a venue connection.

MediaPipe configuration: `runningMode: "VIDEO"`, `numHands: 1` initially; 0.6 detection, presence, and tracking confidence are provisional configuration defaults. Try the GPU delegate, then explicitly report a CPU fallback if supported. Use `FilesetResolver.forVisionTasks('/mediapipe/wasm')` and a plain URL `/models/hand_landmarker.task`; the previous Markdown links embedded inside URL strings were invalid. No deprecated `@mediapipe/hands`.

### 2.2 Modules and replaceable UI boundary

```text
src/
  main.tsx
  app/App.tsx                     # compositions, not sensing algorithms
  components/stubs/               # disposable controls/status/results
  components/workstation/         # added in the late UI phase
  rendering/                      # canvas skeleton, targets, coordinate mapping
  hooks/useSessionController.ts   # owns runtime; exposes commands + snapshots
  engine/
    sessionController.ts          # lifecycle/state orchestration
    sessionReducer.ts             # deterministic transitions
    telemetry.ts                  # aggregate measurements, no media
  adapters/
    camera.ts                     # stream ownership and frame timestamps
    vision.ts                     # worker transport, bounded frame scheduling
    audio.ts                      # graph lifecycle and clock mapping
    replay.ts                     # labeled synthetic fixtures, same contracts
  workers/handTracking.worker.ts
  audio/tapProcessor.ts           # compiled worklet; no React dependencies
  lib/
    schemas.ts
    biomechanics.ts
    coordinates.ts
    spatialTargets.ts
    acousticTap.ts                 # pure DSP/event matching shared with tests
    config.ts                     # named thresholds, units, rationale
    __tests__/
public/mediapipe/wasm/
public/models/hand_landmarker.task
fixtures/                         # synthetic timestamps/landmarks/events only
```

Define a `FrameSample` with sequence ID, capture timestamp in the session monotonic clock, separate image/world landmark arrays, handedness metadata, and validity status. Define compact `AudioImpulse` events with sample-derived timestamp and RMS. A `SessionSnapshot` contains low-rate display data, target state, metrics, and diagnostics; commands include start devices, calibrate, start exercise, stop, reset, and dispose. UI components receive snapshots and callbacks; they never own algorithms or permission requests. Draw high-rate geometry from refs/buffers; publish snapshots at 10–15 Hz. A second stub view must be able to use the same controller without changing engine code.

### 2.3 Hardware lifecycle and performance

- Request camera and microphone separately on user action so microphone denial does not cancel working CV. HTTPS or localhost is required. Resume audio from that gesture. In Vite this is client-only code; `"use client"` is only necessary if ported to Next.js.
- Stop all media tracks, close AudioContext and HandLandmarker, disconnect nodes, terminate workers, cancel frame callbacks, remove listeners, and release ImageBitmaps on stop/unmount. Handle permission promises resolving after disposal and React Strict Mode remounts.
- `detectForVideo` is synchronous. Isolate inference in a worker where the selected browser supports the pipeline; prove the exact bitmap/OffscreenCanvas/delegate combination early. Permit a measured, explicitly reported throttled main-thread fallback. Keep at most one frame in flight; drop excess frames, never queue indefinitely.
- Capture each new video frame once, using `requestVideoFrameCallback` where supported, with a deduplicated `requestAnimationFrame` fallback. Preserve capture timestamps through worker results. Use monotonic increasing inference timestamps and reject stale sequence results.
- Separate render FPS, inference FPS, inference duration, and capture-to-result age. **60 FPS rendering is a target, not a guarantee of 60 FPS inference.** Aim for at least 24 inference FPS and p95 result age <=120 ms on the documented demo laptop. These are demo gates to measure, not medical accuracy specifications. If missed, improve resolution/scheduling/delegate settings and remeasure; do not relabel interpolated frames as new inference.
- No-hand is a normal state. Invalid math inputs throw at pure-function boundaries; the runtime catches specific errors, marks a sample invalid, and suspends scoring with a visible reason. It must not fabricate zero angles or repeatedly crash the frame loop. Reject nonfinite values. Track loss, device change, resize that invalidates desk placement, and tab suspension invalidate pending events and calibration as appropriate.

## 3. Biomechanical math and coordinate contracts

### 3.1 Landmarks and spaces

Validate exactly 21 finite landmarks per present hand. Topology: wrist 0; thumb CMC/MCP/IP/tip 1–4; index MCP/PIP/DIP/tip 5–8; middle 9–12; ring 13–16; pinky 17–20. Image landmarks and world landmarks are different types and must never be interchangeable.

- Use model **world landmarks** for within-hand 3D angles and relative lengths. Their estimated metric coordinates are centered on the hand and are not absolute desk/world positions. Wrist translation must be measured in image space; world wrist positions from separate frames are not an absolute trajectory.
- Use image X/Y mapped into aspect-correct video pixels for collision, desk regions, and visual tap motion. Never mix normalized X/Y with world Z or use raw normalized X/Y distances on a nonsquare video.
- For contain-fit video dimensions W,H and viewport Cw,Ch: s=min(Cw/W,Ch/H), ox=(Cw-sW)/2, oy=(Ch-sH)/2. Display X=ox+sW(1-x), Y=oy+sHy for the mirrored view. Inverse-map pointer placement through the same transform. Store targets in unmirrored source pixels or normalized source coordinates and render through that transform once. Canvas labels remain unmirrored. Set canvas backing size using devicePixelRatio without changing logical collision coordinates. Test letterboxing, resize, and both hands.

### 3.2 Palm calibration

Collect **three seconds of valid stable open-palm observations**, with enough samples at the measured frame rate (initial minimum 45). Restart the window on tracking loss or excessive variation. Use robust medians and report insufficient size, unstable pose, or occlusion rather than accepting bad data.

For desk setup, use the same stable-observation, visibility, size, scale, wrist-drift and orientation requirements to calibrate palm geometry, without the absolute PIP/DIP open-finger gate. This step does not verify an open-hand posture or correct joint-angle error; desk contact/rest/motion are calibrated separately. Air mode retains its provisional open-finger posture check.

Keep two scales: `palmWorld` = median ||world[9]-world[0]||, and `palmPixels` = median ||pixel[9]-pixel[0]||. The former normalizes within-hand ratios; the latter sizes on-screen targets. Both must be finite and nonzero. Small-image and stability thresholds are named pixel/ratio configuration values validated on hardware, not a universal `0.01` distance test. Freeze calibration during a trial; require recalibration after major camera/hand-distance change. This does not make targets perfectly invariant to perspective or distance.

### 3.3 Joint angles

For world points A,B,C, u=A-B and v=C-B. Reject lengths below an explicitly unit-bearing epsilon (initial 1e-6 m). Then:

```text
interiorDeg = acos(clamp(dot(u,v)/(length(u)*length(v)), -1, 1))*180/pi
flexionDeg = 180 - interiorDeg
```

Index PIP uses 5,6,7; DIP uses 6,7,8. 0,5,6 is an **MCP proxy**, since wrist-to-MCP is not a directly measured metacarpal bone axis. The formula gives an unsigned bend, not signed hyperextension. Label all readouts as estimates. Thumb-tip(4) to pinky-MCP(17) distance / palmWorld is a thumb reach ratio, **not a Kapandji score**. Core demo needs index PIP only; additional angles are optional.

Use time-based display smoothing `alpha=1-exp(-dt/tau)` with initial tau=80 ms, reset on gaps. Retain raw valid measurements separately; do not apply display lag to impulse timestamps. ROM is `maxFlexionDeg-minFlexionDeg`, not “maximum extension.” Compare sessions only for matching hand, exercise, calibration conditions, and sensor mode. An extension deficit decrease can be reported as baseline minimum flexion minus current minimum flexion, never invented when baseline is absent.

### 3.4 Palm orientation guard

HandLandmarker has no forearm landmarks; it cannot directly measure anatomical wrist angle or detect every compensatory arm movement. Report a **palm orientation deviation proxy**.

From world landmarks, normalize a=(9-0); remove a's component from (17-5) and normalize the result b; n=normalize(cross(a,b)). Reject degenerate axes. Save baseline axes for the selected hand. Deviation is the maximum clamped acos angle between corresponding current/baseline axes. This catches longitudinal tilt and roll that the previous single-vector test missed. Require recalibration on hand switch.

Initial demo thresholds: lock at >18°, unlock below 14°; these are tunable interaction thresholds, not validated clinical cutoffs. Count one blocked attempt per continuous lockout during an active attempt, not once per frame. For air mode an attempt starts on entry, ends on exit/success/lockout, and requires exit before a new attempt. Expose attempts, blocked attempts, and lockout events separately. Desk mode uses its own stationary-wrist gate.

## 4. Spatial holo targets and session state

### 4.1 Air mode

Targets are **2D screen-space circles** with ID, offset from calibrated wrist in palmPixels, radius in palm units, `requiredLandmarkIndex` (8 for index), and dwellMs (initial 250). Anchor offsets in the calibrated image basis and translate with the current wrist; do not rotate targets to follow compensatory tilt. Collision distance and radius use the same source-pixel units. Require continuous valid in-target time and unlocked orientation; reset dwell on exit, lockout, tracking loss, or stale samples. Score once, then require release/exit before rearming. Target paths must stay on-screen and be reachable; targets alone do not prove isolated tendon movement.

### 4.2 Desk mode: required holographic interaction

Use an oblique camera view showing the fingertip's lift and return; a top-down view may hide vertical motion. The operator places a visible target ring on the imaged desk under the index finger. Collect a resting fingertip location plus 3–5 guided lifts/taps to estimate image-space motion direction, contact band, amplitude, timing offset, and wrist motion tolerance. Reject a setup with insufficient projected motion rather than pretending image Y is always vertical. Store calibration for that fixed camera/desk position. No metric plane reconstruction is implied.

The core desk interaction is one ring that flashes and increments exactly once per accepted tap; moving between several desk pads is stretch scope. At contact, the fingertip must lie in the target region and calibrated contact band. Lift/release is required before the next score; a 250 ms dwell is **not** required for a tap. Show visual candidate, acoustic impulse, and fused acceptance distinctly in debug mode. No audio feedback while listening by default, to avoid triggering on the app's own sounds.

#### User-authorized two-pad extension (2026-11-07)

The tracked trial may explicitly select `left_right` desk layout. Calibrate Left then Right separately using the same palm/hand/camera owner and the existing rest plus 3–5 lift/return cycles per pad; reject overlapping rings and labels reversed in the mirrored display. Each pad keeps its own contact axis, band, excursion, and wrist-rest baseline. Record the shared microphone timing offset with 3–5 alternating-pad timing taps. Do not infer a contact plane for the rest of the desk.

Route observations to a calibrated pad only when the fingertip is within that pad's lift corridor and the wrist is near that pad's measured rest. Travel clears pending contact and requires a new lift/return at the destination; travel alone does not invalidate the other pad. Tracking/hand/camera/scale failures still invalidate calibration. Give candidate contact cycles unique IDs across pads, preserve the extremum position and pad identity through symmetric audio matching, and flash/count only the matched pad. UI shows both rings, per-pad counts, and last matched side; existing summary export uses combined counts. Single-ring behavior remains independently available. This extension is software-tested; live multi-pad accuracy remains a separate gate.

### 4.3 State machines

Session: `idle -> requesting -> ready -> calibrating -> calibrated -> countdown -> running -> complete`; cancellation goes to ready/idle as resources dictate; faults enter recoverable error. A selected mode determines calibration and permissions. Reset clears timers, pending fusion events, counters, and calibration that is no longer valid. Hardware stop releases resources; restart is repeatable.

A tap session uses a monotonic 15-second wall-clock interval. At tracking loss or hidden tab, abort and mark the trial incomplete; require a fresh countdown rather than silently extending the trial or counting hidden taps. Late-delivered events may complete matching after the end only if their capture times were within the trial and its bounded matching grace period. Aborted trials have no comparable early/late rate change.

## 5. Vibro-acoustic desk tap fusion

### 5.1 Pure visual detector

Let p(t) be the fingertip pixel position and d the calibrated unit lift-to-contact direction. Use q(t)=dot(p(t)-rest,d)/palmPixels and capture-time velocity `(q(t)-q(t-1))/dt`, not callback arrival time. Use a `lifted -> descending -> contactCandidate -> released` state machine with hysteresis, a contact band, minimum excursion, valid target overlap, and bounded image-space wrist speed (palm units/s). Timestamp a candidate at the observed contact extremum; lookahead confirmation may arrive later. Named thresholds come from calibration/configuration, not arbitrary multipliers hidden in rendering. Gaps, invalid samples, lockouts, and session changes clear candidates.

### 5.2 Audio detector

Request microphone with echo cancellation, noise suppression, and auto gain control disabled where supported; inspect actual settings, since constraints are not guarantees. Capture locally with `AudioWorklet`. Process actual block lengths/sample rates, aggregate rolling ~10 ms windows, and emit compact impulse events plus a throttled level meter. Never send PCM through React, persist audio, or upload it. AnalyserNode may drive a decorative meter, but polling its latest 512 samples once per video frame misses audio between polls. Its `smoothingTimeConstant` is not a time-domain RMS smoothing algorithm.

RMS = sqrt(sum(samples squared)/N). Calibrate background during a quiet interval; initial threshold `max(0.04,3*noiseRms)` and 90 ms refractory period are provisional defaults. Use onset/peak hysteresis and freeze background adaptation during impulses; time-based noise adaptation and a calibrated threshold should handle microphone differences. Record sample-derived onset/peak times consistently and use one convention throughout fusion. Missing/clipped input or unworkable noise floor is a visible calibration failure. Keep audio output silent.

### 5.3 Shared time and symmetric matching

Map audio sample time (`currentFrame/sampleRate`) into the session performance clock using an explicit clock anchor; resynchronize after suspension and invalidate old buffers. Video uses capture timestamps in that same clock, not inference completion times. During guided calibration estimate the audio-minus-visual contact offset using unambiguous spaced pairs; persist its value and residual spread. Reject excessive residual uncertainty. Browser/device latency means sub-frame physical timing is not guaranteed.

Maintain bounded queues of unmatched visual and audio events. Correct audio timestamps by the calibrated offset, then match nearest unmatched events with absolute time difference <=80 ms (initial configurable tolerance). Match whether audio or visual arrives first. Allow up to 250 ms delivery lateness initially, flush unmatched events thereafter, and invalidate stale results beyond that budget. Tolerance and delivery budget have distinct roles. Each event can be consumed once, and each visual release/contact cycle can yield at most one tap. Unit-test tie-breaking, boundary inclusion, out-of-order delivery, duplicates, cooldown, and events crossing trial boundaries. This is temporal coincidence matching, not mathematical waveform cross-correlation.

If audio is unavailable, explicitly select `kinematic_only`; count visual taps separately, never as verified taps. A mode change during a trial aborts it. Replay is a separate data source, always labeled. Neither fallback satisfies the live fused-demo acceptance gate.

### 5.4 Metrics

For a completed 15-second trial, accepted count / 15 is frequencyHz; early and late counts use capture times in [0,5) and [10,15), divided by 5. `rateChangePct=100*(lateHz-earlyHz)/earlyHz`, null when earlyHz=0 or trial incomplete. Negative means slower; do not label it diagnosed fatigue.

Report population SD of inter-tap intervals only with at least two intervals (three taps), otherwise null. Acoustic mean and coefficient of variation are relative microphone amplitude statistics for matched taps, not impact force; null without suitable audio or when the mean is zero. Empty means/ROM extrema and missing baselines are null, never dummy zero. Verified counts apply only to fused mode; kinematic counts remain distinct. Include rejected candidates and tracking coverage for debugging, without treating false-negative estimates as ground truth.

## 6. Data contracts, privacy, and optional reporting

Implement strict Zod schemas as the single source of truth; infer TS types. This table replaces the original incompatible required-ROM schema. Validate nested objects strictly, finite numbers, integer counts, bounds, relationships, and size limits; version the schema from the start.

| Contract | Required content and invariants |
| --- | --- |
| FrameSample (local only) | sequence; captureTimeMs; image/world arrays of 21 finite points or explicit absent/invalid state; selected hand; no dummy arrays |
| Calibration (local only) | hand; video dimensions; median palm scales; palm basis; mode; desk region/direction/contact band and audio offset for fused desk mode; configuration revision |
| SessionTelemetrySchema | schemaVersion=1; random sessionId (not a user ID); source=`live` or `synthetic_replay`; exercise=`air_targets` or `desk_tap`; sensorMode=`vision_only`, `fused`, or `kinematic_only`; status=`completed` or `aborted`; finite durationSeconds>0; quality; exercise-specific metrics |
| Quality | valid/total frame counts; coverage in [0,1]; attempts, blocked attempts<=attempts; lockout events; max palm deviation in [0,180] or null; compensation percentage null with zero attempts |
| Air metrics | completed reps; min/max/mean PIP flexion in [0,180] or null; ROM range or null; baseline comparison nullable; no tap metrics |
| Desk metrics | acceptedTapCount; verifiedTapCount; kinematicTapCount; frequencyHz; earlyHz/lateHz nullable for aborts; rateChangePct nullable; rhythmJitterMs nullable; meanAcousticRms and acousticCv nullable; no mandatory ROM metrics |
| Report draft (optional) | source=`template` or `llm`; disclaimer; bounded subjective/objective/assessment/plan strings; no billing codes or automatic exercise prescription |

Use a discriminated union by exercise and refinements by mode/status. Air requires vision_only. In fused desk mode accepted=verified and kinematic=0; in kinematic mode accepted=kinematic and verified=0, with acoustic fields null. Derived rates/counts must reconcile, max>=min, and min/max/mean/range must have consistent nullability. Define exported schema limits and test hostile/oversized payloads. Local arrays never belong in report requests.

The required result is a deterministic local summary and downloadable validated JSON. Baselines are opt-in local summary records with version, clear/reset controls, and compatibility checks; no raw media is stored. Landmarks and event buffers are bounded and memory-only by default. No analytics, remote error logs containing sensor data, WebRTC transmission, or frame/audio upload. Aggregate telemetry is minimized and identifier-free but is not guaranteed anonymous merely because it is JSON.

Optional AI reporting comes after P0 and UI: Vite does not provide API routes, so add an explicit small same-origin server/serverless adapter only if that phase is chosen. Keep keys server-side, never in `VITE_*`; use request size/rate/time limits, input and output validation, and an explicit send-summary action. Network failure/refusal/invalid output keeps the local report usable. The LLM may draft text from observed metrics but must not invent symptoms, diagnoses, billing eligibility, or treatment plans. Mark missing subjective information as not collected. No automatic target changes based on LLM output. Schema-valid output can still be false and must remain an unreviewed draft.

## 7. Stretch mechanics (P2 only)

- **Ghost hand:** bounded timestamped landmark replay in memory; optional deliberate IndexedDB export with retention/clear controls. Align wrist, palm scale, orientation, and elapsed time. Do not write frame streams to synchronous localStorage.
- **Bimanual mirroring:** a reflected palm-local coordinate basis plus explicit handedness and calibration. Screen `x -> -x` alone does not recover matching anatomical motion. User-adjusted comfortable targets, no inferred prescription.
- **Oscillation visualization:** measured sampling rate, detrending, uniform resampling, anti-aliasing, and tracking-noise characterization precede spectral analysis. A 4–12 Hz band needs reliable sampling above 24 Hz with margin. Reject inadequate data. Use pixels/palm units, not claimed submillimeters or diagnosis.

## 8. Verification and demo release gates

Every implementation phase runs typecheck, deterministic tests, and production build. Math/DSP tests must pass before live wiring. Browser tests cover replay workflow, denied devices, reset/dispose, mirrored coordinates, and invalid data. They do not validate camera accuracy or real microphone timing.

On the intended laptop/browser/camera/desk, record versions and results: 60-second stable tracking; three complete 15-second fused sessions; deliberate taps vs accepted count; speech/claps without finger motion; silent hover/lift without desk contact; duplicate suppression; hand loss; microphone denial; repeated start/stop; local production assets with internet unavailable. Initial demo target is >=18 accepted out of 20 deliberate taps and <=1 false acceptance in 20 deliberate noise/no-contact trials, each recorded with the test setup. These are small demo checks, not clinical validation. Failure blocks the fused-demo claim and requires tuning/retest or an explicit unresolved limitation.

Rehearse a 60-second walkthrough: start and calibrate, show live skeleton/PIP estimate, activate an air target, run 15-second desk taps, explain fused evidence, view summary, reset. Keep a labeled synthetic replay for presentation continuity and testing; it never replaces evidence that real CV and desk tapping work. UI test-status badges must identify a real build/test record, not be hardcoded green.

## 9. References and audit notes

Technical references checked 2026-11-07:

- [Google Hand Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web): image/world outputs and setup.
- [HandLandmarker API](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.handlandmarker): synchronous video inference.
- [AudioWorklet process](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process) and [sample clock](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/currentFrame): audio-thread processing and timestamps.
- [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): permissions and secure contexts.
- [Vite guide](https://vite.dev/guide/): frontend build setup; check current Node requirements when scaffolding.

Thresholds, architecture choices, calibration procedures, and acceptance budgets above are project engineering decisions to validate, not claims established by these sources. Major corrections from the initial specification: valid local asset URLs; one selected stack; separate image/world units; aspect-correct mirroring; honest angle/proxy labels; event-based lockout counts; desk-first P0; continuous audio capture; symmetric clock-aligned fusion; null-safe metrics; no unsupported clinical/billing claims; and UI after functional proof.
