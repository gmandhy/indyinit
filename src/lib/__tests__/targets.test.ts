import { describe, expect, it } from 'vitest';
import { createPalmCalibrator } from '../calibration';
import { createAirTargetEngine, targetCircle } from '../spatialTargets';
import type { AirTarget } from '../spatialTargets';
import { handFrame, rotateWorld } from './helpers';
import { ImageLandmarkSchema } from '../schemas';
function setup() {
  const c=createPalmCalibrator({width:1000,height:1000});
  for(let i=0;i<=60;i++) c.observe(handFrame(i*50,i),i*50);
  const found=c.getState().calibration; if(!found) throw new Error('No calibration');
  const calibration=found;
  let time=4000, sequence=100;
  const target:AirTarget={id:'one',offsetPalmUnits:{longitudinal:1,transverse:0},radiusPalmUnits:.25,requiredLandmarkIndex:8,dwellMs:250};
  const engine=createAirTargetEngine(calibration,[target],()=>time);
  function frame(inside=true,angle=0,axis:'x'|'y'='y') {
    const f=handFrame(time,sequence++), circle=targetCircle(target,calibration,f.imageLandmarks[0]!);
    return {...f,worldLandmarks:rotateWorld(f.worldLandmarks,angle,axis),imageLandmarks:f.imageLandmarks.map((p,i)=>i===8?ImageLandmarkSchema.parse({x:(circle.center.x+(inside?0:100))/1000,y:circle.center.y/1000,z:0}):p)};
  }
  return {engine,calibration,target,frame,advance:(dt=50)=>{time+=dt;},now:()=>time};
}
describe('continuous air attempts', () => {
  it('counts one dwell, requires exit, then allows another score with translated fixed-basis targets', () => {
    const s=setup();
    for(let i=0;i<=12;i++){s.engine.observe(s.frame());s.advance();}
    expect(s.engine.getState()).toMatchObject({completedReps:1,attempts:1,blockedAttempts:0,requiresRelease:true});
    s.engine.observe(s.frame(false)); s.advance();
    for(let i=0;i<=5;i++){s.engine.observe(s.frame());s.advance();}
    expect(s.engine.getState().completedReps).toBe(2);
    const a=targetCircle(s.target,s.calibration,ImageLandmarkSchema.parse({x:.5,y:.8,z:0}));
    const b=targetCircle(s.target,s.calibration,ImageLandmarkSchema.parse({x:.6,y:.8,z:0}));
    expect(b.center.x-a.center.x).toBeCloseTo(100); expect(b.center.y).toBe(a.center.y);
  });
  it('resets dwell on exit, absence, stale sequence, stale age and gaps without duplicate scoring', () => {
    for(const kind of ['exit','absence','sequence','age','gap'] as const) {
      const s=setup(); const first=s.frame(); s.engine.observe(first); s.advance(100);s.engine.observe(s.frame());
      s.advance(50);
      if(kind==='exit') s.engine.observe(s.frame(false));
      if(kind==='absence') s.engine.observe({sequence:110,captureTimeMs:s.now(),selectedHand:'Right',validity:'absent',reason:'no_hand'});
      if(kind==='sequence') s.engine.observe(first);
      if(kind==='age') { const f=s.frame();s.advance(200);s.engine.observe(f); }
      if(kind==='gap') {s.advance(200);s.engine.tick();}
      s.advance();s.engine.observe(s.frame());s.advance(100);s.engine.observe(s.frame());
      expect(s.engine.getState().completedReps,kind).toBe(0);
    }
  });
  it('counts a blocked attempt and lockout once per episode, with roll/tilt hysteresis', () => {
    const s=setup();s.engine.observe(s.frame());s.advance();
    for(let i=0;i<8;i++){s.engine.observe(s.frame(true,25));s.advance();}
    expect(s.engine.getState()).toMatchObject({attempts:1,blockedAttempts:1,lockoutEvents:1,locked:true,completedReps:0});
    s.engine.observe(s.frame(false,25));s.advance();s.engine.observe(s.frame(true,25));s.advance();
    expect(s.engine.getState().blockedAttempts).toBe(1);
    s.engine.observe(s.frame(false,15));s.advance();expect(s.engine.getState().locked).toBe(true);
    s.engine.observe(s.frame(false,13));s.advance();expect(s.engine.getState().locked).toBe(false);
    s.engine.observe(s.frame(true,25,'x'));
    expect(s.engine.getState()).toMatchObject({attempts:2,blockedAttempts:2,lockoutEvents:2});
  });


  it('advances a multi-target path only after a valid release and keeps image offsets fixed during roll',()=>{
    const s=setup();
    const second={...s.target,id:'two',offsetPalmUnits:{longitudinal:1,transverse:.7}};
    const engine=createAirTargetEngine(s.calibration,[s.target,second],s.now);
    for(let i=0;i<=8;i++){engine.observe(s.frame());s.advance();}
    expect(engine.getState()).toMatchObject({targetId:'one',completedReps:1,attempts:1});
    engine.observe(s.frame(false));s.advance();expect(engine.getState()).toMatchObject({targetId:'two',circle:null});
    const a=engine.observe(s.frame());s.advance();
    const b=engine.observe(s.frame(true,25));expect(b.circle).toEqual(a.circle);
  });
  it('blocks the active attempt when orientation locks on the same sample as exit',()=>{
    const s=setup();s.engine.observe(s.frame());s.advance();s.engine.observe(s.frame(false,25));
    expect(s.engine.getState()).toMatchObject({attempts:1,blockedAttempts:1,lockoutEvents:1});
  });
  it('invalidates calibration on hand/distance/video changes and refuses off-screen targets', () => {
    for(const kind of ['hand','distance','video'] as const) {
      const s=setup(),f=s.frame();
      if(kind==='hand') s.engine.observe({...f,selectedHand:'Left',handedness:{label:'Left',confidence:1}});
      if(kind==='distance') s.engine.observe({...f,imageLandmarks:f.imageLandmarks.map(p=>({...p,y:.8-(.8-p.y)*2}))});
      if(kind==='video') s.engine.invalidate('video_changed');
      expect(s.engine.getState().calibrationValid).toBe(false);
      s.advance();s.engine.observe(s.frame());expect(s.engine.getState().completedReps).toBe(0);
    }
    const s=setup();
    expect(()=>createAirTargetEngine(s.calibration,[{...s.target,radiusPalmUnits:0}],s.now)).toThrow(/radius/);
    expect(()=>targetCircle({...s.target,offsetPalmUnits:{longitudinal:100,transverse:0}},s.calibration,handFrame().imageLandmarks[0]!)).toThrow(/screen/);
  });
});
