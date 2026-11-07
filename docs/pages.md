# ITap — UI States and Replacement Contract

These are states within one browser app, not five mandatory routes. Build semantic HTML stubs first and replace their presentation only after the engines and both exercises pass their gates. [design.md](design.md) defines behavior; [../roadmap.md](../roadmap.md) defines execution order.

## Shared contract

Views consume `SessionSnapshot` and controller commands. High-frequency canvas data lives in refs/buffers. Views do not import MediaPipe, create AudioContexts, compute angles, detect taps, or manage matching windows. Keep debug controls usable throughout implementation. “Generic” means basic but functional controls, not mock counters or fake camera states.

## 1. Setup and calibration

Initially: device start/stop buttons, mode selector, tracked-hand status, retry/error text, calibration progress, and simple positioning instructions. Request camera and microphone separately from user action. Palm calibration uses three seconds of stable observations; desk calibration separately places a ring and records rest plus guided lift/taps. Show explicit failure/retry for insufficient motion, noise, or tracking.

Later: concise guided setup showing the required camera angle and desk region. Display microphone degradation and chosen hand clearly. No therapist prescription builder or account setup is required.

## 2. Workstation

Initially: mirrored webcam and correctly aligned canvas skeleton, ring, dwell/strike feedback, start/countdown/stop/reset buttons, estimated PIP value, and plain counters. Desktop setup must expose the fingertip and desk; target placement uses the inverse display transform.

Later: make the active target and timing easy to read, separate exercises visually, and show concise orientation feedback. Use text/icon as well as color, visible keyboard focus, and reduced-motion support. Do not flash the whole screen or label users as “cheating.” The desk ring requires contact/release, not dwell. Keep processing-status text unmirrored.

## 3. Results

Initially: summary table and JSON export. Show data source, sensor mode, completed/aborted status, duration, relevant exercise metrics, and unavailable values as “not measured.” Fused and kinematic counts cannot be conflated. Reset prepares another judge's trial.

Later: a compact 15-second tap timeline and optional compatible baseline comparison; no fabricated history. Explain negative rate change as slower tapping, not diagnosed fatigue. Include clear local-data controls if persistence is enabled.

## 4. Diagnostics

A collapsible developer view may exist from the stub phase. Show measured render FPS, inference FPS, result age, selected delegate, calibration state, and visual/audio/matched events. Do not claim test success unless linked to a real build verification record. “Media processed locally” describes an inspected data flow, not regulatory certification.

## 5. Optional report

Only after the core and presentation pass: an explicit send-summary action, loading/error states, a labeled template/LLM source, and draft text. Failure leaves local results intact. Do not display billing codes or automatically apply exercise prescriptions.

## Presentation acceptance

A new user should complete setup, an air target, desk tapping, results, and reset with minimal narration. Validate on the demo laptop and projector-sized viewport, plus a narrow window for overflow. Replay must stay visibly marked “Synthetic replay” in every state. Do not imply mobile hardware support without testing it.
