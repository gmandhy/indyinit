# AGENTS.md ITap Operational Protocol

## 1. ITap Identity
**HoloRehab** is a browser-native, clinical-grade spatial and vibro-acoustic hand physical therapy workstation. It fuses 60 FPS 3D computer vision (`@mediapipe/tasks-vision`), trigonometric goniometry, and Web Audio API desk-tap impulse detection to track range of motion (ROM), block compensatory wrist cheating, and generate insurance-ready clinical SOAP notes.

Read `@design.md` (or `design.md`) for full mathematical formulas, landmark indices, state machines, and Zod schemas before implementing any feature.

## 2. Tech Stack & Commands
- **Framework:** Next.js (App Router) or Vite + React 19, TypeScript (Strict Mode), Tailwind CSS, Lucide Icons, Recharts.
- **Vision & Audio:** `@mediapipe/tasks-vision` (`HandLandmarker`), native Web Audio API (`AudioContext`, `AnalyserNode`).
- **Validation & Testing:** `zod` for runtime schema enforcement, `vitest` for deterministic math/DSP unit tests.

### Executable Commands
- Install: `npm install`
- Dev Server: `npm run dev`
- Typecheck: `npx tsc --noEmit`
- Run Unit Tests: `npx vitest run`
- Build Check: `npm run build`

## 3. Core Engineering Principles (Mandatory)
1. **Fail Fast on Preconditions:** Throw explicit, descriptive errors immediately when preconditions fail (e.g., invalid landmark array length !== 21, zero-magnitude bone vectors, uninitialized `AudioContext`, missing env vars). Never swallow errors with silent `catch {}` blocks or fallback dummy values that mask broken math.
2. **Fix Root Causes, Never Symptoms:** If frame rates drop or angles jitter, fix the underlying lifecycle leak or vector normalization math—do not slap `setTimeout` or arbitrary magic multipliers on the output.
3. **Challenge Faulty Assumptions:** If a prompt asks for something physically or architecturally flawed (e.g., measuring Newtons of force from RGB pixels alone, or streaming raw webcam frames over HTTP), stop and propose the mathematically valid alternative defined in `design.md`.
4. **Zero-Video-Egress Privacy Boundary:** Raw webcam frames and microphone audio streams MUST NEVER leave the client browser. Only validated, anonymized telemetry JSON (`SessionTelemetrySchema`) may be sent to the LLM API route.

## 4. Silent Invariants & Hardware Gotchas (Do Not Violate)
- **NEVER install deprecated `@mediapipe/hands`:** Always use `@mediapipe/tasks-vision` (`FilesetResolver` + `HandLandmarker.createFromOptions`).
- **Client-Only Hardware Execution:** Any component touching `navigator.mediaDevices`, `AudioContext`, or `HandLandmarker` must be strictly client-side (`"use client"`) and initialized inside a guarded lifecycle hook with proper cleanup (`cancelAnimationFrame`, `audioContext.close()`).
- **Avoid React State in the 60 FPS Loop:** Do NOT call `setState` on every `requestAnimationFrame` tick for raw landmark coordinates—it will thrash the React reconciliation tree. Mutate a `useRef` for 60 FPS canvas rendering and throttle React UI state updates (charts/angle readouts) to 10–15 Hz (`~66-100ms`).
- **Mirroring Invariant:** Webcam video is mirrored horizontally (`scaleX(-1)`) for natural user interaction. Ensure canvas coordinate math and text overlays account for mirrored X-coordinates (`1.0 - landmark.x`).

## 5. Development Workflow & Phased Execution
Work strictly in order of priority (`P0` -> `P1` -> `P2` in `design.md`). After completing each module:
1. Run `npx tsc --noEmit` to verify zero type regressions.
2. Pure math and DSP functions (`src/lib/biomechanics.ts`, `src/lib/acousticTap.ts`) MUST have corresponding deterministic tests in `src/lib/__tests__/`. Run `npx vitest run` and ensure 100% pass rate before wiring into the UI.
3. Keep commits atomic and verify the live camera/canvas loop remains at 60 FPS.

## 6. Reference Index
- Biomechanical 3D math, Landmark IDs & Cheat Thresholds -> `design.md#3-biomechanical-math--3d-goniometry-engine`
- Spatial Target Collision & Calibration -> `design.md#4-spatial-holo-target-engine--mechanics`
- Vibro-Acoustic Desk Tap Sensor Fusion -> `design.md#5-vibro-acoustic-desk-tap-sensor-fusion`
- Zod Telemetry & SOAP Note Schemas -> `design.md#6-data-schemas--ai-clinical-pipeline`
- Stretch Mechanics (Ghost Hand, Mirroring, Tremor) -> `design.md#7-p2-creative-stretch-mechanics`