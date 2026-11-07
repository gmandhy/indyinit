# HoloRehab — System Architecture & Engineering Specification (`design.md`)

## 1. Executive Summary & Judging Alignment
**HoloRehab** transforms any standard laptop into a multi-sensor hand physical therapy and remote therapeutic monitoring (RTM) station.
- **Problem:** 70% of hand therapy patients fail home regimens because they cannot measure 2–3° range-of-motion (ROM) gains, unconsciously "cheat" stiff finger movements by tilting their wrist, and lack objective telemetry required for insurance coverage.
- **Solution:** Combines 60 FPS 3D skeletal hand tracking (`@mediapipe/tasks-vision`), deterministic vector trigonometry, and **vibro-acoustic desk-tapping sensor fusion** (correlating camera kinematics with Web Audio API microphone impulse waveforms) to guide exercises, reject compensatory cheats in real time, and generate CPT-coded clinical SOAP reports.
- **Indy Init Rubric Alignment:**
  - *Working App & Interactivity:* Judges test mid-air spatial targets and physical table-tapping live at the table in under 60 seconds.
  - *Software Factory & Engineering Quality:* Deterministic unit test suite (`vitest`) verifying 3D vector trigonometry and acoustic impulse correlation, strict `zod` contract boundaries, zero-video-egress HIPAA-safe architecture, and a live observability HUD (FPS, frame latency, token cost).

---

## 2. System Architecture & Directory Structure

```text
src/
├── app/
│   ├── page.tsx                  # Main split-screen Workstation + Clinical Dashboard
│   └── api/
│       └── clinical-soap/
│           └── route.ts          # Zod-validated LLM endpoint for SOAP note & adaptive targets
├── components/
│   ├── canvas/
│   │   ├── RehabViewport.tsx     # Webcam + 60FPS HTML5 Canvas overlay + Spatial Targets
│   │   └── GhostHandRenderer.ts  # Pure canvas drawing utilities (skeleton, heat-shader, ghost hand)
│   ├── dashboard/
│   │   ├── LiveGoniometerHUD.tsx # Real-time joint angle gauges & cheat warning banner
│   │   ├── TelemetryCharts.tsx   # Recharts: Baseline vs Current ROM & Tap Frequency Decay
│   │   ├── SoapNotePanel.tsx     # Generated clinical report + CPT billing codes + adaptive prescription
│   │   └── FactoryHudDrawer.tsx  # Observability HUD: FPS, latency, test suite status, token cost
├── lib/
│   ├── mediapipe.ts              # Singleton HandLandmarker WASM initializer
│   ├── biomechanics.ts           # Pure 3D vector math, joint angles, palm calibration, wrist cheat detection
│   ├── spatialTargets.ts         # Spatial button collider, dwell timer, bimanual mirroring transform
│   ├── acousticTap.ts            # Web Audio API AnalyserNode + Visual Y-velocity cross-correlation
│   ├── schemas.ts                # Zod schemas for telemetry, spatial targets, and SOAP reports
│   └── __tests__/
│       ├── biomechanics.test.ts  # Deterministic unit tests for 3D goniometry & cheat detection
│       └── acousticTap.test.ts   # Unit tests for visual-acoustic cross-correlation gate
```

### MediaPipe Initialization Contract (`src/lib/mediapipe.ts`)
Use the official Google AI Edge CDN paths to avoid local WASM bundling issues:
```typescript
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(
    "[https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm](https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm)"
  );
  return await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "[https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task)",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
}
```

---

## 3. Biomechanical Math & 3D Goniometry Engine (`src/lib/biomechanics.ts`)

### 3.1 MediaPipe 21 Hand Landmark Topology
Every frame returns an array of 21 3D landmarks (`{ x, y, z }`). Precondition check: if `landmarks.length !== 21`, throw an explicit `InvalidLandmarkArrayError`.
- `0`: WRIST
- `1..4`: THUMB (`1`: CMC, `2`: MCP, `3`: IP, `4`: TIP)
- `5..8`: INDEX (`5`: MCP, `6`: PIP, `7`: DIP, `8`: TIP)
- `9..12`: MIDDLE (`9`: MCP, `10`: PIP, `11`: DIP, `12`: TIP)
- `13..16`: RING (`13`: MCP, `14`: PIP, `15`: DIP, `16`: TIP)
- `17..20`: PINKY (`17`: MCP, `18`: PIP, `19`: DIP, `20`: TIP)

