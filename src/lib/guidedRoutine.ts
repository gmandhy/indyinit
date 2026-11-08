import { flexionDeg, orientationDeviationDeg, palmBasis } from './biomechanics';
import type { PalmBasis } from './biomechanics';
import { FRAME_CONFIG } from './config';
import { MathInputError, timeMs } from './mathValidation';
import type { FrameSample } from './schemas';

/** Provisional interaction thresholds, not clinical targets. Holds use capture time. */
export const ROUTINE_CONFIG = Object.freeze({ openMaxDeg:30, openExitDeg:40, curledMinDeg:60, curledExitDeg:50, neutralHoldMs:1000,
  openHoldMs:2000, curlHoldMs:500, returnHoldMs:300, tiltHoldMs:500,
  tiltMinDeg:18, neutralMaxDeg:8, maxRollDeg:20, maxNeutralVariationDeg:8,
  minConfidence:.6, minPalmPixels:40, maxScaleChangeRatio:.3, maxWristDriftPalmUnits:.5 });
export const ROUTINE_EXERCISES = [
  { name:'Open Hand', reps:5, holdMs:ROUTINE_CONFIG.openHoldMs },
  { name:'Make a Fist', reps:5, holdMs:ROUTINE_CONFIG.curlHoldMs },
  { name:'Wrist Extension', reps:10, holdMs:ROUTINE_CONFIG.tiltHoldMs },
  { name:'Wrist Flexion', reps:10, holdMs:ROUTINE_CONFIG.tiltHoldMs },
] as const;
export interface RoutineState {
  readonly task:number; readonly reps:number; readonly set:number; readonly total:number;
  readonly complete:boolean; readonly stage:'setup'|'ready'|'holding'|'return'; readonly message:string; readonly holdProgress:number; readonly remainingMs:number; readonly needsRelease:boolean;
}
/** Local frame consumer; no devices, React, persistence, or scoring shared with trials. */
export function createGuidedRoutine(task:number) {
  if(!Number.isInteger(task)||!ROUTINE_EXERCISES[task])throw new MathInputError('Invalid routine task');
  const exercise=ROUTINE_EXERCISES[task]!,tilt=task>=2;
  let state:RoutineState={task,reps:0,set:1,total:0,complete:false,stage:'setup',message:'Start camera',holdProgress:0,remainingMs:0,needsRelease:false};
  let lastSequence=-1,lastCapture=-1,hand:FrameSample['selectedHand']|null=null;
  let heldSince:number|null=null,neutralSince:number|null=null,baseline:PalmBasis|null=null;
  let fingerPoses:('open'|'curled'|'mixed')[]=[],attempted=false;
  let wrist:{x:number;y:number}|null=null,palmPixels:number|null=null;
  function patch(value:Partial<RoutineState>){state={...state,...value};return state;}
  function resetHold(){heldSince=null;patch({holdProgress:0,remainingMs:0});}
  function interrupt(message:string,resetBaseline=false) {
    resetHold();fingerPoses=[];
    if(resetBaseline){baseline=null;neutralSince=null;wrist=null;palmPixels=null;}
    return patch({stage:'setup',message,needsRelease:attempted});
  }
  function held(time:number,duration:number){heldSince??=time;const elapsed=time-heldSince;patch({holdProgress:Math.min(1,elapsed/duration),remainingMs:Math.max(0,duration-elapsed)});return elapsed>=duration;}
  function cue(stage:RoutineState['stage']) {
    if(tilt)return stage==='ready'?'Tilt your palm':stage==='return'?'Return to neutral':'Hold the tilt';
    if(task===0)return stage==='ready'?'Open your hand':stage==='return'?'Close your hand':'Hold open';
    return stage==='ready'?'Close your hand':stage==='return'?'Open your hand':'Hold closed';
  }
  function count(){
    const total=state.total+1,complete=total===exercise.reps*2;
    resetHold();attempted=false;
    return patch({total,complete,needsRelease:false,set:total>=exercise.reps?2:1,reps:complete?exercise.reps:total%exercise.reps,stage:'ready',
      message:complete?'Complete':total===exercise.reps?'Set 2':cue('ready')});
  }
  return {
    getState:()=>state,
    suspend(message:string){lastSequence=-1;lastCapture=-1;hand=null;return interrupt(message,true);},
    observe(sample:FrameSample|null,nowMs:number,video:{width:number;height:number}):RoutineState {
      timeMs(nowMs);
      if(state.complete)return state;
      if(!Number.isFinite(video.width)||!Number.isFinite(video.height)||video.width<=0||video.height<=0)throw new MathInputError('Routine requires positive video dimensions');
      if(!sample){lastSequence=-1;lastCapture=-1;hand=null;return interrupt('Show your hand',true);}
      timeMs(sample.captureTimeMs);
      if(sample.captureTimeMs>nowMs)throw new MathInputError('Routine capture time is in the future');
      if(nowMs-sample.captureTimeMs>FRAME_CONFIG.maxAgeMs)return interrupt('Tracking delayed — hold still',true);
      if(sample.sequence<=lastSequence||sample.captureTimeMs<=lastCapture)return state;
      const gap=lastCapture>=0&&sample.captureTimeMs-lastCapture>FRAME_CONFIG.maxGapMs;
      lastSequence=sample.sequence;lastCapture=sample.captureTimeMs;
      if(sample.validity!=='valid')return interrupt('Show your hand',true);
      if(gap||hand!==sample.selectedHand){interrupt('Hold still',true);hand=sample.selectedHand;}
      if(sample.handedness.confidence<ROUTINE_CONFIG.minConfidence)return interrupt('Show one clear hand',true);
      const world=sample.worldLandmarks,image=sample.imageLandmarks;
      // Validate all landmarks through the shared math boundary before reading image points.
      const basis=palmBasis(world);
      if(image.length!==21||image.some(p=>![p.x,p.y,p.z].every(Number.isFinite)))throw new MathInputError('Routine requires 21 finite image landmarks');
      const pixel=(i:number)=>({x:image[i]!.x*video.width,y:image[i]!.y*video.height});
      const currentWrist=pixel(0),middle=pixel(9),scale=Math.hypot(middle.x-currentWrist.x,middle.y-currentWrist.y);
      if(scale<ROUTINE_CONFIG.minPalmPixels)return interrupt('Move your hand closer',true);
      if(image.some(p=>p.x<=0||p.x>=1||p.y<=0||p.y>=1))return interrupt('Keep your hand inside the frame',true);
      const bends=[5,9,13,17].map(i=>flexionDeg(world[i]!,world[i+1]!,world[i+2]!));
      // Separate enter/exit thresholds prevent model jitter from flipping a held pose.
      fingerPoses=bends.map((bend,i)=>{
        if(fingerPoses[i]==='open'&&bend<ROUTINE_CONFIG.openExitDeg)return 'open';
        if(fingerPoses[i]==='curled'&&bend>ROUTINE_CONFIG.curledExitDeg)return 'curled';
        return bend<=ROUTINE_CONFIG.openMaxDeg?'open':bend>=ROUTINE_CONFIG.curledMinDeg?'curled':'mixed';
      });
      const open=fingerPoses.every(p=>p==='open'),curled=fingerPoses.every(p=>p==='curled');
      if(tilt){
        if(!baseline){
          if(!open){neutralSince=null;return interrupt('Open your hand');}
          baseline=basis;neutralSince=sample.captureTimeMs;wrist=currentWrist;palmPixels=scale;
        }
        if(Math.abs(scale/palmPixels!-1)>ROUTINE_CONFIG.maxScaleChangeRatio||Math.hypot(currentWrist.x-wrist!.x,currentWrist.y-wrist!.y)/palmPixels!>ROUTINE_CONFIG.maxWristDriftPalmUnits)return interrupt('Keep your hand in place; reset neutral',true);
        if(neutralSince!==null){
          if(!open||orientationDeviationDeg(baseline,basis)>ROUTINE_CONFIG.maxNeutralVariationDeg){return interrupt('Hold neutral',true);}
          if(sample.captureTimeMs-neutralSince<ROUTINE_CONFIG.neutralHoldMs){const elapsed=sample.captureTimeMs-neutralSince;return patch({stage:'setup',message:'Hold neutral',holdProgress:elapsed/ROUTINE_CONFIG.neutralHoldMs,remainingMs:ROUTINE_CONFIG.neutralHoldMs-elapsed});}
          neutralSince=null;resetHold();patch({stage:'ready',message:cue('ready')});
        }
        const dot=(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number})=>a.x*b.x+a.y*b.y+a.z*b.z;
        const angle=(value:number)=>Math.acos(Math.max(-1,Math.min(1,value)))*180/Math.PI;
        const roll=angle(dot(baseline.transverse,basis.transverse));
        // Tilt in the baseline longitudinal/normal plane; sideways roll cannot earn a rep.
        const tiltDeg=Math.abs(Math.atan2(dot(basis.longitudinal,baseline.normal),dot(basis.longitudinal,baseline.longitudinal))*180/Math.PI);
        if(!open||roll>ROUTINE_CONFIG.maxRollDeg){resetHold();return patch({stage:'ready',message:!open?'Keep your fingers open':'Tilt without twisting sideways'});}
        return movement(tiltDeg>=ROUTINE_CONFIG.tiltMinDeg,tiltDeg<=ROUTINE_CONFIG.neutralMaxDeg,sample.captureTimeMs);
      }
      return movement(task===0?open:curled,task===0?curled:open,sample.captureTimeMs);
    },
  };
  function movement(target:boolean,rest:boolean,time:number):RoutineState {
    if(state.stage==='setup'){
      // Open Hand starts with the advertised motion; recovery still requires a release.
      if(task===0&&!attempted)patch({stage:'ready'});
      else {
        if(!rest){resetHold();return patch({message:tilt?'Return to neutral':task===0?'Close your hand':'Open your hand'});}
        if(!held(time,ROUTINE_CONFIG.returnHoldMs))return patch({message:'Hold briefly'});
        resetHold();return patch({stage:'ready',message:cue('ready')});
      }
    }
    if(state.stage==='return'){
      if(!rest){resetHold();return patch({message:cue('return')});}
      if(held(time,ROUTINE_CONFIG.returnHoldMs))return count();
      return patch({message:'Hold briefly'});
    }
    if(!target){resetHold();return patch({stage:'ready',message:!tilt&&!rest?(task===0?'Open all four fingers':'Close all four fingers'):cue('ready')});}
    attempted=true;
    if(held(time,exercise.holdMs)){resetHold();return patch({stage:'return',message:cue('return')});}
    return patch({stage:'holding',message:cue('holding')});
  }
}

/** One action at a time, with the following action shown alongside it. */
export function routineMotion(state:RoutineState) {
  const tilt=state.task>=2,opening=state.task===0;
  if(tilt){
    if(state.stage==='setup')return {now:'Hold neutral',next:'Tilt palm',pose:'neutral',nextPose:'tilt'};
    if(state.stage==='return')return {now:'Return to neutral',next:'Tilt palm',pose:'neutral',nextPose:'tilt'};
    return {now:state.stage==='holding'?'Hold the tilt':'Tilt palm',next:'Return to neutral',pose:'tilt',nextPose:'neutral'};
  }
  const target=opening?'Open hand':'Close hand',rest=opening?'Close hand':'Open hand';
  const targetPose=opening?'open':'closed',restPose=opening?'closed':'open';
  if(state.stage==='setup')return opening&&!state.needsRelease?{now:target,next:rest,pose:targetPose,nextPose:restPose}:{now:rest,next:target,pose:restPose,nextPose:targetPose};
  if(state.stage==='return')return {now:rest,next:target,pose:restPose,nextPose:targetPose};
  return {now:state.stage==='holding'?(opening?'Hold open':'Hold closed'):target,next:rest,pose:targetPose,nextPose:restPose};
}
