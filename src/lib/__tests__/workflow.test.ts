import {describe,it,expect,vi} from 'vitest';
import {createReplayAdapter} from '../../adapters/replay';
import {createSessionController} from '../../engine/sessionController';
import {parseTelemetryJson,telemetryJson} from '../../engine/telemetry';
import type {SessionController} from '../../engine/contracts';
async function setup(mode:'fused'|'kinematic_only'){
 const c=createSessionController(createReplayAdapter(()=>Date.now()),undefined,()=>Date.now());c.selectExercise({exercise:'desk_tap',sensorMode:mode});await c.startDevices();c.calibrate();await vi.advanceTimersByTimeAsync(3000);
 c.placeDeskRing({x:320,y:153},{width:640,height:360});c.captureDeskRest();await vi.advanceTimersByTimeAsync(550);
 for(let i=0;i<3;i++){c.beginDeskCycle();c.replayTap();await vi.advanceTimersByTimeAsync(750);c.saveDeskCycle();}
 c.finishDeskCalibration();
 if(mode==='fused'){for(let i=0;i<3;i++){c.beginTimingPair();c.replayTap();await vi.advanceTimersByTimeAsync(750);c.saveTimingPair();}c.finishTimingCalibration();}
 expect(c.getSnapshot()).toMatchObject({phase:'calibrated',calibration:{sensorMode:mode}});return c;
}
async function tick(c:SessionController,ms:number){for(let n=0;n<ms;n+=50){await vi.advanceTimersByTimeAsync(Math.min(50,ms-n));c.tick();}}
describe('P0 end-to-end controller with artificial source observations',()=>{
 it.each(['fused','kinematic_only'] as const)('calibrates, counts one released contact, completes, exports and resets %s',async mode=>{
  vi.useFakeTimers();try{
   const c=await setup(mode);c.startExercise();await tick(c,3000);c.replayTap();await tick(c,750);
   expect(c.getSnapshot()).toMatchObject({phase:'running',desk:{acceptedTapCount:1,lastAccepted:{mode}}});
   await tick(c,2000);expect(c.getSnapshot().desk?.acceptedTapCount).toBe(1);
   await tick(c,12250);expect(c.getSnapshot().phase).toBe('complete');expect(c.getSnapshot().result).toBeNull();
   await tick(c,300);const result=c.getSnapshot().result!;expect(result).toMatchObject({source:'synthetic_replay',status:'completed',durationSeconds:15,metrics:{acceptedTapCount:1,verifiedTapCount:mode==='fused'?1:0,kinematicTapCount:mode==='fused'?0:1,earlyHz:.2,lateHz:0,rateChangePct:-100}});
   expect(parseTelemetryJson(telemetryJson(result))).toEqual(result);
   c.reset();expect(c.getSnapshot()).toMatchObject({phase:'ready',result:null,calibration:null,desk:null});c.dispose();expect(vi.getTimerCount()).toBe(0);
  }finally{vi.useRealTimers();}
 });
 it.each(['hide','stop','mode','cancel','stale'] as const)('retains a labeled aborted result on %s and rejects old events',async reason=>{
  vi.useFakeTimers();try{
   const c=await setup('fused');c.startExercise();await tick(c,3000);c.replayTap();await tick(c,750);
   if(reason==='hide')c.setHidden(true);if(reason==='stop')c.stop();if(reason==='mode')c.selectExercise({exercise:'desk_tap',sensorMode:'kinematic_only'});if(reason==='cancel')c.cancelCalibration();if(reason==='stale'){await vi.advanceTimersByTimeAsync(200);vi.setSystemTime(Date.now()+200);c.tick();}
   expect(c.getSnapshot().result).toMatchObject({sensorMode:'fused',status:'aborted',metrics:{acceptedTapCount:1,earlyHz:null,lateHz:null,rateChangePct:null}});
   const result=c.getSnapshot().result;await tick(c,1000);expect(c.getSnapshot().result).toEqual(result);expect(c.getSnapshot().calibration).toBeNull();c.reset();expect(c.getSnapshot().result).toBeNull();c.dispose();
  }finally{vi.useRealTimers();}
 });
});