### 3.2 Anthropometric Hand Size Calibration (`PalmUnit`)
To make spatial targets independent of camera distance or hand size:
- Compute the Euclidean distance between `WRIST (0)` and `MIDDLE_MCP (9)`:
  $$L_{\text{palm}} = \sqrt{(x_9 - x_0)^2 + (y_9 - y_0)^2 + (z_9 - z_0)^2}$$
- Store $L_{\text{palm}}$ during the 3-second calibration phase as `1.0 PalmUnit`. If $L_{\text{palm}} \le 0.01$, throw a precondition error (`CalibrationError: Hand too far or invalid coordinates`).

### 3.3 3D Joint Flexion/Extension Angle Formula
Given three consecutive landmarks $A$ (proximal bone), $B$ (joint vertex), and $C$ (distal bone):
1. Construct vectors originating from the vertex $B$:
   $$\vec{u} = \langle A_x - B_x, A_y - B_y, A_z - B_z \rangle$$
   $$\vec{v} = \langle C_x - B_x, C_y - B_y, C_z - B_z \rangle$$
2. Calculate magnitudes $\Vert{}\vec{u}\Vert{}$ and $\Vert{}\vec{v}\Vert{}$. If either magnitude is less than $10^{-6}$, throw `ZeroLengthBoneVectorError`.
3. Clamp the normalized dot product to $[-1, 1]$ to prevent `Math.acos` `NaN` errors from floating-point drift:
   $$\cos\theta = \max\left(-1, \min\left(1, \frac{\vec{u} \cdot \vec{v}}{\Vert{}\vec{u}\Vert{} \Vert{}\vec{v}\Vert{}}\right)\right)$$
4. Convert interior angle $\theta_{\text{int}} = \arccos(\cos\theta) \times \frac{180}{\pi}$ into clinical **Flexion Degrees** (where a straight extended finger is $0^\circ$ flexion and a bent knuckle is $90^\circ$ flexion):
   $$\theta_{\text{flexion}} = 180^\circ - \theta_{\text{int}}$$

### 3.4 Key Clinical Angles Tracked
- **Index PIP Flexion:** Vertex `6` (`Landmarks 5 -> 6 -> 7`)
- **Index MCP Flexion:** Vertex `5` (`Landmarks 0 -> 5 -> 6`)
- **Composite Finger Flexion:** Mean flexion across MCP, PIP, and DIP of the target finger.
- **Kapandji Thumb Opposition Ratio:** Euclidean 3D distance between `THUMB_TIP (4)` and `PINKY_MCP (17)` divided by $L_{\text{palm}}$.

### 3.5 Exponential Moving Average (EMA) Smoother
Apply EMA smoothing ($\alpha = 0.35$) to computed angles so UI gauges remain rock-steady:
$$S_t = \alpha \cdot Y_t + (1 - \alpha) \cdot S_{t-1}$$

### 3.6 Compensatory "Wrist Cheat" Detection Guardrail
Patients with stiff finger joints unconsciously tilt or hike their wrist to reach spatial targets.
- During calibration, record the baseline neutral unit vector of the palm axis $\vec{W}_{\text{base}}$ from `WRIST (0)` to `MIDDLE_MCP (9)`, and the lateral palm vector $\vec{P}_{\text{base}}$ from `INDEX_MCP (5)` to `PINKY_MCP (17)`.
- On every frame during a finger-isolation exercise, compute the angular deviation $\Delta\theta_{\text{wrist}}$ between $\vec{W}_{\text{current}}$ and $\vec{W}_{\text{base}}$:
  $$\Delta\theta_{\text{wrist}} = \arccos\left(\vec{W}_{\text{current}} \cdot \vec{W}_{\text{base}}\right) \times \frac{180}{\pi}$$
- **Guardrail Rule:** If $\Delta\theta_{\text{wrist}} > 18^\circ$ while attempting to trigger a spatial finger target:
  1. Flag `isWristCompensating = true`.
  2. Lock spatial target progression (rep cannot be completed while cheating).
  3. Render red warning vector on the wrist and increment `wristCheatCount`.

---

## 4. Spatial "Holo" Target Engine & Mechanics (`src/lib/spatialTargets.ts`)

### 4.1 Spatial Button Collider & Dwell Mechanic
- Each spatial target is defined in normalized canvas coordinates:
  `{ id: string, x: number, y: number, radiusPalmUnits: number, requiredFingerBookmark: number, dwellMs: number }`.
