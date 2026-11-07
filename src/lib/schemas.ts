import { z } from 'zod';
import { LIMITS } from './config';
const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const positive = finite.positive();
const count = z.number().int().min(0).max(LIMITS.maxCount);
const angle = finite.min(0).max(180);
const ratio = finite.min(0).max(1);
const time = nonnegative;
const hand = z.enum(['Left', 'Right']);
const vector = z.strictObject({ x: finite, y: finite, z: finite });
export const ImageLandmarkSchema = vector.brand<'ImageLandmark'>();
export const WorldLandmarkSchema = vector.brand<'WorldLandmark'>();
export type ImageLandmark = z.infer<typeof ImageLandmarkSchema>;
export type WorldLandmark = z.infer<typeof WorldLandmarkSchema>;
const frameBase = { sequence: count, captureTimeMs: time, selectedHand: hand };
export const FrameSampleSchema = z.discriminatedUnion('validity', [
  z.strictObject({ ...frameBase, validity: z.literal('valid'), imageLandmarks: z.array(ImageLandmarkSchema).length(21), worldLandmarks: z.array(WorldLandmarkSchema).length(21), handedness: z.strictObject({ label: hand, confidence: ratio }) }),
  z.strictObject({ ...frameBase, validity: z.literal('absent'), reason: z.literal('no_hand') }),
  z.strictObject({ ...frameBase, validity: z.literal('invalid'), reason: z.enum(['nonfinite', 'malformed', 'stale', 'tracking_lost']) }),
]);
export type FrameSample = z.infer<typeof FrameSampleSchema>;
export const AudioImpulseSchema = z.strictObject({ sequence: count, sampleTimeMs: time, rms: ratio });
export type AudioImpulse = z.infer<typeof AudioImpulseSchema>;
const unitVector = vector.refine(v => near(v.x*v.x + v.y*v.y + v.z*v.z, 1), 'Expected unit vector');
const basis = z.strictObject({ longitudinal: unitVector, transverse: unitVector, normal: unitVector }).refine(b => {
  const a = b.longitudinal, c = b.transverse, n = b.normal;
  return near(a.x*c.x+a.y*c.y+a.z*c.z, 0) && near(a.y*c.z-a.z*c.y,n.x) && near(a.z*c.x-a.x*c.z,n.y) && near(a.x*c.y-a.y*c.x,n.z);
}, 'Expected right-handed orthonormal palm basis');
const pixelPoint = z.strictObject({ x: nonnegative, y: nonnegative });
const desk = z.strictObject({
  region: z.strictObject({ center: pixelPoint, radiusPixels: positive }), rest: pixelPoint, wristRest: pixelPoint,
  contactDirection: z.strictObject({ x: finite, y: finite }).refine(v => near(v.x*v.x+v.y*v.y,1), 'Expected unit direction'),
  contactBand: z.strictObject({ minPalmUnits: finite, maxPalmUnits: finite }).refine(v => v.maxPalmUnits > v.minPalmUnits, 'Empty contact band'),
  excursionPalmUnits: positive, wristTolerancePalmUnitsPerSecond: positive,
});
const imageAxis = z.strictObject({ x: finite, y: finite }).refine(v => near(v.x*v.x+v.y*v.y,1), 'Expected image unit axis');
const imageBasis = z.strictObject({ longitudinal:imageAxis, transverse:imageAxis }).refine(b => near(b.longitudinal.x*b.transverse.x+b.longitudinal.y*b.transverse.y,0), 'Expected orthogonal image basis');
const calibrationBase = { imageBasis, hand, video: z.strictObject({ width: z.number().int().positive().max(16384), height: z.number().int().positive().max(16384) }), palmWorld: positive, palmPixels: positive, palmBasis: basis, configurationRevision: z.string().min(1).max(64) };
export const CalibrationSchema = z.discriminatedUnion('sensorMode', [
  z.strictObject({ ...calibrationBase, exercise: z.literal('air_targets'), sensorMode: z.literal('vision_only') }),
  z.strictObject({ ...calibrationBase, exercise: z.literal('desk_tap'), sensorMode: z.literal('kinematic_only'), desk }),
  z.strictObject({ ...calibrationBase, exercise: z.literal('desk_tap'), sensorMode: z.literal('fused'), desk, audio: z.strictObject({ offsetMs: finite.min(-1000).max(1000), residualSpreadMs: nonnegative.max(80) }) }),
]).refine(c => {
  if(c.sensorMode==='vision_only')return true;
  const {region:r,rest,wristRest:w,contactBand:b}=c.desk;
  return r.center.x-r.radiusPixels>=0&&r.center.y-r.radiusPixels>=0&&r.center.x+r.radiusPixels<=c.video.width&&r.center.y+r.radiusPixels<=c.video.height
    &&rest.x<=c.video.width&&rest.y<=c.video.height&&w.x<=c.video.width&&w.y<=c.video.height
    &&Math.hypot(rest.x-r.center.x,rest.y-r.center.y)<=r.radiusPixels
    &&b.minPalmUnits<=0&&b.maxPalmUnits>=0&&c.desk.excursionPalmUnits>-b.minPalmUnits;
}, 'Invalid desk geometry/contact band');
export type Calibration = z.infer<typeof CalibrationSchema>;
export const QualitySchema = z.strictObject({
  validFrames: count, totalFrames: count, trackingCoverage: ratio, attempts: count, blockedAttempts: count, lockoutEvents: count,
  maxPalmDeviationDeg: angle.nullable(), compensationPct: finite.min(0).max(100).nullable(), rejectedCandidates: count,
}).superRefine((q, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (q.validFrames > q.totalFrames) fail('validFrames exceeds totalFrames');
  if (!near(q.trackingCoverage, q.totalFrames === 0 ? 0 : q.validFrames/q.totalFrames)) fail('Coverage does not reconcile');
  if (q.blockedAttempts > q.attempts) fail('blockedAttempts exceeds attempts');
  if (q.attempts === 0 ? q.compensationPct !== null : q.compensationPct === null || !near(q.compensationPct,100*q.blockedAttempts/q.attempts)) fail('Compensation percentage does not reconcile');
});
const airMetrics = z.strictObject({
  completedReps: count, minPipFlexionDeg: angle.nullable(), maxPipFlexionDeg: angle.nullable(), meanPipFlexionDeg: angle.nullable(), romDeg: angle.nullable(),
  // A comparison is allowed only with explicit compatible calibration context.
  baselineComparison: z.strictObject({ hand, sensorMode: z.literal('vision_only'), configurationRevision: z.string().min(1).max(64), baselineMinPipFlexionDeg: angle, extensionDeficitDecreaseDeg: finite.min(-180).max(180) }).nullable(),
}).superRefine((m, ctx) => {
  const values = [m.minPipFlexionDeg,m.maxPipFlexionDeg,m.meanPipFlexionDeg,m.romDeg];
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (values.some(v => v === null) && !values.every(v => v === null)) fail('PIP statistics must be all null or all measured');
  if (m.minPipFlexionDeg !== null && m.maxPipFlexionDeg !== null && m.meanPipFlexionDeg !== null && m.romDeg !== null) {
    if (m.maxPipFlexionDeg < m.minPipFlexionDeg || m.meanPipFlexionDeg < m.minPipFlexionDeg || m.meanPipFlexionDeg > m.maxPipFlexionDeg || !near(m.romDeg,m.maxPipFlexionDeg-m.minPipFlexionDeg)) fail('Inconsistent PIP extrema/mean/ROM');
  }
  if (m.baselineComparison !== null && (m.minPipFlexionDeg === null || !near(m.baselineComparison.extensionDeficitDecreaseDeg, m.baselineComparison.baselineMinPipFlexionDeg-m.minPipFlexionDeg))) fail('Baseline decrease does not reconcile');
});
const deskMetrics = z.strictObject({ acceptedTapCount: count, verifiedTapCount: count, kinematicTapCount: count, frequencyHz: nonnegative, earlyHz: nonnegative.nullable(), lateHz: nonnegative.nullable(), rateChangePct: finite.nullable(), rhythmJitterMs: nonnegative.nullable(), meanAcousticRms: ratio.nullable(), acousticCv: nonnegative.nullable() });
const telemetryBase = { hand, configurationRevision: z.string().min(1).max(64), schemaVersion: z.literal(1), sessionId: z.uuid(), source: z.enum(['live','synthetic_replay']), status: z.enum(['completed','aborted']), durationSeconds: positive.max(LIMITS.maxDurationSeconds), quality: QualitySchema };
export const SessionTelemetrySchema = z.discriminatedUnion('exercise', [
  z.strictObject({ ...telemetryBase, exercise: z.literal('air_targets'), sensorMode: z.literal('vision_only'), metrics: airMetrics }),
  z.strictObject({ ...telemetryBase, exercise: z.literal('desk_tap'), sensorMode: z.enum(['fused','kinematic_only']), metrics: deskMetrics }),
]).superRefine((t, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (t.exercise === 'air_targets') {
    if (t.metrics.baselineComparison && (t.metrics.baselineComparison.hand !== t.hand || t.metrics.baselineComparison.configurationRevision !== t.configurationRevision)) fail('Baseline context is incompatible');
    if (t.metrics.completedReps > t.quality.attempts-t.quality.blockedAttempts) fail('Reps exceed unblocked attempts');
    return;
  }
  const m = t.metrics;
  if (t.sensorMode === 'fused' ? m.acceptedTapCount !== m.verifiedTapCount || m.kinematicTapCount !== 0 : m.acceptedTapCount !== m.kinematicTapCount || m.verifiedTapCount !== 0 || m.meanAcousticRms !== null || m.acousticCv !== null) fail('Counts/audio disagree with sensor mode');
  if (!near(m.frequencyHz,m.acceptedTapCount/t.durationSeconds)) fail('Frequency does not reconcile');
  if (m.acceptedTapCount < 3 && m.rhythmJitterMs !== null) fail('Rhythm requires at least three taps');
  if (m.acceptedTapCount === 0 && (m.meanAcousticRms !== null || m.acousticCv !== null)) fail('No acoustic statistics without taps');
  if ((m.meanAcousticRms === null || m.meanAcousticRms === 0) && m.acousticCv !== null) fail('Acoustic CV requires a positive measured mean');
  if (t.status === 'aborted') {
    if (m.earlyHz !== null || m.lateHz !== null || m.rateChangePct !== null) fail('Aborted trial has no early/late comparison');
  } else {
    if (!near(t.durationSeconds,15)) fail('Completed desk trial must last 15 seconds');
    if (m.earlyHz === null || m.lateHz === null) fail('Completed trial requires early/late rates');
    else {
      const early = m.earlyHz*5, late = m.lateHz*5;
      if (!near(early,Math.round(early)) || !near(late,Math.round(late)) || early+late > m.acceptedTapCount+LIMITS.numericTolerance) fail('Window rates do not reconcile with counts');
      if (m.earlyHz === 0 ? m.rateChangePct !== null : m.rateChangePct === null || !near(m.rateChangePct,100*(m.lateHz-m.earlyHz)/m.earlyHz)) fail('Rate change does not reconcile');
    }
  }
});
export type SessionTelemetry = z.infer<typeof SessionTelemetrySchema>;
/** Use at JSON boundaries: size-check before parsing; nested strict objects reject media and landmarks. */
export function parseTelemetryJson(json: string): SessionTelemetry {
  if (new TextEncoder().encode(json).byteLength > LIMITS.maxTelemetryBytes) throw new Error('Telemetry exceeds byte limit');
  return SessionTelemetrySchema.parse(JSON.parse(json) as unknown);
}
function near(a: number, b: number): boolean { return Math.abs(a-b) <= LIMITS.numericTolerance; }
