import { createDeskVisualDetector, deskCompatibilityReason } from './deskVisual';
import type { DeskCalibration, DeskVisualState } from './deskVisual';
import { CalibrationSchema } from './schemas';
import type { FrameSample } from './schemas';
import { imageToPixels } from './coordinates';
import { DESK_CONFIG, FRAME_CONFIG } from './config';
import { MathInputError, timeMs } from './mathValidation';
export type DeskPad = 'left' | 'right';

/** Labels follow the mirrored display: screen-left has the larger source-image X. */
export function validateDeskPads(left:DeskCalibration,right:DeskCalibration) {
  for(const cal of [left,right]){const parsed=CalibrationSchema.safeParse(cal);if(!parsed.success||parsed.data.exercise!=='desk_tap')throw new MathInputError('Valid desk calibrations required for both pads.');}
  if(left.hand!==right.hand||left.video.width!==right.video.width||left.video.height!==right.video.height)throw new MathInputError('Both pads must use the same hand and camera.');
  const a=left.desk.region,b=right.desk.region;
  if(a.center.x<=b.center.x||Math.hypot(a.center.x-b.center.x,a.center.y-b.center.y)<=a.radiusPixels+b.radiusPixels)throw new MathInputError('Place Left to the left of Right in the mirrored video, with separate rings.');
  for(const cal of [left,right]){const d=cal.desk.contactDirection;if(Math.abs((a.center.x-b.center.x)*d.y-(a.center.y-b.center.y)*d.x)<=a.radiusPixels+b.radiusPixels)throw new MathInputError('Pad lift paths overlap. Separate the pads across the lift direction or adjust the camera angle.');}
}
/** Each pad owns its measured contact plane and resting wrist position. Travel clears
 * pending contact; arrival on a new pad still needs a visible lift/return cycle. */
export function createDeskPadDetector(left:DeskCalibration,right:DeskCalibration) {
  validateDeskPads(left,right);
  const pads=[{id:'left' as const,cal:left},{id:'right' as const,cal:right}];
  let lastSequence=-1,lastCapture=-1,lastNow=-1;
  let active:DeskPad|null=null,detector:ReturnType<typeof createDeskVisualDetector>|null=null,cycle=0,count=0;
  let state:DeskVisualState={phase:'released',reason:'Move to either pad, lift, then tap.',calibrationValid:true,qPalmUnits:null,velocityPalmUnitsPerSecond:null,candidates:0,candidate:null};
  function reset(reason:string,invalidate=false){active=null;detector=null;state={...state,phase:'released',reason,calibrationValid:!invalidate&&state.calibrationValid,qPalmUnits:null,velocityPalmUnitsPerSecond:null,candidate:null};return state;}
  return {
    getState:()=>state,reset,
    observe(sample:FrameSample,nowMs:number,video=left.video):DeskVisualState {
      if(!state.calibrationValid)return state;
      timeMs(nowMs);timeMs(sample.captureTimeMs);
      if(nowMs<lastNow||sample.captureTimeMs>nowMs)throw new MathInputError('Invalid pad capture/delivery clock');
      if(sample.sequence<=lastSequence||sample.captureTimeMs<=lastCapture||nowMs-sample.captureTimeMs>FRAME_CONFIG.maxAgeMs||lastCapture>=0&&sample.captureTimeMs-lastCapture>FRAME_CONFIG.maxGapMs)return reset('stale_or_missing_frames',true);
      lastSequence=sample.sequence;lastCapture=sample.captureTimeMs;lastNow=nowMs;
      // Tracking/camera changes invalidate both pads, even between them.
      const reasons=pads.map(p=>deskCompatibilityReason(sample,p.cal,video));
      if(reasons.every(Boolean))return reset(reasons[0]!,true);
      if(sample.validity!=='valid')return reset('no_hand',true);
      const tip=imageToPixels(sample.imageLandmarks[8]!,video),wrist=imageToPixels(sample.imageLandmarks[0]!,video);
      const eligible=pads.filter((_,i)=>!reasons[i]).map(p=>{
        const d=p.cal.desk.contactDirection,r=p.cal.desk.rest;
        // Distance perpendicular to the learned lift axis: lift remains in the same pad.
        return {...p,distance:Math.abs((tip.x-r.x)*d.y-(tip.y-r.y)*d.x)};
      }).filter(p=>p.distance<=p.cal.desk.region.radiusPixels&&Math.hypot(wrist.x-p.cal.desk.wristRest.x,wrist.y-p.cal.desk.wristRest.y)<=DESK_CONFIG.maxWristDriftPalmUnits*p.cal.palmPixels).sort((a,b)=>a.distance-b.distance);
      const pad=eligible[0];
      if(!pad)return reset('Moving between pads; lift again at the next pad.');
      if(active!==pad.id){active=pad.id;detector=createDeskVisualDetector(pad.cal);}
      const next=detector!.observe(sample,nowMs,video);
      if(!next.calibrationValid)return reset(next.reason,true);
      const candidate=next.candidate?{...next.candidate,cycle:++cycle,pad:pad.id}:null;
      if(candidate)count++;
      state={...next,candidate,candidates:count,reason:`${pad.id==='left'?'Left':'Right'} pad: ${next.reason}`};return state;
    },
  };
}
