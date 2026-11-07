import { FrameSampleSchema, WorldLandmarkSchema } from '../schemas';
import type { WorldLandmark } from '../schemas';
/** Anatomically arranged, artificial open hand; no recorded person or hardware evidence. */
export function handFrame(captureTimeMs=0, sequence=0, hand: 'Left'|'Right'='Right') {
  const world = Array.from({length:21},()=>({x:0,y:0,z:0}));
  world[0]={x:0,y:0,z:0};
  for (const [base,x] of [[5,-.03],[9,0],[13,.02],[17,.04]] as const) {
    for(let j=0;j<4;j++) world[base+j]={x,y:.08+j*.025,z:0};
  }
  for(let j=1;j<=4;j++) world[j]={x:-.02-j*.01,y:j*.015,z:0};
  // Index MCP proxy straight as well as PIP/DIP.
  for(let j=0;j<4;j++) world[5+j]={x:0,y:.06+j*.025,z:0};
  return FrameSampleSchema.parse({sequence,captureTimeMs,selectedHand:hand,validity:'valid',handedness:{label:hand,confidence:1},worldLandmarks:world,imageLandmarks:world.map(p=>({x:.5+p.x,y:.8-p.y,z:0}))}) as Extract<ReturnType<typeof FrameSampleSchema.parse>,{validity:'valid'}>;
}
export function rotateWorld(points: readonly WorldLandmark[], degrees: number, axis: 'x'|'y') {
  const c=Math.cos(degrees*Math.PI/180),s=Math.sin(degrees*Math.PI/180);
  return points.map(p=>WorldLandmarkSchema.parse(axis==='x'?{x:p.x,y:c*p.y-s*p.z,z:s*p.y+c*p.z}:{x:c*p.x+s*p.z,y:p.y,z:-s*p.x+c*p.z}));
}
