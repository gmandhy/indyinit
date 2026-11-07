import { FrameSampleSchema } from '../src/lib/schemas';
import type { FrameSample } from '../src/lib/schemas';
export const SYNTHETIC_VIDEO = Object.freeze({width:640,height:360});
/** Artificial open-hand geometry. No recorded person, precomputed scores or hardware evidence. */
export function syntheticHandFrame(captureTimeMs=0,sequence=0,hand:'Left'|'Right'='Right'):Extract<FrameSample,{validity:'valid'}> {
  const world=Array.from({length:21},()=>({x:0,y:0,z:0}));
  for(const [base,x] of [[5,0],[9,0],[13,.02],[17,.04]] as const)for(let j=0;j<4;j++)world[base+j]={x,y:(base===5?.06:.08)+j*.025,z:0};
  for(let j=1;j<=4;j++)world[j]={x:-.02-j*.01,y:j*.015,z:0};
  const parsed=FrameSampleSchema.parse({sequence,captureTimeMs,selectedHand:hand,validity:'valid',handedness:{label:hand,confidence:1},worldLandmarks:world,imageLandmarks:world.map(p=>({x:.5+p.x*1000/640,y:.8-p.y*1000/360,z:0}))});
  if(parsed.validity!=='valid')throw new Error('Synthetic fixture must be present');return parsed;
}
/** 60 seconds at 20 Hz; starts open/stable, then alternates target entry and release.
 * These are source observations; calibration, dwell, attempts and reps are computed by the real engines.
 */
export const syntheticFrames:readonly FrameSample[]=Array.from({length:1201},(_,sequence)=>{
  const captureTimeMs=sequence*50,frame=syntheticHandFrame(captureTimeMs,sequence);
  const release=captureTimeMs>=7000&&Math.floor(captureTimeMs/1000)%2===1;
  return release?FrameSampleSchema.parse({...frame,imageLandmarks:frame.imageLandmarks.map((p,i)=>i===8?{...p,x:p.x+.15}:p)}):frame;
});
