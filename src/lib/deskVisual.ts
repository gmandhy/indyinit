import { CalibrationSchema } from './schemas';
import type { Calibration, FrameSample } from './schemas';
import type { AirCalibration } from './calibration';
import { palmObservation, validateMathFrame } from './calibration';
import { AIR_CONFIG, CALIBRATION_CONFIG, DESK_CONFIG as C, FRAME_CONFIG, MATH_CONFIG } from './config';
import { imageToPixels, sourcePixel, validateSize } from './coordinates';
import type { Size, SourcePixel } from './coordinates';
import { MathInputError, median, point2, positive, timeMs } from './mathValidation';

export type DeskCalibration = Extract<Calibration,{sensorMode:'kinematic_only'}>;
export interface DeskRegion { readonly center:SourcePixel; readonly radiusPixels:number }
type GeometryCalibration = Calibration;
type ValidFrame = Extract<FrameSample,{validity:'valid'}>;
interface Observation { readonly tip:SourcePixel; readonly wrist:SourcePixel; readonly time:number; readonly sample:ValidFrame }
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
const dot=(p:{x:number;y:number},origin:{x:number;y:number},d:{x:number;y:number})=>(p.x-origin.x)*d.x+(p.y-origin.y)*d.y;
const middle=(points:readonly SourcePixel[])=>sourcePixel(median(points.map(p=>p.x)),median(points.map(p=>p.y)));
const overlaps=(p:SourcePixel,r:DeskRegion)=>distance(p,r.center)<=r.radiusPixels;
function regionValid(region:DeskRegion,video:Size) {
  point2(region.center);positive(region.radiusPixels,'ring radius pixels');
  if(region.center.x-region.radiusPixels<0||region.center.y-region.radiusPixels<0||region.center.x+region.radiusPixels>video.width||region.center.y+region.radiusPixels>video.height)throw new MathInputError('Desk ring must be fully inside source video');
}
/** No anatomical wrist angle gate in desk mode. All motion is source-pixel motion. */
export function deskCompatibilityReason(sample:FrameSample,cal:GeometryCalibration,video:Size=cal.video):string|null {
  validateMathFrame(sample);validateSize(video);
  if(video.width!==cal.video.width||video.height!==cal.video.height)return 'video_changed';
  if(sample.selectedHand!==cal.hand||(sample.validity==='valid'&&sample.handedness.label!==cal.hand))return 'hand_changed';
  if(sample.validity!=='valid')return sample.validity==='absent'?'no_hand':'invalid_sample';
  if(sample.handedness.confidence<CALIBRATION_CONFIG.minHandConfidence||sample.imageLandmarks.some(p=>p.x<0||p.x>1||p.y<0||p.y>1))return 'occlusion';
  const o=palmObservation(sample,video);
  if(o.palmPixels<CALIBRATION_CONFIG.minPalmPixels)return 'small_palm';
  if(Math.abs(o.palmPixels/cal.palmPixels-1)>AIR_CONFIG.maxScaleChangeRatio||Math.abs(o.palmWorld/cal.palmWorld-1)>AIR_CONFIG.maxScaleChangeRatio)return 'scale_changed';
  if(cal.exercise==='desk_tap'){
    const a=o.imageBasis.longitudinal,b=cal.imageBasis.longitudinal;
    if(a.x*b.x+a.y*b.y<Math.cos(C.maxGeometryAxisDeviationDeg*Math.PI/180))return 'hand_geometry_changed';
  }
  return null;
}
function observeGeometry(sample:ValidFrame,video:Size):Observation {
  return {tip:imageToPixels(sample.imageLandmarks[8]!,video),wrist:imageToPixels(sample.imageLandmarks[0]!,video),time:sample.captureTimeMs,sample};
}
/** Per-owner clock/sequence validator. Invalid samples never become dummy positions. */
function createSampleGate(cal:GeometryCalibration) {
  let sequence=-1,capture=-1,clock=-1;
  return (sample:FrameSample,nowMs:number,video:Size)=>{
    validateMathFrame(sample);timeMs(nowMs);
    if(nowMs<clock)throw new MathInputError('Desk clock must be monotonic');clock=nowMs;
    if(sample.captureTimeMs>nowMs)throw new MathInputError('Capture time cannot be in the future');
    if(sample.sequence<=sequence||sample.captureTimeMs<=capture||nowMs-sample.captureTimeMs>FRAME_CONFIG.maxAgeMs)return 'stale';
    const gap=capture>=0&&sample.captureTimeMs-capture>FRAME_CONFIG.maxGapMs;
    sequence=sample.sequence;capture=sample.captureTimeMs;
    return deskCompatibilityReason(sample,cal,video)??(gap?'tracking_gap':null);
  };
}
export interface DeskCalibrationState {
  readonly stage:'awaiting_rest'|'resting'|'ready_cycle'|'recording'|'valid'|'invalid';
  readonly reason:string; readonly samples:number; readonly cycles:number;
  readonly calibration:DeskCalibration|null;
  readonly measuredExcursionPixels:readonly number[];
}
/** Guided, bounded memory-only recordings. Operator marks each complete lift/return;
 * this is visual calibration, with no claim of known physical contact or audio offset. */
