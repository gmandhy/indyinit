import type { WorldLandmark } from './schemas';
import { DISPLAY_CONFIG, MATH_CONFIG, ORIENTATION_CONFIG } from './config';
import { MathInputError, finite, landmarks, point3, positive, timeMs, validatePositiveConfig } from './mathValidation';
export interface Vector3 { readonly x:number;readonly y:number;readonly z:number }
export interface PalmBasis { readonly longitudinal:Vector3;readonly transverse:Vector3;readonly normal:Vector3 }
const sub=(a:Vector3,b:Vector3):Vector3=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const dot=(a:Vector3,b:Vector3)=>a.x*b.x+a.y*b.y+a.z*b.z;
const norm=(v:Vector3)=>Math.hypot(v.x,v.y,v.z);
const cross=(a:Vector3,b:Vector3):Vector3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
function unit(v:Vector3,epsilon:number):Vector3 {
  point3(v);const l=finite(norm(v),'vector length');if(l<epsilon)throw new MathInputError(`Degenerate vector below ${epsilon} m`);
  return {x:v.x/l,y:v.y/l,z:v.z/l};
}
const acosDeg=(value:number)=>Math.acos(Math.max(-1,Math.min(1,value)))*180/Math.PI;
export function worldDistance(a:WorldLandmark,b:WorldLandmark):number { point3(a);point3(b);return finite(norm(sub(a,b)),'world distance'); }
/** Unsigned world-landmark bend estimate; does not measure signed hyperextension. */
export function flexionDeg(a:WorldLandmark,b:WorldLandmark,c:WorldLandmark,epsilonMeters=MATH_CONFIG.vectorEpsilonMeters):number {
  [a,b,c].forEach(p=>point3(p));positive(epsilonMeters,'epsilonMeters');
  return 180-acosDeg(dot(unit(sub(a,b),epsilonMeters),unit(sub(c,b),epsilonMeters)));
}
export function indexFlexionEstimates(world:readonly WorldLandmark[]) {
  landmarks(world,'world');return {pipFlexionDeg:flexionDeg(world[5]!,world[6]!,world[7]!),dipFlexionDeg:flexionDeg(world[6]!,world[7]!,world[8]!),mcpProxyFlexionDeg:flexionDeg(world[0]!,world[5]!,world[6]!)};
}
export function thumbReachRatio(world:readonly WorldLandmark[],palmWorld:number):number {
  landmarks(world,'world');positive(palmWorld,'palmWorld meters');return worldDistance(world[4]!,world[17]!)/palmWorld;
}
export function palmBasis(world:readonly WorldLandmark[]):PalmBasis {
  landmarks(world,'world');
  const a=unit(sub(world[9]!,world[0]!),MATH_CONFIG.vectorEpsilonMeters),t=sub(world[17]!,world[5]!),d=dot(t,a);
  const b=unit({x:t.x-d*a.x,y:t.y-d*a.y,z:t.z-d*a.z},MATH_CONFIG.vectorEpsilonMeters);
  return {longitudinal:a,transverse:b,normal:unit(cross(a,b),MATH_CONFIG.vectorEpsilonMeters)};
}
function validateBasis(b:PalmBasis):void {
  const axes=[b.longitudinal,b.transverse,b.normal];axes.forEach(p=>point3(p,'palm basis'));
  const close=(v:number,target:number)=>Math.abs(v-target)<=MATH_CONFIG.unitTolerance;
  const n=cross(b.longitudinal,b.transverse);
  if(!axes.every(v=>close(norm(v),1))||!close(dot(b.longitudinal,b.transverse),0)||!close(n.x,b.normal.x)||!close(n.y,b.normal.y)||!close(n.z,b.normal.z))throw new MathInputError('Palm basis must be right-handed and orthonormal');
}
export function orientationDeviationDeg(baseline:PalmBasis,current:PalmBasis):number {
  validateBasis(baseline);validateBasis(current);
  return Math.max(...(['longitudinal','transverse','normal'] as const).map(key=>acosDeg(dot(baseline[key],current[key]))));
}
export function nextOrientationLock(locked:boolean,deviationDeg:number,config: {lockAboveDeg:number;unlockBelowDeg:number}=ORIENTATION_CONFIG):boolean {
  finite(deviationDeg,'deviationDeg');validatePositiveConfig(config);
  if(deviationDeg<0||deviationDeg>180||config.unlockBelowDeg>=config.lockAboveDeg||config.lockAboveDeg>180)throw new MathInputError('Invalid orientation angles/hysteresis');
  return locked?deviationDeg>=config.unlockBelowDeg:deviationDeg>config.lockAboveDeg;
}
export interface SmoothedDisplay { readonly value:number;readonly timeMs:number }
export function smoothDisplay(previous:SmoothedDisplay|null,raw:number|null,captureTimeMs:number,config:{tauMs:number;resetGapMs:number}=DISPLAY_CONFIG):SmoothedDisplay|null {
  timeMs(captureTimeMs);validatePositiveConfig(config);
  if(previous){finite(previous.value,'previous display');timeMs(previous.timeMs);if(captureTimeMs<=previous.timeMs)throw new MathInputError('Display time must be increasing');}
  if(raw===null)return null;finite(raw,'raw display');
  const dt=previous?captureTimeMs-previous.timeMs:Infinity;
  return {value:!previous||dt>config.resetGapMs?raw:previous.value+(1-Math.exp(-dt/config.tauMs))*(raw-previous.value),timeMs:captureTimeMs};
}
