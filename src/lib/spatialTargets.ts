import { CalibrationSchema } from './schemas';
import type { FrameSample, ImageLandmark } from './schemas';
import type { AirCalibration } from './calibration';
import { palmObservation, validateMathFrame } from './calibration';
import { AIR_CONFIG, CALIBRATION_CONFIG, FRAME_CONFIG } from './config';
import { imageToPixels, sourcePixel } from './coordinates';
import type { SourcePixel } from './coordinates';
import { nextOrientationLock, orientationDeviationDeg } from './biomechanics';
import { MathInputError, finite, positive, timeMs } from './mathValidation';
export interface AirTarget {
  readonly id:string; readonly offsetPalmUnits:{readonly longitudinal:number;readonly transverse:number};
  readonly radiusPalmUnits:number; readonly requiredLandmarkIndex:number; readonly dwellMs:number;
}
export interface TargetCircle { readonly center:SourcePixel;readonly radiusPixels:number }
export const DEFAULT_AIR_TARGET:AirTarget=Object.freeze({id:'index-reach',offsetPalmUnits:{longitudinal:1.6875,transverse:0},radiusPalmUnits:.25,requiredLandmarkIndex:8,dwellMs:AIR_CONFIG.dwellMs});
function validateTarget(target:AirTarget):void {
  if(!target.id.trim())throw new MathInputError('Target id is required');
  finite(target.offsetPalmUnits.longitudinal,'longitudinal palm units');finite(target.offsetPalmUnits.transverse,'transverse palm units');
  positive(target.radiusPalmUnits,'radiusPalmUnits');positive(target.dwellMs,'dwellMs');
  if(!Number.isInteger(target.requiredLandmarkIndex)||target.requiredLandmarkIndex<0||target.requiredLandmarkIndex>20)throw new MathInputError('requiredLandmarkIndex must be in [0,20]');
  if(Math.hypot(target.offsetPalmUnits.longitudinal,target.offsetPalmUnits.transverse)+target.radiusPalmUnits>AIR_CONFIG.maxReachPalmUnits)throw new MathInputError('Target path must be reachable and on-screen');
}
/** Source pixels only. Frozen calibrated image axes; current wrist translates but never rotates targets. */
export function targetCircle(target:AirTarget,calibration:AirCalibration,wrist:ImageLandmark):TargetCircle {
  validateTarget(target);const c=CalibrationSchema.parse(calibration);const p=imageToPixels(wrist,c.video),a=c.imageBasis.longitudinal,b=c.imageBasis.transverse;
  const center=sourcePixel(p.x+c.palmPixels*(target.offsetPalmUnits.longitudinal*a.x+target.offsetPalmUnits.transverse*b.x),p.y+c.palmPixels*(target.offsetPalmUnits.longitudinal*a.y+target.offsetPalmUnits.transverse*b.y));
  const radiusPixels=c.palmPixels*target.radiusPalmUnits;
  if(center.x-radiusPixels<0||center.y-radiusPixels<0||center.x+radiusPixels>c.video.width||center.y+radiusPixels>c.video.height)throw new MathInputError('Target circle is off-screen');
  return {center,radiusPixels};
}
/** Calibration validity uses image and world scales separately, never a mixed-unit distance. */
export function calibrationCompatibilityReason(sample:FrameSample,calibration:AirCalibration):string|null {
  validateMathFrame(sample);
  if(sample.selectedHand!==calibration.hand||(sample.validity==='valid'&&sample.handedness.label!==calibration.hand))return 'hand_changed';
  if(sample.validity!=='valid')return sample.validity==='absent'?'no_hand':'invalid_sample';
  if(sample.handedness.confidence<CALIBRATION_CONFIG.minHandConfidence)return 'occlusion';
  const o=palmObservation(sample,calibration.video);
  if(Math.abs(o.palmPixels/calibration.palmPixels-1)>AIR_CONFIG.maxScaleChangeRatio||Math.abs(o.palmWorld/calibration.palmWorld-1)>AIR_CONFIG.maxScaleChangeRatio)return 'scale_changed';
  return null;
}
export interface AirTargetState {
  readonly targetId:string;readonly circle:TargetCircle|null;readonly completedReps:number;readonly attempts:number;
  readonly blockedAttempts:number;readonly lockoutEvents:number;readonly maxPalmDeviationDeg:number|null;
  readonly locked:boolean;readonly deviationDeg:number|null;readonly requiresRelease:boolean;readonly dwellElapsedMs:number;
  readonly calibrationValid:boolean;readonly reason:string;readonly accepted:boolean;
}
export function createAirTargetEngine(input:AirCalibration,path:readonly AirTarget[],now:()=>number) {
  const calibration=CalibrationSchema.parse(input) as AirCalibration;
  if(calibration.exercise!=='air_targets')throw new MathInputError('Air calibration required');
  if(path.length===0)throw new MathInputError('Target path must be nonempty');
  path.forEach(validateTarget);if(new Set(path.map(t=>t.id)).size!==path.length)throw new MathInputError('Target IDs must be unique');
  const targets=path.map(t=>({...t,offsetPalmUnits:{...t.offsetPalmUnits}}));
  let index=0,lastNow=timeMs(now()),lastSequence=-1,lastCapture=-1,dwellStart:number|null=null,attemptActive=false,blockedThisLock=false,advanceOnRelease=false;
  let state:AirTargetState={targetId:targets[0]!.id,circle:null,completedReps:0,attempts:0,blockedAttempts:0,lockoutEvents:0,maxPalmDeviationDeg:null,locked:false,deviationDeg:null,requiresRelease:false,dwellElapsedMs:0,calibrationValid:true,reason:'ready',accepted:false};
  function readTime(){const t=timeMs(now());if(t<lastNow)throw new MathInputError('Air target clock must be monotonic');lastNow=t;return t;}
  function interrupt(reason:string){dwellStart=null;attemptActive=false;state={...state,requiresRelease:true,dwellElapsedMs:0,reason,accepted:false,circle:null,deviationDeg:null};return state;}
  function invalidate(reason:string){interrupt(reason);state={...state,calibrationValid:false};return state;}
  return {
    getState:()=>state,
    invalidate,
    tick(){const t=readTime();if(lastCapture>=0&&t-lastCapture>FRAME_CONFIG.maxAgeMs)interrupt('stale');return state;},
    observe(sample:FrameSample):AirTargetState {
      validateMathFrame(sample);const t=readTime();
      if(sample.captureTimeMs>t)throw new MathInputError('Capture time cannot be in the future');
      state={...state,accepted:false};
      if(!state.calibrationValid)return state;
      if(sample.selectedHand!==calibration.hand||(sample.validity==='valid'&&sample.handedness.label!==calibration.hand))return invalidate('hand_changed');
      if(sample.sequence<=lastSequence||sample.captureTimeMs<=lastCapture)return interrupt('stale');
      const gap=lastCapture>=0&&sample.captureTimeMs-lastCapture>FRAME_CONFIG.maxGapMs;
      lastSequence=sample.sequence;lastCapture=sample.captureTimeMs;
      if(t-sample.captureTimeMs>FRAME_CONFIG.maxAgeMs)return interrupt('stale');
      if(sample.validity!=='valid')return interrupt(sample.validity==='absent'?'no_hand':'invalid_sample');
      const compatibilityReason=calibrationCompatibilityReason(sample,calibration);
      if(compatibilityReason==='occlusion')return interrupt(compatibilityReason);
      if(compatibilityReason)return invalidate(compatibilityReason);
      const o=palmObservation(sample,calibration.video);
      if(gap)interrupt('tracking_gap');
      const deviationDeg=orientationDeviationDeg(calibration.palmBasis,o.palmBasis),locked=nextOrientationLock(state.locked,deviationDeg),newLock=locked&&!state.locked;
      if(!locked)blockedThisLock=false;
      state={...state,deviationDeg,locked,lockoutEvents:state.lockoutEvents+(newLock?1:0),maxPalmDeviationDeg:Math.max(state.maxPalmDeviationDeg??0,deviationDeg)};
      if(newLock&&attemptActive){
        state={...state,blockedAttempts:state.blockedAttempts+1,requiresRelease:true};
        blockedThisLock=true;attemptActive=false;dwellStart=null;
      }
      const target=targets[index]!;
      let circle:TargetCircle;
      try{circle=targetCircle(target,calibration,sample.imageLandmarks[0]!);}
      catch(error){if(error instanceof MathInputError&&error.message.includes('off-screen'))return interrupt('target_off_screen');throw error;}
      state={...state,circle};
      const tip=imageToPixels(sample.imageLandmarks[target.requiredLandmarkIndex]!,calibration.video);
      const inside=Math.hypot(tip.x-circle.center.x,tip.y-circle.center.y)<=circle.radiusPixels;
      if(!inside){
        dwellStart=null;attemptActive=false;
        if(advanceOnRelease){index=(index+1)%targets.length;advanceOnRelease=false;state={...state,circle:null};}
        state={...state,targetId:targets[index]!.id,requiresRelease:false,dwellElapsedMs:0,reason:locked?'orientation_locked':'ready'};return state;
      }
      // A continuous lockout consumes at most one blocked attempt, even after exit/reentry.
      if(locked){
        if(!blockedThisLock&&(attemptActive||!state.requiresRelease)){
          state={...state,attempts:state.attempts+(attemptActive?0:1),blockedAttempts:state.blockedAttempts+1};blockedThisLock=true;
        }
        dwellStart=null;attemptActive=false;state={...state,requiresRelease:true,dwellElapsedMs:0,reason:'orientation_locked'};return state;
      }
      if(state.requiresRelease)return state;
      if(!attemptActive){attemptActive=true;dwellStart=sample.captureTimeMs;state={...state,attempts:state.attempts+1};}
      const dwellElapsedMs=sample.captureTimeMs-dwellStart!;
      state={...state,dwellElapsedMs,reason:'dwelling'};
      if(dwellElapsedMs>=target.dwellMs){
        dwellStart=null;attemptActive=false;advanceOnRelease=true;
        state={...state,completedReps:state.completedReps+1,requiresRelease:true,accepted:true,reason:'accepted'};
      }
      return state;
    },
  };
}
