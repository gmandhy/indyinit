import { CalibrationSchema, FrameSampleSchema } from './schemas';
import type { Calibration, FrameSample } from './schemas';
import { CALIBRATION_CONFIG, CONFIG_REVISION } from './config';
import { flexionDeg, palmBasis, orientationDeviationDeg, worldDistance } from './biomechanics';
import { imagePalmBasis, imageToPixels, validateSize } from './coordinates';
import type { Size, SourcePixel } from './coordinates';
import { MathInputError, landmarks, median, timeMs, validatePositiveConfig } from './mathValidation';
export type AirCalibration = Extract<Calibration,{exercise:'air_targets'}>;
export type CalibrationReason = 'accepted'|'collecting'|'insufficient_samples'|'no_hand'|'invalid_sample'|'stale'|'hand_changed'|'small_palm'|'occlusion'|'closed_pose'|'unstable_pose'|'tracking_gap';
export interface CalibrationState { readonly status:'collecting'|'valid';readonly reason:CalibrationReason;readonly sampleCount:number;readonly elapsedMs:number;readonly calibration:AirCalibration|null;readonly detail?:string }
export type PalmCalibrationConfig = { [K in keyof typeof CALIBRATION_CONFIG]:number };
export function validateMathFrame(sample:FrameSample):void {
  if(sample.validity==='valid'){landmarks(sample.worldLandmarks,'world');landmarks(sample.imageLandmarks,'image');}
  if(!FrameSampleSchema.safeParse(sample).success)throw new MathInputError('Malformed FrameSample: expected finite landmarks, valid time, sequence and handedness');
}
export function palmObservation(sample:Extract<FrameSample,{validity:'valid'}>,video:Size) {
  validateMathFrame(sample);validateSize(video);
  const pixels=sample.imageLandmarks.map(p=>imageToPixels(p,video));
  const wrist=pixels[0]!,middle=pixels[9]!;
  const palmWorld=worldDistance(sample.worldLandmarks[9]!,sample.worldLandmarks[0]!);
  if(palmWorld<=0)throw new MathInputError('Degenerate palmWorld (meters)');
  return {sample,palmWorld,palmPixels:Math.hypot(middle.x-wrist.x,middle.y-wrist.y),wrist,
    palmBasis:palmBasis(sample.worldLandmarks),imageBasis:imagePalmBasis(wrist,middle,pixels[5]!,pixels[17]!)};
}
type Observation=ReturnType<typeof palmObservation>;
/** Bounded memory-only window. Calling after success returns the frozen accepted calibration. */
export function createPalmCalibrator(video:Size,overrides:Partial<PalmCalibrationConfig>={},purpose:'open_hand'|'desk_geometry'='open_hand') {
  if(purpose!=='open_hand'&&purpose!=='desk_geometry')throw new MathInputError('Invalid palm calibration purpose');
  validateSize(video);const config={...CALIBRATION_CONFIG,...overrides};validatePositiveConfig(config);
  if(!Number.isInteger(config.minSamples)||!Number.isInteger(config.maxBufferedSamples)||config.maxBufferedSamples<config.minSamples||config.minHandConfidence>1||config.maxOpenFlexionDeg>180)throw new MathInputError('Invalid palm calibration configuration');
  let observations:Observation[]=[],lastSequence=-1,lastCapture=-1,lastNow=-1;
  let state:CalibrationState={status:'collecting',reason:'collecting',sampleCount:0,elapsedMs:0,calibration:null};
  function restart(reason:CalibrationReason,seed?:Observation,detail?:string):CalibrationState {
    observations=seed?[seed]:[];state={status:'collecting',reason,sampleCount:observations.length,elapsedMs:0,calibration:null,...(detail?{detail}:{})};return state;
  }
  return {
    getState:()=>state,
    observe(sample:FrameSample,nowMs:number):CalibrationState {
      validateMathFrame(sample);timeMs(nowMs);
      if(nowMs<lastNow)throw new MathInputError('Calibration time must be monotonic');lastNow=nowMs;
      if(sample.captureTimeMs>nowMs)throw new MathInputError('Capture time cannot be in the future');
      if(state.status==='valid')return state;
      if(sample.sequence<=lastSequence||sample.captureTimeMs<=lastCapture)return restart('stale');
      const gap=lastCapture>=0&&sample.captureTimeMs-lastCapture>config.maxGapMs;
      lastSequence=sample.sequence;lastCapture=sample.captureTimeMs;
      if(nowMs-sample.captureTimeMs>config.maxAgeMs)return restart('stale');
      if(sample.validity!=='valid')return restart(sample.validity==='absent'?'no_hand':'invalid_sample');
      if(sample.handedness.label!==sample.selectedHand||sample.handedness.confidence<config.minHandConfidence)return restart('occlusion');
      if(sample.imageLandmarks.some(p=>p.x<0||p.x>1||p.y<0||p.y>1))return restart('occlusion');
      const o=palmObservation(sample,video);
      if(o.palmPixels<config.minPalmPixels)return restart('small_palm');
      // Desk scale/orientation does not require an absolute finger-angle estimate.
      // Keep the open-hand posture gate for air mode; desk contact is calibrated separately.
      if(purpose==='open_hand')for(const base of [5,9,13,17])for(const j of [1,2]){
        const bend=flexionDeg(sample.worldLandmarks[base+j-1]!,sample.worldLandmarks[base+j]!,sample.worldLandmarks[base+j+1]!);
        if(bend>config.maxOpenFlexionDeg){
          const finger=({5:'Index',9:'Middle',13:'Ring',17:'Pinky'} as Record<number,string>)[base];
          return restart('closed_pose',undefined,`${finger} ${j===1?'PIP':'DIP'} estimate ${bend.toFixed(1)}° exceeds the provisional ${config.maxOpenFlexionDeg}° open-palm gate. Straighten fingers and face palm toward camera; persistent rejection needs hardware review.`);
        }
      }
      const first=observations[0];
      if(first&&sample.selectedHand!==first.sample.selectedHand)return restart('hand_changed',o);
      if(gap)return restart('tracking_gap',o);
      if(first){
        const worldMedian=median(observations.map(x=>x.palmWorld)),pixelMedian=median(observations.map(x=>x.palmPixels));
        const wrist:SourcePixel={...first.wrist,x:median(observations.map(x=>x.wrist.x)),y:median(observations.map(x=>x.wrist.y))};
        const imageDot=first.imageBasis.longitudinal.x*o.imageBasis.longitudinal.x+first.imageBasis.longitudinal.y*o.imageBasis.longitudinal.y;
        const imageDeviationDeg=Math.acos(Math.max(-1,Math.min(1,imageDot)))*180/Math.PI;
        const unstableScale=Math.abs(o.palmWorld/worldMedian-1)>config.maxScaleVariationRatio||Math.abs(o.palmPixels/pixelMedian-1)>config.maxScaleVariationRatio;
        const unstableWrist=Math.hypot(o.wrist.x-wrist.x,o.wrist.y-wrist.y)/pixelMedian>config.maxWristDriftPalmUnits;
        const unstableOrientation=orientationDeviationDeg(first.palmBasis,o.palmBasis)>config.maxOrientationDeviationDeg||imageDeviationDeg>config.maxOrientationDeviationDeg;
        if(unstableScale||unstableWrist||unstableOrientation)return restart('unstable_pose',o);
      }
      observations.push(o);
      if(observations.length>config.maxBufferedSamples)observations.shift();
      const elapsedMs=sample.captureTimeMs-observations[0]!.sample.captureTimeMs;
      state={status:'collecting',reason:elapsedMs>=config.durationMs?'insufficient_samples':'collecting',sampleCount:observations.length,elapsedMs,calibration:null};
      if(elapsedMs>=config.durationMs&&observations.length>=config.minSamples){
        const palmWorld=median(observations.map(x=>x.palmWorld)),palmPixels=median(observations.map(x=>x.palmPixels));
        // Select a real orthonormal basis nearest the scale medians rather than averaging axes into a non-basis.
        const representative=observations.reduce((best,x)=>Math.abs(x.palmWorld/palmWorld-1)+Math.abs(x.palmPixels/palmPixels-1)<Math.abs(best.palmWorld/palmWorld-1)+Math.abs(best.palmPixels/palmPixels-1)?x:best);
        const calibration=CalibrationSchema.parse({hand:sample.selectedHand,video:{...video},palmWorld,palmPixels,palmBasis:representative.palmBasis,imageBasis:representative.imageBasis,configurationRevision:CONFIG_REVISION,exercise:'air_targets',sensorMode:'vision_only'}) as AirCalibration;
        state={...state,status:'valid',reason:'accepted',calibration};
      }
      return state;
    },
  };
}
