import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdapterEvent, SessionAdapter } from '../../engine/contracts';
import { createSessionController } from '../../engine/sessionController';
import { createReplayAdapter } from '../../adapters/replay';
import { syntheticHandFrame } from '../../../fixtures/syntheticHand';
function manual() {
  let sink:(event:AdapterEvent)=>void=()=>{},time=0;
  const adapter:SessionAdapter={source:'synthetic_replay',prepare:vi.fn(async()=>{}),play:vi.fn(emit=>{sink=emit;}),stop:vi.fn(),dispose:vi.fn()};
  const c=createSessionController(adapter,undefined,()=>time);
  return {adapter,c,emit:(event:AdapterEvent)=>sink(event),frame:(t:number,sequence:number)=>{time=t;sink({type:'frame',sample:syntheticHandFrame(t,sequence)});},setTime:(t:number)=>{time=t;}};
}
afterEach(()=>vi.useRealTimers());
describe('controller/replay engine boundary without React or devices',()=>{
  it('calibrates and scores real engines, counts one held dwell, then completes a fixed synthetic trial',async()=>{
    vi.useFakeTimers();const now=()=>Date.now();
    const c=createSessionController(createReplayAdapter(now),undefined,now);
    c.startExercise();expect(c.getSnapshot().phase).toBe('idle');
    await c.startDevices();c.calibrate();
    await vi.advanceTimersByTimeAsync(3000);
    expect(c.getSnapshot()).toMatchObject({source:'synthetic_replay',phase:'calibrated',calibrationStatus:'valid',metrics:{estimatedPipDeg:0}});
    c.startExercise();expect(c.getSnapshot().phase).toBe('countdown');
    await vi.advanceTimersByTimeAsync(3300);
    expect(c.getSnapshot()).toMatchObject({phase:'running',metrics:{acceptedCount:1},air:{attempts:1}});
    await vi.advanceTimersByTimeAsync(14700);
    expect(c.getSnapshot()).toMatchObject({phase:'complete',result:null});
    expect(c.getSnapshot().metrics.acceptedCount).toBeGreaterThan(1);
    c.dispose();expect(vi.getTimerCount()).toBe(0);
  });
  it('stops and resets without stale callbacks or cross-selection state',async()=>{
    const m=manual();await m.c.startDevices();m.c.calibrate();m.frame(0,0);
    expect(m.c.getSnapshot().diagnostics.replayFrames).toBe(1);
    m.c.selectExercise({exercise:'desk_tap',sensorMode:'kinematic_only'});m.frame(50,1);
    expect(m.c.getSnapshot()).toMatchObject({phase:'ready',selection:{exercise:'desk_tap',sensorMode:'kinematic_only'},diagnostics:{replayFrames:0},calibration:null});
    expect(m.c.frameBuffer.current).toBeNull();m.c.calibrate();expect(m.c.getSnapshot().calibrationStatus).toBe('collecting');
    m.c.stop();expect(m.c.getSnapshot().phase).toBe('idle');m.c.dispose();m.c.dispose();expect(m.adapter.dispose).toHaveBeenCalledTimes(1);
  });
  it('ignores late initialization after stop/dispose',async()=>{
    let resolve=()=>{};const m=manual();m.adapter.prepare=()=>new Promise<void>(r=>{resolve=r;});
    const pending=m.c.startDevices();m.c.stop();resolve();await pending;expect(m.c.getSnapshot().phase).toBe('idle');
    const next=m.c.startDevices();m.c.dispose();resolve();await next;expect(m.c.getSnapshot().phase).not.toBe('ready');
  });
  it('handles stale input as absence, malformed math visibly, and transport/device faults as recoverable errors',async()=>{
    const m=manual();await m.c.startDevices();m.c.calibrate();m.frame(0,0);m.frame(0,0);
    expect(m.c.getSnapshot()).toMatchObject({phase:'calibrating',tracking:'invalid'});expect(m.c.getSnapshot().message).toMatch(/Stale/);
    const f=syntheticHandFrame(50,1);m.setTime(50);
    m.emit({type:'frame',sample:{...f,worldLandmarks:f.worldLandmarks.map(p=>({...p,x:0,y:0,z:0}))}});
    expect(m.c.getSnapshot()).toMatchObject({phase:'calibrating',tracking:'invalid'});expect(m.c.getSnapshot().message).toMatch(/Invalid math/);
    m.emit({type:'frame',sample:{...f,captureTimeMs:NaN}});expect(m.c.getSnapshot().phase).toBe('error');
    m.c.reset();m.c.stop();m.adapter.prepare=async()=>{throw new Error('Permission denied fixture');};await m.c.startDevices();expect(m.c.getSnapshot().message).toBe('Permission denied fixture');m.c.dispose();
  });
  it('invalidates frozen calibration on hand switch and aborts running on loss',async()=>{
    for(const kind of ['switch','loss'] as const){
      const m=manual();await m.c.startDevices();m.c.calibrate();for(let i=0;i<=60;i++)m.frame(i*50,i);
      expect(m.c.getSnapshot().phase).toBe('calibrated');
      if(kind==='loss'){m.c.startExercise();for(let i=61;i<=120;i++)m.frame(i*50,i);}
      const t=kind==='loss'?6050:3050;m.setTime(t);
      m.emit({type:'frame',sample:kind==='switch'?syntheticHandFrame(t,121,'Left'):{sequence:121,captureTimeMs:t,selectedHand:'Right',validity:'absent',reason:'no_hand'}});
      expect(m.c.getSnapshot()).toMatchObject({phase:'ready',calibration:null,calibrationStatus:'not_started'});m.c.dispose();
    }
  });

  it('uses independent clock ticks to abort stalled input and hidden tabs without silently extending trials',async()=>{
    for(const kind of ['stale','hidden'] as const){
      const m=manual();await m.c.startDevices();m.c.calibrate();for(let i=0;i<=60;i++)m.frame(i*50,i);
      m.c.startExercise();for(let i=61;i<=120;i++)m.frame(i*50,i);
      if(kind==='stale'){m.setTime(6200);m.c.tick();}else m.c.setHidden(true);
      expect(m.c.getSnapshot()).toMatchObject({phase:'ready',calibration:null,target:null});
      expect(m.c.frameBuffer.target).toBeNull();m.c.startExercise();expect(m.c.getSnapshot().phase).toBe('ready');m.c.dispose();
    }
  });
  it('reports missing assets without claiming live evidence and supports two independent views',async()=>{
    const m=manual(),c=createSessionController(m.adapter,async()=>{throw new Error('Missing model; run npm run assets:prepare');},()=>0);
    const a=vi.fn(),b=vi.fn(),unsubscribe=c.subscribe(a);c.subscribe(b);await c.startDevices();
    expect(c.getSnapshot()).toMatchObject({phase:'ready',diagnostics:{assets:'missing'},source:'synthetic_replay'});
    expect(a).toHaveBeenCalledTimes(2);expect(b).toHaveBeenCalledTimes(2);unsubscribe();c.calibrate();expect(a).toHaveBeenCalledTimes(2);expect(b).toHaveBeenCalledTimes(3);c.dispose();
  });
});
