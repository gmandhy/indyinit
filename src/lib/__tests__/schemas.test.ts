import { describe, expect, it } from 'vitest';
import { AudioImpulseSchema, CalibrationSchema, FrameSampleSchema, SessionTelemetrySchema, parseTelemetryJson } from '../schemas';
import { LIMITS } from '../config';
import { syntheticFrames } from '../../../fixtures/syntheticHand';
const quality = { validFrames: 80, totalFrames: 100, trackingCoverage: .8, attempts: 4, blockedAttempts: 1, lockoutEvents: 1, maxPalmDeviationDeg: 20, compensationPct: 25, rejectedCandidates: 0 };
const base = { schemaVersion: 1, sessionId: 'ac639b41-890c-4f0a-b578-11b0a57997fd', source: 'synthetic_replay', status: 'completed', durationSeconds: 15, quality, hand: 'Right', configurationRevision: 'foundation-1' };
export const air = { ...base, exercise: 'air_targets', sensorMode: 'vision_only', metrics: { completedReps: 2, minPipFlexionDeg: 10, maxPipFlexionDeg: 60, meanPipFlexionDeg: 30, romDeg: 50, baselineComparison: null } };
export const desk = { ...base, exercise: 'desk_tap', sensorMode: 'fused', metrics: { acceptedTapCount: 9, verifiedTapCount: 9, kinematicTapCount: 0, frequencyHz: .6, earlyHz: .8, lateHz: .6, rateChangePct: -25, rhythmJitterMs: 10, meanAcousticRms: .1, acousticCv: .2 } };
function rejects(payload: unknown) { expect(SessionTelemetrySchema.safeParse(payload).success).toBe(false); }
describe('strict telemetry', () => {
  it('accepts air and fused desk and size-checked JSON round trips', () => {
    for (const t of [air,desk]) expect(parseTelemetryJson(JSON.stringify(t))).toEqual(t);
  });
  it('requires a deliberate kinematic mode with distinct counts and no acoustic metrics', () => {
    const k = { ...desk, sensorMode: 'kinematic_only', metrics: { ...desk.metrics, verifiedTapCount: 0, kinematicTapCount: 9, meanAcousticRms: null, acousticCv: null } };
    expect(SessionTelemetrySchema.safeParse(k).success).toBe(true);
    rejects({ ...k, metrics: { ...k.metrics, verifiedTapCount: 1 } });
    rejects({ ...k, metrics: { ...k.metrics, meanAcousticRms: .2 } });
    rejects({ ...air, sensorMode: 'fused' });
    rejects({ ...desk, sensorMode: 'vision_only' });
    rejects({ ...desk, metrics: { ...desk.metrics, kinematicTapCount: 1 } });
  });
  it('enforces completion duration, count-derived rates and five-second windows', () => {
    rejects({ ...desk, durationSeconds: 14 });
    for (const metrics of [ { frequencyHz: 10 }, { earlyHz: .75 }, { lateHz: 2 }, { rateChangePct: 25 }, { rateChangePct: null } ]) rejects({ ...desk, metrics: { ...desk.metrics, ...metrics } });
    expect(SessionTelemetrySchema.safeParse({ ...desk, status: 'aborted', durationSeconds: 10, metrics: { ...desk.metrics, frequencyHz: .9, earlyHz: null, lateHz: null, rateChangePct: null } }).success).toBe(true);
    rejects({ ...desk, status: 'aborted' });
  });
  it('uses null for absent statistics and zero-early-window comparison', () => {
    const empty = { ...desk, metrics: { acceptedTapCount: 0, verifiedTapCount: 0, kinematicTapCount: 0, frequencyHz: 0, earlyHz: 0, lateHz: 0, rateChangePct: null, rhythmJitterMs: null, meanAcousticRms: null, acousticCv: null } };
    expect(SessionTelemetrySchema.safeParse(empty).success).toBe(true);
    rejects({ ...empty, metrics: { ...empty.metrics, rateChangePct: 0 } });
    rejects({ ...empty, metrics: { ...empty.metrics, rhythmJitterMs: 0 } });
    rejects({ ...empty, metrics: { ...empty.metrics, meanAcousticRms: .1 } });
    rejects({ ...desk, metrics: { ...desk.metrics, meanAcousticRms: 0, acousticCv: 0 } });
    expect(SessionTelemetrySchema.safeParse({ ...air, metrics: { ...air.metrics, minPipFlexionDeg: null, maxPipFlexionDeg: null, meanPipFlexionDeg: null, romDeg: null } }).success).toBe(true);
  });
  it('reconciles quality, attempts and coverage', () => {
    for (const patch of [ { validFrames: 101 }, { trackingCoverage: .9 }, { blockedAttempts: 5 }, { attempts: 0, blockedAttempts: 0, compensationPct: 0 }, { compensationPct: 20 }, { totalFrames: 1.2 }, { maxPalmDeviationDeg: 181 } ]) rejects({ ...air, quality: { ...quality, ...patch } });
    rejects({ ...air, metrics: { ...air.metrics, completedReps: 4 } });
  });
  it('rejects inconsistent ROM and incompatible or invented baseline comparisons', () => {
    for (const patch of [ { romDeg: 51 }, { minPipFlexionDeg: 70 }, { meanPipFlexionDeg: 80 }, { romDeg: null } ]) rejects({ ...air, metrics: { ...air.metrics, ...patch } });
    const baseline = { hand: 'Right', sensorMode: 'vision_only', configurationRevision: 'foundation-1', baselineMinPipFlexionDeg: 15, extensionDeficitDecreaseDeg: 5 };
    expect(SessionTelemetrySchema.safeParse({ ...air, metrics: { ...air.metrics, baselineComparison: baseline } }).success).toBe(true);
    for (const patch of [{ hand: 'Left' }, { configurationRevision: 'other' }, { extensionDeficitDecreaseDeg: 6 }]) rejects({ ...air, metrics: { ...air.metrics, baselineComparison: { ...baseline, ...patch } } });
  });
  it('rejects unknown nested keys, media, cross-exercise metrics and hostile values', () => {
    rejects({ ...air, landmarks: [] });
    rejects({ ...air, quality: { ...quality, rawAudio: [] } });
    rejects({ ...air, metrics: { ...air.metrics, acceptedTapCount: 1 } });
    rejects({ ...desk, metrics: { ...desk.metrics, minPipFlexionDeg: null } });
    for (const durationSeconds of [0, -1, NaN, Infinity, LIMITS.maxDurationSeconds+1]) rejects({ ...air, durationSeconds });
    for (const acceptedTapCount of [-1, .5, Infinity, LIMITS.maxCount+1]) rejects({ ...desk, metrics: { ...desk.metrics, acceptedTapCount } });
    rejects({ ...air, sessionId: 'person@example.org' });
    rejects({ ...air, schemaVersion: 2 });
    expect(() => parseTelemetryJson(' '.repeat(LIMITS.maxTelemetryBytes+1))).toThrow('byte limit');
    expect(() => parseTelemetryJson('{broken')).toThrow();
  });
});
describe('local sensor boundaries', () => {
  it('distinguishes exactly 21 image/world points, absent and invalid states', () => {
    for (const frame of syntheticFrames) expect(FrameSampleSchema.safeParse(frame).success).toBe(true);
    const sample = syntheticFrames[0];
    if (sample?.validity !== 'valid') throw new Error('Expected valid fixture');
    expect(FrameSampleSchema.safeParse({ ...sample, imageLandmarks: sample.imageLandmarks.slice(1) }).success).toBe(false);
    expect(FrameSampleSchema.safeParse({ ...sample, worldLandmarks: sample.worldLandmarks.map(p => ({...p,z:NaN})) }).success).toBe(false);
    expect(FrameSampleSchema.safeParse({ sequence: 1, captureTimeMs: 1, selectedHand: 'Right', validity: 'absent', reason: 'no_hand', imageLandmarks: [] }).success).toBe(false);
    expect(FrameSampleSchema.safeParse({ ...sample, captureTimeMs: -1 }).success).toBe(false);
  });
  it('only accepts compact finite timestamped impulses', () => {
    expect(AudioImpulseSchema.parse({sequence:0,sampleTimeMs:1,rms:.2}).rms).toBe(.2);
    for (const patch of [{rms:Infinity},{rms:-1},{sampleTimeMs:-1},{pcm:[]}]) expect(AudioImpulseSchema.safeParse({sequence:0,sampleTimeMs:1,rms:.2,...patch}).success).toBe(false);
  });
  it('requires valid mode-specific calibration, basis, scale, and fused audio alignment', () => {
    const calibration = { imageBasis:{longitudinal:{x:0,y:-1},transverse:{x:1,y:0}}, hand: 'Right', video: {width:640,height:480}, palmWorld:.08, palmPixels:80, palmBasis:{longitudinal:{x:0,y:1,z:0},transverse:{x:1,y:0,z:0},normal:{x:0,y:0,z:-1}}, configurationRevision:'foundation-1', exercise:'air_targets',sensorMode:'vision_only' };
    expect(CalibrationSchema.safeParse(calibration).success).toBe(true);
    for (const patch of [{palmWorld:0},{palmPixels:NaN},{palmBasis:{...calibration.palmBasis,normal:{x:0,y:0,z:1}}},{sensorMode:'fused'},{desk:{}}]) expect(CalibrationSchema.safeParse({...calibration,...patch}).success).toBe(false);
    const deskCalibration = { ...calibration, exercise:'desk_tap', sensorMode:'fused', desk:{region:{center:{x:200,y:200},radiusPixels:30},rest:{x:200,y:200},wristRest:{x:200,y:250},contactDirection:{x:0,y:1},contactBand:{minPalmUnits:-.1,maxPalmUnits:.1},excursionPalmUnits:.2,wristTolerancePalmUnitsPerSecond:1},audio:{offsetMs:20,residualSpreadMs:10} };
    expect(CalibrationSchema.safeParse(deskCalibration).success).toBe(true);
    expect(CalibrationSchema.safeParse({...deskCalibration,audio:undefined}).success).toBe(false);
    expect(CalibrationSchema.safeParse({...deskCalibration,audio:{offsetMs:0,residualSpreadMs:100}}).success).toBe(false);
    expect(CalibrationSchema.safeParse({...deskCalibration,desk:{...deskCalibration.desk,contactDirection:{x:0,y:0}}}).success).toBe(false);
    expect(CalibrationSchema.safeParse({...deskCalibration,desk:{...deskCalibration.desk,rest:{x:900,y:0}}}).success).toBe(false);
  });
});