export function createDeskCalibrator(input:AirCalibration,region:DeskRegion) {
  const palm=CalibrationSchema.parse(input) as AirCalibration;
  if(palm.sensorMode!=='vision_only')throw new MathInputError('Palm calibration required before desk setup');
  regionValid(region,palm.video);
  const ring:DeskRegion={center:sourcePixel(region.center.x,region.center.y),radiusPixels:region.radiusPixels};
  const gate=createSampleGate(palm);
  let rest:SourcePixel|null=null,wristRest:SourcePixel|null=null,restSample:ValidFrame|null=null;
  let buffer:Observation[]=[],cycles:Observation[][]=[],restPoints:SourcePixel[]=[];
  let state:DeskCalibrationState={stage:'awaiting_rest',reason:'Place fingertip in ring, then capture rest.',samples:0,cycles:0,calibration:null,measuredExcursionPixels:[]};
  function invalid(reason:string){buffer=[];cycles=[];restPoints=[];rest=null;wristRest=null;restSample=null;state={...state,stage:'invalid',reason,samples:0,cycles:0,calibration:null,measuredExcursionPixels:[]};return state;}
  function reject(reason:string){buffer=[];state={...state,stage:'ready_cycle',reason,samples:0};return state;}
  return {
    getState:()=>state,
    invalidate:invalid,
    captureRest(){if(state.stage!=='awaiting_rest')return state;buffer=[];state={...state,stage:'resting',reason:'Hold fingertip at rest in ring for 500 ms.'};return state;},
    beginCycle(){if(state.stage!=='ready_cycle'||cycles.length>=C.maxCycles)return state;buffer=[];state={...state,stage:'recording',samples:0,reason:'Lift once, return to ring, hold still, then save cycle.'};return state;},
    observe(sample:FrameSample,nowMs:number,video:Size=palm.video) {
      const reason=gate(sample,nowMs,video);
      if(state.stage==='invalid'||state.stage==='valid')return state;
      if(reason)return invalid(reason);
      if(sample.validity!=='valid')return invalid('invalid_sample');
      const o=observeGeometry(sample,video);
      if(restSample){
        const a=palmObservation(sample,video).imageBasis.longitudinal,b=palmObservation(restSample,video).imageBasis.longitudinal;
        if(a.x*b.x+a.y*b.y<Math.cos(C.maxGeometryAxisDeviationDeg*Math.PI/180))return invalid('hand_geometry_changed');
      }
      if(wristRest&&distance(o.wrist,wristRest)/palm.palmPixels>C.maxWristDriftPalmUnits)return invalid('wrist_position_changed');
      if(state.stage!=='resting'&&state.stage!=='recording')return state;
      const prev=buffer.at(-1);
      if(prev&&distance(o.wrist,prev.wrist)/palm.palmPixels/((o.time-prev.time)/1000)>C.maxWristSpeedTolerance)return invalid('wrist_motion');
      buffer.push(o);state={...state,samples:buffer.length};
      if(state.stage==='recording'){
        if(buffer.length>C.maxBufferedSamples||o.time-buffer[0]!.time>C.maxCycleMs)return reject('Cycle too long; record one lift and return within 5 seconds.');
        return state;
      }
      if(!overlaps(o.tip,ring))return invalid('rest_outside_ring');
      const center=middle(buffer.map(x=>x.tip));
      if(buffer.some(x=>distance(x.tip,center)>Math.max(C.restNoisePixels,C.restNoisePalmUnits*palm.palmPixels)))return invalid('unstable_rest');
      const wristCenter=middle(buffer.map(x=>x.wrist));
      if(buffer.some(x=>distance(x.wrist,wristCenter)/palm.palmPixels>C.maxWristDriftPalmUnits))return invalid('unstable_rest_wrist');
      if(buffer.length>C.maxBufferedSamples)return invalid('insufficient_rest_timing');
      if(buffer.length>=C.restMinSamples&&o.time-buffer[0]!.time>=C.restDurationMs){
        rest=center;wristRest=middle(buffer.map(x=>x.wrist));restSample=o.sample;restPoints=buffer.map(x=>x.tip);buffer=[];
        state={...state,stage:'ready_cycle',reason:'Rest captured. Record 3–5 single lift/return cycles.',samples:0};
      }
      return state;
    },
    finishCycle(){
      if(state.stage!=='recording'||!rest)return state;
      if(buffer.length<C.restMinSamples||buffer.at(-1)!.time-buffer[0]!.time<C.minCycleMs)return reject('insufficient_cycle_samples');
      const tail=buffer.slice(-C.endpointSamples),head=buffer.slice(0,C.endpointSamples);
      if([...head,...tail].some(x=>!overlaps(x.tip,ring)||distance(x.tip,rest!)>C.maxContactSpreadPalmUnits*palm.palmPixels))return reject('Return to the captured resting position and ring.');
      if(tail.some(x=>distance(x.tip,middle(tail.map(v=>v.tip)))>Math.max(C.restNoisePixels,C.restNoisePalmUnits*palm.palmPixels)))return reject('unstable_contact');
      const excursion=Math.max(...buffer.map(x=>distance(x.tip,rest!)));
      if(excursion<Math.max(C.minExcursionPixels,C.minExcursionPalmUnits*palm.palmPixels))return reject('insufficient_projected_motion: use an oblique camera view.');
      cycles.push(buffer);buffer=[];state={...state,stage:'ready_cycle',samples:0,cycles:cycles.length,measuredExcursionPixels:[...state.measuredExcursionPixels,excursion],reason:`${cycles.length} cycles captured; record another or finish (3–5 required).`};return state;
    },
    finish(){
      if(state.stage!=='ready_cycle'||!rest||!wristRest||!restSample)return state;
      if(cycles.length<C.minCycles){state={...state,reason:'At least 3 complete cycles are required.'};return state;}
      const peaks=cycles.map(c=>c.reduce((best,o)=>distance(o.tip,rest!)>distance(best.tip,rest!)?o:best));
      const axes=peaks.map(o=>{const n=distance(o.tip,rest!);return {x:(rest!.x-o.tip.x)/n,y:(rest!.y-o.tip.y)/n};});
      const x=median(axes.map(a=>a.x)),y=median(axes.map(a=>a.y)),norm=Math.hypot(x,y);
      if(norm<MATH_CONFIG.unitTolerance)return invalid('inconsistent_lift_direction');
      const d={x:x/norm,y:y/norm},cos=Math.cos(C.maxAxisDeviationDeg*Math.PI/180);
      if(axes.some(a=>a.x*d.x+a.y*d.y<cos))return invalid('inconsistent_lift_direction');
      const amplitudes=peaks.map(o=>-dot(o.tip,rest!,d)/palm.palmPixels);
      if(Math.min(...amplitudes)*palm.palmPixels<Math.max(C.minExcursionPixels,C.minExcursionPalmUnits*palm.palmPixels))return invalid('insufficient_projected_motion');
      const contacts=[...restPoints,...cycles.flatMap(c=>c.slice(-C.endpointSamples).map(o=>o.tip))];
      const q=contacts.map(p=>dot(p,rest!,d)/palm.palmPixels),margin=C.contactMarginPixels/palm.palmPixels;
      const min=Math.min(...q)-margin,max=Math.max(...q)+margin,excursion=median(amplitudes);
      if(max-min>C.maxContactSpreadPalmUnits||-min>=excursion*C.releaseExcursionRatio)return invalid('contact_band_too_wide');
      const speeds=cycles.flatMap(c=>c.slice(1).map((o,i)=>distance(o.wrist,c[i]!.wrist)/palm.palmPixels/((o.time-c[i]!.time)/1000)));
      const restObservation=palmObservation(restSample,palm.video);
      const calibration=CalibrationSchema.parse({...palm,exercise:'desk_tap',sensorMode:'kinematic_only',palmBasis:restObservation.palmBasis,imageBasis:restObservation.imageBasis,
        desk:{region:ring,rest,wristRest,contactDirection:d,contactBand:{minPalmUnits:min,maxPalmUnits:max},excursionPalmUnits:excursion,
          wristTolerancePalmUnitsPerSecond:Math.min(C.maxWristSpeedTolerance,Math.max(C.minWristSpeedTolerance,Math.max(...speeds)+C.wristSpeedMargin))}}) as DeskCalibration;
      buffer=[];cycles=[];restPoints=[];state={...state,stage:'valid',reason:'Visual desk calibration ready; audio offset not measured.',calibration};return state;
    },
  };
}

