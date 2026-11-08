import { describe,it,expect,vi } from 'vitest';
import { createSessionController } from '../../engine/sessionController';
import type { AdapterEvent,SessionAdapter } from '../../engine/contracts';
import type { AudioAdapter,AudioDiagnostics,AudioEvent } from '../../adapters/audio';
import { handFrame } from './helpers';
import { createReplayAdapter } from '../../adapters/replay';
function fixture(){
  let shift=0,time=0,sequence=0,audioSequence=0,sink:(event:AdapterEvent)=>void=()=>{},audioSink:(event:AudioEvent)=>void=()=>{};
  const ready:AudioDiagnostics={state:'ready',message:'Artificial quiet calibration',sampleRate:48000,settings:'synthetic',clock:{audioTimeSeconds:0,sessionTimeMs:0,uncertaintyMs:3},level:null};
  const audio:AudioAdapter={start:async emit=>{audioSink=emit;emit({type:'audio_status',diagnostics:ready});},reset:vi.fn(),stop:vi.fn(),dispose:vi.fn(),getDiagnostics:()=>ready};
  const adapter:SessionAdapter={source:'live',prepare:async()=>{},play:emit=>{sink=emit;},getVideo:()=>({videoWidth:1000,videoHeight:1000}) as HTMLVideoElement,stop:vi.fn(),dispose:vi.fn()};
  const c=createSessionController(adapter,undefined,()=>time,undefined,audio);
  function frame(lift=0){time+=50;const f=handFrame(time,sequence++);sink({type:'frame',sample:{...f,imageLandmarks:f.imageLandmarks.map((p,i)=>({...p,x:p.x+shift/1000,y:p.y-(i===8?lift/1000:0)}))}});}
  function impulse(t:number,seq=audioSequence++){audioSink({type:'audio',impulse:{sequence:seq,sampleTimeMs:t,rms:.2}});}
  async function visualSetup(){c.selectExercise({exercise:'desk_tap',sensorMode:'fused'});await c.startDevices();await c.startMicrophone();c.calibrate();for(let i=0;i<=60;i++)frame();c.placeDeskRing({x:500,y:665},{width:1000,height:1000});c.captureDeskRest();for(let i=0;i<=10;i++)frame();for(let i=0;i<3;i++){c.beginDeskCycle();for(const lift of [0,0,0,15,30,30,15,0,0,0])frame(lift);c.saveDeskCycle();}c.finishDeskCalibration();}
  function pair(order:'audio'|'visual'='audio',duplicate=false){
    c.beginTimingPair();frame();frame(30);frame(15);frame();const contact=time;
    time+=25;if(order==='audio')impulse(contact+25);frame();if(order==='visual')impulse(contact+25);
    if(duplicate)impulse(contact+25);
    for(let i=0;i<7;i++)frame();c.saveTimingPair();return contact;
  }
  async function calibrated(){await visualSetup();for(let i=0;i<3;i++)pair(i%2?'visual':'audio');c.finishTimingCalibration();}
  function countdown(){c.startExercise();for(let i=0;i<60;i++)frame();}
  return {c,audio,adapter,setShift:(next:number)=>{shift=next;},frame,impulse,pair,visualSetup,calibrated,countdown,now:()=>time,setTime:(t:number)=>{time=t;},status:(state:AudioDiagnostics['state'])=>audioSink({type:'audio_status',diagnostics:{...ready,state}})};
}
describe('audio / visual controller orchestration (artificial devices only)',()=>{
  it('requires distinct quiet and paired calibration; learns real supplied offset and rejects ambiguous windows',async()=>{
    const h=fixture();await h.visualSetup();expect(h.c.getSnapshot()).toMatchObject({phase:'calibrating',calibration:null,fusion:{timingRequired:true}});
    expect(h.audio.reset).not.toHaveBeenCalled(); // palm setup preserves completed quiet calibration
    h.pair('audio',true);expect(h.c.getSnapshot()).toMatchObject({fusion:{timingPairs:0,timingRecording:false},calibrationMessage:expect.stringContaining('Ambiguous')});
    for(let i=0;i<3;i++)h.pair();h.c.finishTimingCalibration();
    expect(h.c.getSnapshot()).toMatchObject({phase:'calibrated',calibration:{sensorMode:'fused',audio:{offsetMs:25,residualSpreadMs:0}}});h.c.dispose();
  });
  it.each(['audio','visual'] as const)('fuses %s-first exactly once; keeps counts distinct and rejects delayed callbacks after reset',async order=>{
    const h=fixture();await h.calibrated();h.countdown();h.frame(30);h.frame(15);h.frame();const contact=h.now();
    h.setTime(contact+25);if(order==='audio')h.impulse(contact+25,10);h.frame();if(order==='visual')h.impulse(contact+25,10);
    expect(h.c.getSnapshot()).toMatchObject({phase:'running',metrics:{acceptedCount:null},fusion:{visualCount:1,audioCount:1,fusedCount:1,lastFused:{deltaMs:0}},desk:{visualCandidateCount:1,acceptedTapCount:1,lastAccepted:{mode:'fused',position:{x:500,y:665}}}});
    h.impulse(contact+25,10);for(let i=0;i<5;i++)h.frame();expect(h.c.getSnapshot().fusion.fusedCount).toBe(1);
    h.c.reset();h.impulse(contact+25,11);expect(h.c.getSnapshot()).toMatchObject({phase:'idle',calibration:null,fusion:{fusedCount:0}});expect(h.audio.stop).toHaveBeenCalled();h.c.dispose();expect(h.audio.dispose).toHaveBeenCalled();
  });
  it.each(['audio','visual'] as const)('recognizes alternating LEFT/RIGHT pads with %s-first delivery and unique cycles',async order=>{
    const h=fixture();h.c.setDeskLayout('left_right');await h.visualSetup();
    expect(h.c.getSnapshot()).toMatchObject({deskLayout:'left_right',phase:'calibrating',desk:{placing:true,pads:[{id:'left'}]},fusion:{timingRequired:false}});
    h.setShift(-250);h.frame();h.c.placeDeskRing({x:750,y:665},{width:1000,height:1000});h.c.captureDeskRest();
    for(let i=0;i<=10;i++)h.frame();
    for(let i=0;i<3;i++){h.c.beginDeskCycle();for(const lift of [0,0,0,15,30,30,15,0,0,0])h.frame(lift);h.c.saveDeskCycle();}
    h.c.finishDeskCalibration();expect(h.c.getSnapshot()).toMatchObject({desk:{pads:[{id:'left'},{id:'right'}]},fusion:{timingRequired:true}});
    for(let i=0;i<3;i++){h.setShift(i%2?-250:0);h.pair();}
    h.c.finishTimingCalibration();expect(h.c.getSnapshot().phase).toBe('calibrated');h.countdown();
    for(const [i,shift] of [0,-250,0,-250].entries()){
      h.setShift(shift);h.frame();h.frame(30);h.frame(15);h.frame();const contact=h.now();h.setTime(contact+25);
      if(order==='audio')h.impulse(contact+25,100+i);h.frame();if(order==='visual')h.impulse(contact+25,100+i);
      expect(h.c.getSnapshot()).toMatchObject({phase:'running',desk:{acceptedTapCount:i+1,lastAccepted:{pad:shift===0?'left':'right',position:{x:500+shift,y:665}}}});
      h.impulse(contact+25,100+i);for(let j=0;j<4;j++)h.frame();
      expect(h.c.getSnapshot().desk?.acceptedTapCount).toBe(i+1);
    }
    expect(h.c.getSnapshot().desk).toMatchObject({leftTapCount:2,rightTapCount:2});
    h.c.setDeskLayout('single');expect(h.c.getSnapshot()).toMatchObject({deskLayout:'single',calibration:null,desk:null,fusion:{fusedCount:0}});h.c.dispose();
  });
  it('preserves microphone readiness across visual calibration loss and cancellation',async()=>{
    const h=fixture();await h.visualSetup();
    // A healthy microphone does not need a new quiet interval when the camera becomes stale.
    h.setTime(h.now()+121);h.c.tick();
    expect(h.c.getSnapshot()).toMatchObject({phase:'ready',calibration:null,desk:null,audio:{state:'ready'},fusion:{timingPairs:0}});
    expect(h.audio.reset).not.toHaveBeenCalled();
    h.frame();h.c.calibrate();for(let i=0;i<=60;i++)h.frame();h.c.cancelCalibration();
    expect(h.c.getSnapshot().audio.state).toBe('ready');expect(h.audio.reset).not.toHaveBeenCalled();
    h.impulse(NaN);expect(h.audio.reset).toHaveBeenCalledTimes(1);h.c.dispose();
  });
  it('microphone loss aborts fused mode, preserves camera owner and requires explicit kinematic selection',async()=>{
    const h=fixture();await h.calibrated();h.countdown();h.status('unavailable');
    expect(h.c.getSnapshot()).toMatchObject({phase:'ready',selection:{sensorMode:'fused'},calibration:null,audio:{state:'unavailable'},fusion:{fusedCount:0}});
    expect(h.adapter.stop).toHaveBeenCalledTimes(1); // selection reset only; no extra camera stop from audio loss
    h.frame();expect(h.c.getSnapshot().tracking).toBe('valid');h.c.calibrate();expect(h.c.getSnapshot().calibrationStatus).toBe('unavailable');
    h.c.selectExercise({exercise:'desk_tap',sensorMode:'kinematic_only'});expect(h.c.getSnapshot()).toMatchObject({phase:'ready',selection:{sensorMode:'kinematic_only'}});h.frame();expect(h.c.getSnapshot().tracking).toBe('valid');expect(h.adapter.stop).toHaveBeenCalledTimes(1);h.c.dispose();
  });
  it('times out a guided pair, clears pending matches on hide/cancel/mode change and keeps traces bounded',async()=>{
    const h=fixture();await h.visualSetup();h.c.beginTimingPair();for(let i=0;i<101;i++)h.frame();h.c.tick();expect(h.c.getSnapshot().fusion.timingRecording).toBe(false);
    for(let i=0;i<3;i++)h.pair();h.c.finishTimingCalibration();h.countdown();
    for(let i=0;i<40;i++)h.impulse(h.now(),100+i);expect(h.c.getSnapshot().fusion.trace.length).toBe(32);
    h.c.setHidden(true);expect(h.c.getSnapshot()).toMatchObject({phase:'ready',calibration:null,fusion:{trace:[]}});expect(h.audio.stop).toHaveBeenCalled();h.c.dispose();
  });
  it('settles capture-eligible late matches into immutable results and excludes the exact deadline',async()=>{
    const h=fixture();await h.calibrated();h.countdown();const start=h.now();
    while(h.now()<start+14800)h.frame();h.frame(30);h.frame(15);h.frame();const contact=h.now();h.frame();
    expect(contact).toBe(start+14950);expect(h.c.getSnapshot().desk?.acceptedTapCount).toBe(0);
    h.setTime(start+15100);h.impulse(contact+25,999);h.c.tick();
    expect(h.c.getSnapshot()).toMatchObject({phase:'complete',result:null,desk:{acceptedTapCount:1,lastAccepted:{atMs:start+15100}}});
    h.setTime(start+15250);h.c.tick();expect(h.c.getSnapshot().result).toBeNull();
    h.setTime(start+15251);h.c.tick();const result=h.c.getSnapshot().result;
    expect(result).toMatchObject({status:'completed',durationSeconds:15,metrics:{acceptedTapCount:1,verifiedTapCount:1,earlyHz:0,lateHz:.2,rateChangePct:null}});
    h.impulse(start+15000,1000);h.c.tick();expect(h.c.getSnapshot().result).toEqual(result);h.c.dispose();
  });
  it('runs labeled replay diagnostics through the same matcher in both orders without contributing to air reps',async()=>{
    vi.useFakeTimers();try{
      const now=()=>Date.now(),c=createSessionController(createReplayAdapter(now),undefined,now);await c.startDevices();c.calibrate();await vi.advanceTimersByTimeAsync(7000);
      expect(c.getSnapshot()).toMatchObject({source:'synthetic_replay',metrics:{acceptedCount:null},fusion:{visualCount:3,audioCount:3,fusedCount:2}});
      c.reset();expect(c.getSnapshot().fusion.trace).toEqual([]);c.dispose();expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });
});
