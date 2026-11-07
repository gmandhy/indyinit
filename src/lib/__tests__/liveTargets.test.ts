import { describe, expect, it, vi } from 'vitest';
import { createSessionController } from '../../engine/sessionController';
import type { AdapterEvent, SessionAdapter } from '../../engine/contracts';
import { handFrame, rotateWorld } from './helpers';
import { containFit, sourcePixel, sourceToDisplay } from '../coordinates';
function live(){
  let now=0,sequence=0,sink:(event:AdapterEvent)=>void=()=>{};
  const video={videoWidth:1000,videoHeight:1000} as HTMLVideoElement;
  const adapter:SessionAdapter={source:'live',getVideo:()=>video,prepare:async()=>{},play:emit=>{sink=emit;},stop:vi.fn(),dispose:vi.fn()};
  const c=createSessionController(adapter,undefined,()=>now),rest=sourcePixel(500,665),viewport={width:1000,height:600};
  function frame(lift=0,angle=0){now+=50;const f=handFrame(now,sequence++);sink({type:'frame',sample:{...f,worldLandmarks:rotateWorld(f.worldLandmarks,angle,'x'),imageLandmarks:f.imageLandmarks.map((p,i)=>i===8?{...p,y:p.y-lift/1000}:p)}});}
  async function palm(desk=false){if(desk)c.selectExercise({exercise:'desk_tap',sensorMode:'kinematic_only'});await c.startDevices();c.calibrate();for(let i=0;i<=60;i++)frame();}
  function ring(){c.placeDeskRing(sourceToDisplay(rest,containFit({width:1000,height:1000},viewport)),viewport);}
  function restCapture(){c.captureDeskRest();for(let i=0;i<=10;i++)frame();}
  function cycle(){c.beginDeskCycle();for(const lift of [0,0,0,15,30,30,15,0,0,0])frame(lift);c.saveDeskCycle();}
  function countdown(){c.startExercise();for(let i=0;i<60;i++)frame();}
  async function desk(){await palm(true);ring();restCapture();for(let i=0;i<3;i++)cycle();c.finishDeskCalibration();}
  return {c,video,frame,palm,ring,restCapture,cycle,countdown,desk,now:()=>now,setTime:(t:number)=>{now=t;},emit:(event:AdapterEvent)=>sink(event),next:()=>sequence++};
}
describe('live controller targets and visual desk setup with artificial input (no hardware evidence)',()=>{
  it('scores continuous live air dwell exactly once and shows exit/lockout; loss aborts',async()=>{
    const s=live();await s.palm();s.countdown();for(let i=0;i<7;i++)s.frame();
    expect(s.c.getSnapshot()).toMatchObject({phase:'running',metrics:{acceptedCount:1},air:{requiresRelease:true,attempts:1}});
    for(let i=0;i<10;i++)s.frame();expect(s.c.getSnapshot().metrics.acceptedCount).toBe(1);
    s.c.cancelCalibration();await s.palm();s.countdown();s.frame(0,25);
    expect(s.c.getSnapshot().air).toMatchObject({locked:true,blockedAttempts:1,completedReps:0});
    for(let i=0;i<6;i++)s.frame(0,25);expect(s.c.getSnapshot().air?.blockedAttempts).toBe(1);
    s.emit({type:'frame',sample:{validity:'absent',reason:'no_hand',selectedHand:'Right',sequence:s.next(),captureTimeMs:s.now()+1}}); // future samples remain boundary errors
    expect(s.c.getSnapshot().phase).toBe('error');s.c.dispose();
  });
  it('runs guided desk setup, exposes measured calibration, and keeps visual candidates separate from accepted reps',async()=>{
    const s=live();await s.desk();expect(s.c.getSnapshot()).toMatchObject({phase:'calibrated',calibration:{sensorMode:'kinematic_only',desk:{excursionPalmUnits:expect.closeTo(.375)}},desk:{setup:{cycles:3}}});
    s.countdown();s.frame(30);s.frame(15);s.frame();const extremum=s.now();s.frame();
    expect(s.c.getSnapshot()).toMatchObject({phase:'running',metrics:{acceptedCount:null},desk:{visualCandidateCount:1,lastCandidate:{captureTimeMs:extremum}}});
    for(let i=0;i<10;i++)s.frame();expect(s.c.getSnapshot().desk?.visualCandidateCount).toBe(1);
    s.c.cancelCalibration();expect(s.c.getSnapshot()).toMatchObject({phase:'ready',desk:null,calibration:null});expect(s.c.frameBuffer.desk).toBeNull();s.c.dispose();
  });
  it('ring replacement and cancellation clear guided samples, candidate lookahead and counters',async()=>{
    const s=live();await s.palm(true);s.ring();s.restCapture();s.cycle();expect(s.c.getSnapshot().desk?.setup?.cycles).toBe(1);
    s.ring();expect(s.c.getSnapshot().desk?.setup).toMatchObject({stage:'awaiting_rest',cycles:0});
    s.c.cancelCalibration();expect(s.c.getSnapshot()).toMatchObject({phase:'ready',desk:null});
    await s.desk();s.countdown();s.frame(30);s.frame(15);s.frame();expect(s.c.getSnapshot().desk?.visual?.phase).toBe('contactCandidate');
    s.c.cancelCalibration();s.frame();expect(s.c.getSnapshot().desk).toBeNull();s.c.dispose();
  });
  it('invalidates desk calibration/pending contacts on loss, stall, hide, hand/scale/geometry change and stop',async()=>{
    for(const kind of ['loss','stall','hide','hand','scale','geometry','stop'] as const){
      const s=live();await s.desk();s.countdown();s.frame(30);s.frame(15);s.frame();
      if(kind==='loss'){s.setTime(s.now()+1);s.emit({type:'frame',sample:{sequence:s.next(),captureTimeMs:s.now(),selectedHand:'Right',validity:'absent',reason:'no_hand'}});}
      if(kind==='stall'){s.setTime(s.now()+121);s.c.tick();}
      if(kind==='hide')s.c.setHidden(true);
      if(kind==='hand'){s.setTime(s.now()+50);s.emit({type:'frame',sample:handFrame(s.now(),s.next(),'Left')});}
      if(kind==='scale'){s.setTime(s.now()+50);const f=handFrame(s.now(),s.next());s.emit({type:'frame',sample:{...f,imageLandmarks:f.imageLandmarks.map(p=>({...p,y:.8-(.8-p.y)*2}))}});}
      if(kind==='geometry')s.emit({type:'error',message:'Camera source geometry changed'});
      if(kind==='stop')s.c.stop();
      expect(s.c.getSnapshot().calibration,kind).toBeNull();expect(s.c.getSnapshot().desk,kind).toBeNull();expect(s.c.frameBuffer.desk).toBeNull();s.c.dispose();
    }
  });
  it('rejects stale recording commands, impossible ring placement, and fused calibration in phase 4',async()=>{
    const s=live();await s.palm(true);s.c.placeDeskRing({x:0,y:0},{width:1000,height:600});expect(s.c.getSnapshot().calibrationMessage).toMatch(/letterbox/);
    s.c.placeDeskRing({x:205,y:5},{width:1000,height:600});expect(s.c.getSnapshot().calibrationMessage).toMatch(/fully inside/);
    s.ring();s.setTime(s.now()+121);s.c.captureDeskRest();expect(s.c.getSnapshot()).toMatchObject({phase:'ready',desk:null});
    s.c.selectExercise({exercise:'desk_tap',sensorMode:'fused'});await s.c.startDevices();s.c.calibrate();expect(s.c.getSnapshot().calibrationStatus).toBe('unavailable');s.c.dispose();
  });
  it('allows only contact extrema inside the fixed trial, including bounded post-deadline confirmation',async()=>{
    const s=live();await s.desk();s.countdown();const start=s.now();
    while(s.now()<start+14900)s.frame();s.frame(30);s.frame(0);const contact=s.now(); // contact at end - 0? see boundary below
    expect(contact).toBe(start+15000);
    s.frame();expect(s.c.getSnapshot().desk?.visualCandidateCount).toBe(0); // deadline is exclusive
    s.c.dispose();
    const t=live();await t.desk();t.countdown();const begins=t.now();
    while(t.now()<begins+14850)t.frame();t.frame(30);t.frame(0);const extremum=t.now();t.frame();
    expect(t.c.getSnapshot()).toMatchObject({phase:'complete',desk:{visualCandidateCount:1,lastCandidate:{captureTimeMs:extremum}}});t.c.dispose();
  });
});
