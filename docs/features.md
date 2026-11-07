# ITap — Feature Scope

ITap is a local-first, rehabilitation-inspired hackathon prototype. Its defining interaction is a tracked hand activating on-screen holographic targets while tapping a physical desk. See [design.md](design.md) for contracts and [../roadmap.md](../roadmap.md) for implementation phases.

## P0 — Required working demo, generic UI

| Feature | Observable behavior | Implementation boundary |
| --- | --- | --- |
| Live CV hand tracking | Mirrored webcam, aligned 21-point skeleton, tracked/lost status | Local MediaPipe Tasks Vision; separate render/inference FPS |
| Estimated goniometry | Index PIP flexion and session range in degrees | World-landmark math; not validated clinical measurement |
| Calibration | Stable palm scale; separate desk contact/lift calibration | Three seconds of valid palm observations, then guided desk taps |
| Air holo targets | Reach, dwell, release, score | Aspect-correct 2D collision; default 250 ms continuous dwell |
| Orientation feedback | Excess palm deviation blocks an air attempt | Palm orientation proxy, not a measured forearm/wrist joint angle |
| Holo desk tapping | Desk ring flashes once for each accepted physical tap attempt | Visual motion/contact band + local microphone impulse matching |
| 15-second trial | Counts, frequency, rhythm, early/late speed change | Capture-time metrics; no inference of nerve conduction or force |
| Honest degraded modes | Microphone denial allows labeled kinematic-only use | Separate counts; does not satisfy fused-mode release gate |
| Local results/export | Deterministic summary and validated telemetry JSON | No mandatory server, API key, or internet connection after setup |
| Reliability/debugging | Reset, retry, device status, event traces, measured FPS | Bounded queues, owned resources, meaningful error states |
| Synthetic replay | Reproducible fixture-driven exercise | Clearly labeled; never represented as live camera evidence |

## P1 — Presentation and optional reporting

Replace generic controls with a coherent setup/workstation/results experience after both core modes work. Preserve the controller and math/DSP boundaries. Add accessible status, legible target feedback, and useful charts only where they clarify real measurements.

An optional SOAP-style draft may summarize telemetry through a protected server adapter. Local summaries remain available without it. No guaranteed insurance coverage, CPT billing suggestions, automatic treatment prescriptions, or claims that strict JSON prevents hallucinations. A report is a draft for review, not clinical documentation validated for use.

## P2 — Deferred experiments

Ghost-hand comparison, hand-local bimanual mirroring, and exploratory oscillation visualization are explicitly outside the hackathon completion gate. Each needs its own scoped design/test pass after release; see design section 7. They do not establish submillimeter accuracy, neurological diagnoses, or safe therapeutic targets.

## Scope cuts when time is short

Keep one hand, index PIP, one air-target sequence, one desk ring, and one dependable laptop/browser configuration. Cut AI reporting, historical charts, multi-pad desk games, extra fingers, and all P2 features before reducing testing of CV and fused tapping. Keep setup and results functional even if visual polish remains minimal.
