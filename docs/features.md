## Medical & Clinical Features

* **Live Digital Goniometry & Joint Measurement:** Replaces manual plastic protractors by instantly measuring the exact flexion and extension angles (in degrees) of the PIP, DIP, and MCP finger joints during exercises to track recovery from surgery or stroke.
* *Powered by: 60 FPS 3D Skeletal Tracking Engine*


* **Compensatory Cheat Prevention:** Clinically enforces proper exercise form. If a patient with stiff fingers unconsciously attempts to hike their wrist or lean their arm to complete a finger stretch, the system rejects the repetition.
* *Powered by: Vector Deviation Guardrail Algorithm*


* **Adaptive Range-of-Motion (ROM) Exercises:** Provides dynamic, targeted physical therapy stretches. As the patient's joints become more flexible week-over-week, the prescribed stretches automatically scale in difficulty to prevent scar tissue contracture.
* *Powered by: Spatial "Holo" Target Collider*


* **Neurological Motor Fatigue & Rhythm Testing:** Digitizes the standard clinical "Rapid Finger Tapping Test." It quantifies motor cortex speed, nerve conduction recovery, and muscular fatigue over a 15-second interval.
* *Powered by: Vibro-Acoustic Desk Tap Sensor Fusion*


* **Insurance-Compliant SOAP Notes:** Eliminates manual clinical documentation by automatically generating objective medical reports equipped with justified CPT billing codes (e.g., CPT 97110 for therapeutic exercise) to ensure continuous insurance coverage.
* *Powered by: JSON-to-LLM Telemetry Pipeline*


* **Real-Time Biofeedback & Progression Tracking:** Motivates patients by letting them visually race against their past performance. Patients can physically see their injured hand stretching further than they were able to a week prior.
* *Powered by: "Ghost Hand" Replay Overlay*


* **Patient-Specific Anatomical Calibration:** Eliminates the need for a therapist to manually set baseline goals. The system uses the patient's own healthy hand to set the biological standard for their injured hand.
* *Powered by: X-Axis Coordinate Mirroring*


* **Postural Tremor Quantification:** Clinically measures resting or postural nerve tremors (common in early Parkinson's or neurological recovery) down to sub-millimeter oscillations.
* *Powered by: FFT Micro-Oscillation Analyzer*



---

## Technical & Architectural Features

* **60 FPS 3D Skeletal Tracking Engine:** A fully client-side implementation of `@mediapipe/tasks-vision` that extracts 21 3D spatial coordinates (`x, y, z`) from the hand in real-time, executing purely via WebAssembly/WebGL to maintain a Zero-Video-Egress privacy boundary.
* *Drives: Live Digital Goniometry & Joint Measurement*


* **Vector Deviation Guardrail Algorithm:** A deterministic math engine that tracks the biological normal vector of the forearm and wrist. If the angular tilt ($\Delta\theta$) exceeds an 18-degree threshold during a finger-isolation task, the system triggers a state lockout.
* *Drives: Compensatory Cheat Prevention*


* **Spatial "Holo" Target Collider:** An interactive 3D coordinate system that spawns hit-boxes in digital space, requiring the user's index fingertip (`Landmark 8`) to intersect the 3D radius and satisfy a strict `250ms` dwell timer to trigger a successful state change.
* *Drives: Adaptive Range-of-Motion (ROM) Exercises*


* **Vibro-Acoustic Desk Tap Sensor Fusion:** An anti-noise logic gate that correlates visual kinematic data (webcam Y-axis velocity hitting zero) with the Web Audio API (`AnalyserNode`) detecting a transient acoustic RMS spike, verifying physical table impacts without dedicated hardware.
* *Drives: Neurological Motor Fatigue & Rhythm Testing*


* **JSON-to-LLM Telemetry Pipeline:** An orchestrated data flow that aggregates time-series joint angles, tap frequencies, and cheat counts into a strict Zod schema, passing only deterministic numbers to the LLM to prevent hallucinations.
* *Drives: Insurance-Compliant SOAP Notes*


* **"Ghost Hand" Replay Overlay:** A front-end rendering technique that stores a 10-second ring buffer of 21-point landmark arrays in `localStorage` and redraws them as a translucent cyan wireframe anchored dynamically to the user's live wrist position.
* *Drives: Real-Time Biofeedback & Progression Tracking*


* **X-Axis Coordinate Mirroring:** A spatial transformation matrix that captures the peak coordinate extensions of a healthy hand and horizontally flips the vectors ($\Delta x' = -\Delta x$) to generate perfectly mirrored target bounding boxes.
* *Drives: Patient-Specific Anatomical Calibration*


* **FFT Micro-Oscillation Analyzer:** A DSP (Digital Signal Processing) algorithm that tracks the positional variance of a specific landmark over 5 seconds, extracting 4–12 Hz jitter amplitudes to quantify structural stability.
* *Drives: Postural Tremor Quantification*