- **Hit Detection:**
  1. Calculate 2D canvas distance $d = \sqrt{(x_{\text{finger}} - x_{\text{target}})^2 + (y_{\text{finger}} - y_{\text{target}})^2}$.
  2. Convert target radius to screen space: $R_{\text{screen}} = \text{radiusPalmUnits} \times L_{\text{palm}}$.
  3. Check condition: $d \le R_{\text{screen}}$ AND `!isWristCompensating`.
  4. **Dwell Timer:** The user must hold the fingertip inside the target ring for `dwellMs` (default `250ms`) to complete the rep. Draw a circular SVG/Canvas progress arc around the target ring as dwell time accumulates.

### 4.2 Exercise Mode 1: Spatial Tendon Gliding & ROM Arc (Air Mode)
- Spawns a sequence of 3–4 holographic targets along an extension/opposition arc anchored relative to `WRIST (0)` so minor whole-arm drift doesn't misalign the exercise, while still requiring true finger extension and thumb opposition to hit the outer nodes.

---

## 5. Vibro-Acoustic "Desk Tap" Sensor Fusion (`src/lib/acousticTap.ts`)

### 5.1 Clinical Purpose
Measures motor cortex speed, nerve conduction recovery, and muscular fatigue via a 15-second **Rapid Finger Tapping Test** on the physical table surface.

### 5.2 Dual-Sensor Cross-Correlation Algorithm (Anti-Noise Architecture)
Hackathon venues are noisy. Relying on the microphone alone triggers false taps from voices; relying on the webcam alone cannot measure impact intensity or exact surface contact.
1. **Visual Kinematic Gate (Webcam):**
   - Track vertical velocity $v_y(t) = \frac{y_8(t) - y_8(t - \Delta t)}{\Delta t}$ of `INDEX_TIP (8)`.
   - Detect a downward strike trajectory followed by a visual floor inflection point (where `INDEX_TIP` reaches local maximum $y$ near the desk plane and $\lvert v_y(t) \rvert$ drops toward zero) while `WRIST (0)` remains stationary ($\lvert v_{y,0} \rvert < \epsilon$).
   - Open a **`80ms` Visual Strike Window** (`visualStrikeWindowOpenUntil = performance.now() + 80`).
2. **Acoustic Impulse Detector (Web Audio API):**
   - Initialize `AudioContext` and `AnalyserNode` (`fftSize = 512`, `smoothingTimeConstant = 0.1`).
   - Compute instantaneous Root Mean Square (RMS) energy from time-domain PCM samples $s_i \in [-1, 1]$:
     $$\text{RMS}(t) = \sqrt{\frac{1}{N}\sum_{i=1}^{N} s_i^2}$$
   - Maintain a rolling background noise floor $\mu_{\text{noise}}$ (EMA with $\alpha = 0.02$).
   - Detect an acoustic impulse peak when $\text{RMS}(t) > \max(0.04, 3.0 \times \mu_{\text{noise}})$ with a refractory cooldown of `90ms` between taps.
3. **Sensor Fusion Verification:**
   - A tap is recorded as a **Verified Vibro-Acoustic Tap** if and only if an Acoustic Impulse Peak occurs while `performance.now() <= visualStrikeWindowOpenUntil` (or within $\pm 45\text{ms}$ of visual nadir).
   - If the microphone permission is denied or unavailable, fail gracefully to **Kinematic-Only Tap Mode** with an explicit status badge in the UI.

### 5.3 Extracted Desk-Tap Telemetry Metrics
- **Tap Frequency (Hz):** Total verified taps divided by duration (`15s`).
- **Fatigue Decay Index (%):** Percentage change in tap frequency between the first 5 seconds ($f_{0\text{--}5}$) and the final 5 seconds ($f_{10\text{--}15}$):
  $$\text{FatigueDecay} = \left(\frac{f_{10\text{--}15} - f_{0\text{--}5}}{f_{0\text{--}5}}\right) \times 100$$
- **Impact Intensity Consistency:** Mean and normalized standard deviation of peak acoustic RMS values across all verified taps.
- **Rhythm Jitter (ms):** Standard deviation of inter-tap intervals ($\Delta t_k = t_k - t_{k-1}$).

---

## 6. Data Schemas & AI Clinical Pipeline (`src/lib/schemas.ts`)

All communication between the client telemetry engine and the AI Clinical SOAP Generator MUST pass through these exact `zod` schemas:

