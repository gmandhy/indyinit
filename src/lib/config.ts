/** Boundary limits. Rates are compared with 1e-6 tolerance. */
export const LIMITS = Object.freeze({ maxCount: 1_000_000, maxDurationSeconds: 3600, maxTelemetryBytes: 16_384, snapshotIntervalMs: 100, numericTolerance: 1e-6 });
export const CONFIG_REVISION = 'fusion-5';
/** All interaction thresholds are provisional demo defaults, requiring hardware validation. */
export const MATH_CONFIG = Object.freeze({ vectorEpsilonMeters:1e-6, vectorEpsilonPixels:1e-6, unitTolerance:1e-6 });
export const DISPLAY_CONFIG = Object.freeze({ tauMs:80, resetGapMs:150 });
export const ORIENTATION_CONFIG = Object.freeze({ lockAboveDeg:18, unlockBelowDeg:14 });
export const FRAME_CONFIG = Object.freeze({ maxAgeMs:120, maxGapMs:120 });
export const CALIBRATION_CONFIG = Object.freeze({
  durationMs:3000, minSamples:45, maxBufferedSamples:600, minPalmPixels:40,
  maxScaleVariationRatio:.12, maxWristDriftPalmUnits:.2, maxOrientationDeviationDeg:8,
  maxOpenFlexionDeg:20, minHandConfidence:.6, maxAgeMs:FRAME_CONFIG.maxAgeMs, maxGapMs:FRAME_CONFIG.maxGapMs,
});
export const AIR_CONFIG = Object.freeze({ dwellMs:250, maxScaleChangeRatio:.25, maxReachPalmUnits:3 });
export const SESSION_CONFIG = Object.freeze({ countdownMs:3000, trialMs:15000, deliveryGraceMs:250 });
/** Presentation only; never used by contact eligibility or scoring. */
export const TARGET_FEEDBACK_CONFIG = Object.freeze({ candidateHighlightMs:150 });
/** Relative full-scale RMS; onset timestamps, not peak/arrival times. Provisional hardware defaults.
 * Lateness bounds transport independently of the coincidence tolerance. */
export const AUDIO_CONFIG = Object.freeze({ windowMs:10, quietMs:1500, minThresholdRms:.04,
  noiseMultiplier:3, releaseRatio:.6, refractoryMs:90, maxImpulseMs:120,
  noiseTauMs:3000, maxNoiseRms:.08, clipMagnitude:.999, meterIntervalMs:100, maxClockDriftMs:50 });
export const FUSION_CONFIG = Object.freeze({ toleranceMs:80, deliveryLatenessMs:250,
  maxQueue:64, maxSeen:512, minPairs:3, maxPairs:5, minPairSpacingMs:600,
  maxOffsetMs:1000, maxResidualMs:40 });
/** Source-image desk thresholds, provisional until the oblique-camera hardware gate.
 * Pixel floors prevent accepting subpixel/noisy lifts. Ratios are palm-normalized.
 * Speed limits apply to capture-time differences, never render or delivery time. */
export const DESK_CONFIG = Object.freeze({
  ringRadiusPalmUnits:.35, restDurationMs:500, restMinSamples:8, maxBufferedSamples:180,
  minCycles:3, maxCycles:5, minCycleMs:200, maxCycleMs:5000, endpointSamples:3,
  minExcursionPixels:8, minExcursionPalmUnits:.12, maxContactSpreadPalmUnits:.10,
  restNoisePixels:3, restNoisePalmUnits:.04, contactMarginPixels:2,
  maxAxisDeviationDeg:25, maxGeometryAxisDeviationDeg:25, maxWristDriftPalmUnits:.25, minWristSpeedTolerance:.25,
  maxWristSpeedTolerance:1.5, wristSpeedMargin:.15,
  releaseExcursionRatio:.55, contactExitMarginPixels:2,
  minDescendingPalmUnitsPerSecond:.15, extremumSpeedPalmUnitsPerSecond:.08,
  maxConfirmationMs:120,
});

/** Rationale: 120 ms freshness/gap is a provisional inference-age budget; missing
 * observations cannot bridge dwell. Display smoothing may reset independently at
 * 150 ms. Calibration allows 12% scale variation and 0.2 palm units of image wrist
 * drift, with <=20° finger bends and <=8° world/image axis variation. The 40 px
 * minimum avoids accepting tiny projected palms. A 25% post-calibration scale
 * change invalidates the setup. None of these values establishes clinical accuracy.
 */

/** Initial camera size is an ideal constraint. Worker CPU fallback is capped at 20 Hz,
 * visibly below the >=24 Hz demo gate until measured/tuned. Timeouts are failure/
 * teardown deadlines, never artificial inference pacing or success criteria. */
export const VISION_CONFIG = Object.freeze({ widthPixels:640, heightPixels:480, confidence:.6, cpuMinIntervalMs:50, startupDeadlineMs:30000, resultDeadlineMs:5000, shutdownDeadlineMs:1000, measurementWindowMs:60000 });