export interface VisualCandidate { readonly sequence:number; readonly cycle:number; readonly captureTimeMs:number; readonly observedAtMs:number; readonly position?:SourcePixel; readonly pad?:'left'|'right' }
export interface DeskVisualState {
  readonly phase:'released'|'lifted'|'descending'|'contactCandidate'; readonly reason:string;
  readonly calibrationValid:boolean; readonly qPalmUnits:number|null; readonly velocityPalmUnitsPerSecond:number|null;
  readonly candidates:number; readonly candidate:VisualCandidate|null;
}
/** Capture-time state machine. Rendering never calls observe or increments counts.
 * A contact extremum needs a subsequent settling/reversal observation in the band.
 * Nothing in this detector establishes physical contact. */
export function createDeskVisualDetector(input:Extract<Calibration,{exercise:'desk_tap'}>) {
  const cal=CalibrationSchema.parse(input);
  if(cal.exercise!=='desk_tap')throw new MathInputError('Desk calibration required');
  const desk=cal.desk,region={...desk.region,center:sourcePixel(desk.region.center.x,desk.region.center.y)},gate=createSampleGate(cal);
  const releaseQ=-Math.max(C.minExcursionPalmUnits,desk.excursionPalmUnits*C.releaseExcursionRatio);
  const exitMargin=C.contactExitMarginPixels/cal.palmPixels;
  if(releaseQ>=desk.contactBand.minPalmUnits-exitMargin)throw new MathInputError('Desk release/contact bands overlap');
  let previous:Observation|null=null,previousQ=0,cycle=0;
  let pending:{extremum:Observation;q:number;enteredMs:number}|null=null;
  let state:DeskVisualState={phase:'released',reason:'Lift before contact.',calibrationValid:true,qPalmUnits:null,velocityPalmUnitsPerSecond:null,candidates:0,candidate:null};
  function reset(reason:string,invalidate=false){previous=null;pending=null;state={...state,phase:'released',reason,calibrationValid:state.calibrationValid&&!invalidate,qPalmUnits:null,velocityPalmUnitsPerSecond:null,candidate:null};return state;}
  return {
    getState:()=>state,
    reset,
    observe(sample:FrameSample,nowMs:number,video:Size=cal.video):DeskVisualState {
      const reason=gate(sample,nowMs,video);state={...state,candidate:null};
      if(!state.calibrationValid)return state;
      if(reason)return reset(reason,true);
      if(sample.validity!=='valid')return reset('invalid_sample',true);
      const o=observeGeometry(sample,video),q=dot(o.tip,desk.rest,desk.contactDirection)/cal.palmPixels;
      const dt=previous?(o.time-previous.time)/1000:null,v=dt===null?null:(q-previousQ)/dt;
      const wristSpeed=previous?distance(o.wrist,previous.wrist)/cal.palmPixels/dt!:0;
      previous=o;previousQ=q;
      if(distance(o.wrist,desk.wristRest)/cal.palmPixels>C.maxWristDriftPalmUnits)return reset('wrist_position_changed',true);
      if(wristSpeed>desk.wristTolerancePalmUnitsPerSecond)return reset('wrist_motion');
      state={...state,qPalmUnits:q,velocityPalmUnitsPerSecond:v};
      if(state.phase==='released'){
        if(q<=releaseQ){cycle++;state={...state,phase:'lifted',reason:'lifted'};}
        return state;
      }
      const inside=overlaps(o.tip,region),inBand=q>=desk.contactBand.minPalmUnits&&q<=desk.contactBand.maxPalmUnits;
      if(state.phase==='contactCandidate'){
        if(!inside||q>desk.contactBand.maxPalmUnits+exitMargin||q<desk.contactBand.minPalmUnits-exitMargin)return reset('contact_left_band_or_ring');
        if(!inBand)return state;
        if(o.time-pending!.enteredMs>C.maxConfirmationMs)return reset('unconfirmed_contact');
        if(q>pending!.q){pending={...pending!,extremum:o,q};}
        if(v!==null&&v<=C.extremumSpeedPalmUnitsPerSecond){
          const candidate={sequence:pending!.extremum.sample.sequence,cycle,captureTimeMs:pending!.extremum.time,observedAtMs:nowMs,position:pending!.extremum.tip};
          pending=null;state={...state,phase:'released',reason:'Visual candidate; lift to rearm.',candidates:state.candidates+1,candidate};
        }
        return state;
      }
      if(v!==null&&v>=C.minDescendingPalmUnitsPerSecond)state={...state,phase:'descending',reason:'descending'};
      if(state.phase==='descending'&&inBand){
        if(!inside)return reset('contact_outside_ring');
        if(v===null||v<C.minDescendingPalmUnitsPerSecond)return reset('contact_without_descent');
        pending={extremum:o,q,enteredMs:o.time};state={...state,phase:'contactCandidate',reason:'Confirming visual contact extremum.'};
      }else if(q>desk.contactBand.maxPalmUnits+exitMargin)return reset('missed_contact_band');
      return state;
    },
  };
}