```typescript
import { z } from "zod";

export const SessionTelemetrySchema = z.object({
  sessionId: z.string(),
  exerciseType: z.enum(["SPATIAL_ROM_ARC", "VIBRO_ACOUSTIC_DESK_TAP", "THUMB_OPPOSITION"]),
  durationSeconds: z.number().positive(),
  palmUnitBaseline: z.number().positive(),
  romMetrics: z.object({
    maxIndexPipExtensionDeg: z.number(),
    meanFlexionAngleDeg: z.number(),
    baselineMaxExtensionDeg: z.number(),
    improvementDeltaDeg: z.number(),
  }),
  tapMetrics: z.object({
    totalVerifiedTaps: z.number().int().nonnegative(),
    frequencyHz: z.number().nonnegative(),
    earlyWindowHz: z.number().nonnegative(),
    lateWindowHz: z.number().nonnegative(),
    fatigueDecayPct: z.number(),
    meanAcousticRms: z.number().nonnegative(),
    rhythmJitterMs: z.number().nonnegative(),
  }).optional(),
  qualityGuardrails: z.object({
    totalAttempts: z.number().int().nonnegative(),
    wristCheatCount: z.number().int().nonnegative(),
    maxWristDeviationDeg: z.number().nonnegative(),
    compensationRatePct: z.number().min(0).max(100),
  }),
});

export const ClinicalSoapResponseSchema = z.object({
  soapNote: z.object({
    subjective: z.string(),
    objective: z.string(),
    assessment: z.string(),
    plan: z.string(),
  }),
  cptCodes: z.array(
    z.object({
      code: z.enum(["97110", "97530", "98977"]),
      description: z.string(),
      clinicalJustification: z.string(),
    })
  ),
  adaptivePrescription: z.object({
    difficultyMultiplier: z.number().min(0.8).max(1.25),
    coachingCue: z.string(),
    nextSpatialTargets: z.array(
      z.object({
        id: z.string(),
        offsetXPalmUnits: z.number(),
        offsetYPalmUnits: z.number(),
        radiusPalmUnits: z.number(),
        dwellMs: z.number(),
      })
    ),
  }),
});
```

---

## 7. Prioritized Build Roadmap & Stretch Mechanics

### P0 — Core Vision, Math & Spatial Targets (Complete First)
1. `src/lib/biomechanics.ts` + `src/lib/__tests__/biomechanics.test.ts` (100% passing unit tests for `calculateJointAngle3D`, `computePalmUnit`, and `detectWristCompensation`).
2. `RehabViewport.tsx`: 60 FPS webcam + canvas skeleton renderer + Tendon Tension Heat Shader (interpolating bone segment stroke color from `#3b82f6` blue -> `#10b981` green -> `#ef4444` red based on joint angle and wrist compensation).
3. Spatial target loop with dwell progress arcs and real-time red lockouts when `isWristCompensating === true`.

### P1 — Vibro-Acoustic Desk Tap + AI Clinical SOAP Pipeline (Complete Second)
1. `src/lib/acousticTap.ts` + `src/lib/__tests__/acousticTap.test.ts` (unit-tested visual + audio spike cross-correlation).
2. Live waveform/impulse bar at the bottom of the viewport during Desk Tap mode + live Hz / Fatigue Decay counters.
3. `/api/clinical-soap/route.ts` + `SoapNotePanel.tsx` + `TelemetryCharts.tsx` comparing current session against a stored baseline profile.
4. `FactoryHudDrawer.tsx`: Bottom bar displaying live FPS, frame inference time (`ms`), Zero-Video-Egress security badge, and unit test verification status.

### P2 — High-Impact Creative Stretch Mechanics (Implement Once P0 & P1 Pass)
1. **"Ghost Hand" Baseline Replay Overlay (`GhostHandRenderer.ts`):**
   - Store a 10-second ring buffer of normalized 21-point landmarks (`Landmark[][]`) from the baseline session in `localStorage`.
   - During active exercises, render the baseline recording at the corresponding timestamp as a translucent cyan wireframe (`rgba(6, 182, 212, 0.35)`) anchored to the user's current `WRIST (0)` position so the user visually races and stretches past their own historical "Ghost Hand."
2. **Bimanual "Healthy Hand Mirroring" Auto-Calibration:**
   - User holds up their healthy hand for 5 seconds and performs a full stretch.
   - Capture peak landmark positions relative to `WRIST (0)`, mirror across the X-axis ($\Delta x' = -\Delta x$), and automatically spawn the injured hand's spatial targets at those exact anatomical coordinates.
3. **Postural Nerve Tremor Micro-Oscillation Analyzer:**
   - 5-second "Hold Still in the Ring" mode that measures positional variance and $4\text{--}12\text{ Hz}$ jitter of `INDEX_TIP (8)` in millimeters (normalized via `PalmUnit`) to quantify resting/postural tremor.