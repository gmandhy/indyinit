# AGENTS.md — ITap / ITap Operational Protocol

## 1. Identity and required reading

ITap is a browser-native, rehabilitation-inspired hackathon prototype combining local CV hand tracking with holographic desk-target tapping and camera/microphone event matching. It is not a validated clinical device or an insurance-ready reporting system.

Before implementation read `docs/design.md`, `docs/features.md`, `docs/pages.md`, and root `roadmap.md`. The design contains coordinate contracts, formulas, state machines, privacy rules, and schema requirements. The roadmap owns phase order. Do not implement from the original unsupported clinical claims.

## 2. Selected stack and commands

- Vite + React 19, strict TypeScript, Canvas 2D; semantic HTML/CSS stubs initially.
- `@mediapipe/tasks-vision` HandLandmarker; native Web Audio AudioWorklet for continuous impulse detection.
- Zod runtime validation, Vitest deterministic tests, Playwright browser tests when introduced.
- Tailwind, Lucide, Recharts optional in the late UI phase. No mandatory backend for the demo.

Phase 1 establishes these commands; they do not exist in the documentation-only starting repository:

- Install: `npm install`; reproducible subsequent install: `npm ci`.
- Dev: `npm run dev`.
- Typecheck: `npx tsc --noEmit` (configure this to check application, worker, and test code).
- Unit tests: `npx vitest run`.
- Build: `npm run build`.
- Browser tests once added: `npm run test:e2e`.

## 3. Mandatory engineering rules

1. Fail fast in pure functions on invalid length, nonfinite inputs, degenerate vectors, and invalid time. Runtime boundaries turn expected tracking loss/device failures into explicit states, never dummy zeros or silent catches.
2. Fix root causes of dropped frames, timing mismatches, and jitter; keep thresholds named, unit-bearing, documented, and validated. Do not hide defects with timeouts or arbitrary output multipliers.
3. Challenge physically invalid claims. Image landmarks do not measure impact force, absolute desk depth, nerve conduction, or clinical wrist angles. Use the defined estimates and proxies.
4. Raw camera frames and microphone audio never leave the browser or enter persistence/logging. Only deliberately submitted, validated, minimized summary telemetry may reach an optional reporting server. Do not call it guaranteed anonymous.
5. Keep engine logic independent of React and replaceable UI stubs. Do not implement visual polish before the required live core is proven.

## 4. Hardware invariants

- Never install deprecated `@mediapipe/hands`. Pin Tasks Vision and its matching local WASM/model assets.
- Hardware is client-only and initialized after user action in an owned lifecycle. In Vite no `"use client"` directive is required; use it if porting to Next.js.
- Dispose media tracks, frame callbacks, audio nodes/context, landmarker, workers, and bitmaps; handle Strict Mode and late initialization promises.
- Avoid React state updates for raw high-frequency samples. Draw from refs; publish UI snapshots at 10–15 Hz.
- Mirror video and skeleton exactly once, preserving letterboxing/aspect ratio and readable labels. Share forward/inverse coordinate transforms.
- World landmarks are for within-hand math; source-pixel coordinates are for collision and motion. Never combine their units.
- Measure rendering and inference separately. Aim for 60 FPS rendering; never promise 60 FPS inference without evidence. Apply design acceptance budgets on the actual demo hardware.
- Timestamp events at capture/sample time, align clocks, and match both event arrival orders. Fallback and replay modes must be explicit.

## 5. Workflow and handoff

Follow P0 -> P1 -> optional P2 in `roadmap.md`; both CV and desk tapping are P0. After each implementation module run typecheck, unit tests, and build. Pure math/DSP in `src/lib/biomechanics.ts` and `src/lib/acousticTap.ts` needs deterministic tests in `src/lib/__tests__/` passing before UI integration. Use browser tests for integration; live device evidence is a separate gate.

Keep changes focused and commits atomic when commits are requested. At the end of a phase update `docs/progress.md` with scope, commands/results, hardware evidence or pending checks, decisions, known issues, and the next phase. Never mark hardware acceptance passed based on synthetic tests. A new phase begins in a fresh chat using its roadmap prompt; follow-ups for the same phase can stay in that chat.
