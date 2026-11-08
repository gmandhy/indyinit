import { describe, expect, it } from 'vitest';
import { createGuidedRoutine, ROUTINE_CONFIG, routineMotion } from '../guidedRoutine';
import { handFrame } from './helpers';
import { WorldLandmarkSchema } from '../schemas';
import type { FrameSample } from '../schemas';
function harness(task:number) {
  const engine=createGuidedRoutine(task);let time=0,sequence=0;
  function frame(curled=false,tilt=0,roll=0,bendDeg=curled?90:0):Extract<FrameSample,{validity:'valid'}> {
    const sample=handFrame(time,sequence++);
    const points:{x:number;y:number;z:number}[]=sample.worldLandmarks.map(p=>({...p}));
    if(bendDeg)for(const base of [5,9,13,17]){
      const pip=points[base+1]!;
      const bend=bendDeg*Math.PI/180;
      points[base+2]={x:pip.x,y:pip.y+.025*Math.cos(bend),z:.025*Math.sin(bend)};points[base+3]={x:pip.x,y:pip.y+.05*Math.cos(bend),z:.05*Math.sin(bend)};
    }
    const a=tilt*Math.PI/180,b=roll*Math.PI/180;
    const worldLandmarks=points.map(p=>{
      const y=p.y*Math.cos(a)-p.z*Math.sin(a),z=p.y*Math.sin(a)+p.z*Math.cos(a);
      return WorldLandmarkSchema.parse({x:p.x*Math.cos(b)-y*Math.sin(b),y:p.x*Math.sin(b)+y*Math.cos(b),z});
    });
    return {...sample,worldLandmarks,imageLandmarks:sample.imageLandmarks.map(p=>({...p,y:.8-(.8-p.y)*2}))};
  }
  const observe=(sample:FrameSample|null)=>engine.observe(sample,time,{width:640,height:480});
  const hold=(curled:boolean,ms:number,tilt=0,roll=0)=>{for(let i=0;i<=ms/50;i++){time+=50;observe(frame(curled,tilt,roll));}return engine.getState();};
  return {engine,frame,observe,hold,advance:(ms:number)=>{time+=ms;},time:()=>time};
}
describe('automatic guided practice',()=>{
  it.each([0,1])('counts task %i only after start, continuous hold, and return; completes two sets',task=>{
    const h=harness(task),rest=task===0,target=!rest;
    h.hold(rest,350);expect(h.engine.getState().stage).toBe('ready');
    for(let rep=1;rep<=10;rep++){
      h.hold(target,task===0?2050:550);expect(h.engine.getState().stage).toBe('return');
      h.hold(target,500);expect(h.engine.getState().total).toBe(rep-1);
      h.hold(rest,350);expect(h.engine.getState().total).toBe(rep);
      if(rep===5)expect(h.engine.getState()).toMatchObject({set:2,reps:0,complete:false});
    }
    expect(h.engine.getState()).toMatchObject({complete:true,set:2,reps:5});
    h.hold(target,2500);h.hold(rest,500);expect(h.engine.getState().total).toBe(10);
  });
  it('starts Open Hand directly and keeps current/next cues stable through threshold jitter',()=>{
    const h=harness(0);
    expect(routineMotion(h.engine.getState())).toMatchObject({now:'Open hand',next:'Close hand'});
    h.advance(50);h.observe(h.frame(false,0,0,25));
    for(let i=0;i<40;i++){
      h.advance(50);h.observe(h.frame(false,0,0,i%2?32:38));
      if(i<39)expect(routineMotion(h.engine.getState())).toMatchObject({now:'Hold open',next:'Close hand'});
    }
    expect(h.engine.getState().stage).toBe('return');
    expect(routineMotion(h.engine.getState())).toMatchObject({now:'Close hand',next:'Open hand'});
    h.hold(true,350);expect(h.engine.getState().total).toBe(1);
  });
  it('holds a recognized curl through small angle jitter, but rejects a genuinely partial pose',()=>{
    const h=harness(1);h.hold(false,350);h.advance(50);h.observe(h.frame(true));
    for(let i=0;i<10;i++){h.advance(50);h.observe(h.frame(true,0,0,i%2?52:58));}
    expect(h.engine.getState().stage).toBe('return');h.hold(false,350);expect(h.engine.getState().total).toBe(1);
    for(let i=0;i<15;i++){h.advance(50);h.observe(h.frame(false,0,0,45));}
    expect(h.engine.getState().stage).toBe('ready');expect(h.engine.getState().total).toBe(1);
  });
  it('does not count a partial curl of only one finger',()=>{
    const h=harness(1);h.hold(false,350);
    for(let i=0;i<20;i++){
      h.advance(50);const open=h.frame(),curl=h.frame(true);
      h.observe({...open,worldLandmarks:open.worldLandmarks.map((p,i)=>i>=5&&i<=8?curl.worldLandmarks[i]!:p)});
    }
    expect(h.engine.getState().message).toMatch(/all four/);
    h.hold(false,400);expect(h.engine.getState().total).toBe(0);
  });
  it('resets an incomplete hold on loss, stale data, pause, or hand switch',()=>{
    for(const reason of ['loss','stale','pause','switch'] as const){
      const h=harness(0);h.hold(true,350);h.hold(false,1000);
      if(reason==='loss')h.observe(null);
      if(reason==='stale'){const old=h.frame();h.advance(ROUTINE_CONFIG.openHoldMs);h.observe(old);}
      if(reason==='pause')h.engine.suspend('paused');
      if(reason==='switch'){h.advance(50);h.observe({...h.frame(),selectedHand:'Left',handedness:{label:'Left',confidence:1}});}
      h.hold(false,2500);h.hold(true,350);expect(h.engine.getState().total).toBe(0);
    }
  });
  it('cannot use repeated samples or wall-clock gaps to finish a hold',()=>{
    const h=harness(1);h.hold(false,350);h.advance(50);const f=h.frame(true);h.observe(f);
    h.advance(100);h.observe(f);expect(h.engine.getState().stage).toBe('holding');
    h.advance(1000);h.observe(h.frame(true));h.hold(false,400);expect(h.engine.getState().total).toBe(0);
  });
  it.each([2,3])('counts task %i as palm tilt/return proxy, rejects roll, and finishes 20 cycles',task=>{
    const h=harness(task);h.hold(false,1100);
    h.hold(false,700,0,30);h.hold(false,400);expect(h.engine.getState().total).toBe(0);
    for(let i=1;i<=20;i++){
      h.hold(false,550,25);h.hold(false,350);expect(h.engine.getState().total).toBe(i);
    }
    expect(h.engine.getState()).toMatchObject({complete:true,reps:10,set:2});
  });
  it('restarts neutral calibration after hand translation or a scale change',()=>{
    for(const change of ['translate','scale'] as const){
      const h=harness(2);h.hold(false,1100);h.advance(50);const sample=h.frame();
      const origin=sample.imageLandmarks[0]!;
      h.observe({...sample,imageLandmarks:sample.imageLandmarks.map(p=>({...p,x:change==='translate'?p.x+.15:p.x,y:change==='scale'?origin.y+(p.y-origin.y)*1.4:p.y}))});
      expect(h.engine.getState()).toMatchObject({stage:'setup',total:0});
      expect(h.engine.getState().message).toMatch(/neutral/);
    }
  });
  it('can restart capture sequences after stopping and retains completed reps',()=>{
    const h=harness(1);h.hold(false,350);h.hold(true,550);h.hold(false,350);
    expect(h.engine.getState().total).toBe(1);h.observe(null);h.advance(50);
    const fresh={...h.frame(),sequence:0};h.observe(fresh);
    expect(h.engine.getState()).toMatchObject({stage:'setup',total:1});
    expect(h.engine.getState().message).toMatch(/Hold briefly/);
  });
  it('requires stable neutral, visible full-size hand, confidence and valid math',()=>{
    const h=harness(2);h.hold(false,500);h.hold(false,200,25);expect(h.engine.getState().stage).toBe('setup');
    h.advance(50);const f=h.frame();
    h.observe({...f,handedness:{label:'Right',confidence:.1}});expect(h.engine.getState().message).toMatch(/clear hand/);
    h.advance(50);h.observe({...h.frame(),imageLandmarks:f.imageLandmarks.map(p=>({...p,x:0}))});expect(h.engine.getState().message).toMatch(/inside/);
    h.advance(50);h.observe({...h.frame(),imageLandmarks:f.imageLandmarks.map(p=>({...p,y:.5}))});expect(h.engine.getState().message).toMatch(/closer/);
    h.advance(50);expect(()=>h.observe({...h.frame(),worldLandmarks:[]})).toThrow(/21/);
    expect(()=>createGuidedRoutine(-1)).toThrow(/task/);
    expect(()=>h.engine.observe(null,NaN,{width:640,height:480})).toThrow(/finite/);
    expect(()=>h.engine.observe(null,0,{width:0,height:480})).toThrow(/dimensions/);
    expect(()=>h.engine.observe(h.frame(),0,{width:640,height:480})).toThrow(/future/);
  });
});
