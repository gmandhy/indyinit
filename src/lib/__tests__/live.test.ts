import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveAdapter } from '../../adapters/live';
import type { LiveDependencies } from '../../adapters/live';
import { createSessionController } from '../../engine/sessionController';
import type { AdapterEvent, SessionAdapter } from '../../engine/contracts';
import { syntheticHandFrame } from '../../../fixtures/syntheticHand';
function deferred<T>() { let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; }
function setup(){
  vi.stubGlobal('navigator',{userAgent:'Test browser'});vi.stubGlobal('MediaStream',class MediaStream {});
  const video={videoWidth:640,videoHeight:480,srcObject:null} as HTMLVideoElement;
  const camera={video,open:vi.fn(async()=>{}),close:vi.fn()};
  const vision={ready:{type:'ready' as const,delegate:'CPU' as const,fallbackReason:'GPU unavailable',probeDurationMs:10},infer:vi.fn(),dispose:vi.fn()};
  const deps:LiveDependencies={now:()=>0,camera:()=>camera,vision:async()=>vision,assets:vi.fn(async()=> 'checksums verified'),schedule:vi.fn(()=>vi.fn()),bitmap:vi.fn()};
  return {deps,camera,vision};
}
afterEach(()=>vi.unstubAllGlobals());
describe('live preparation lifecycle',()=>{
  it('never requests devices during construction; releases all resources on repeatable stop/reset/dispose',async()=>{
    const t=setup(),adapter=createLiveAdapter(t.deps);expect(t.camera.open).not.toHaveBeenCalled();
    await adapter.prepare();adapter.play(vi.fn());adapter.stop();expect(t.camera.close).toHaveBeenCalled();expect(t.vision.dispose).toHaveBeenCalled();
    await adapter.prepare();adapter.play(vi.fn());adapter.dispose();adapter.dispose();await expect(adapter.prepare()).rejects.toThrow(/disposed/);
  });
  it('rejects missing assets before permissions and closes resources from late vision initialization',async()=>{
    const t=setup();t.deps.assets=async()=>{throw new Error('Invalid asset /models/hand_landmarker.task. Run npm run assets:prepare');};
    const adapter=createLiveAdapter(t.deps);await expect(adapter.prepare()).rejects.toThrow(/assets:prepare/);expect(t.camera.open).not.toHaveBeenCalled();expect(adapter.getDiagnostics?.().assets).toBe('missing');
    t.deps.assets=async()=> 'verified';const delayed=deferred<typeof t.vision>();t.deps.vision=()=>delayed.promise;
    const pending=adapter.prepare();await Promise.resolve();await Promise.resolve();adapter.stop();delayed.resolve(t.vision);await pending;
    expect(t.vision.dispose).toHaveBeenCalledTimes(1);expect(adapter.getVideo?.()).toBeNull();adapter.dispose();
  });
  it('keeps asynchronous preparation device errors visible instead of returning a false ready state',async()=>{
    const t=setup();t.deps.camera=fault=>({...t.camera,open:async()=>{fault('Camera source dimensions changed');}});
    const adapter=createLiveAdapter(t.deps);await expect(adapter.prepare()).rejects.toThrow(/dimensions changed/);expect(adapter.getVideo?.()).toBeNull();
  });
  it('isolates Strict Mode replacement owners from late permission completion',async()=>{
    const first=setup(),pending=deferred<void>();first.camera.open=vi.fn(()=>pending.promise);
    const old=createLiveAdapter(first.deps),preparation=old.prepare();await Promise.resolve();old.dispose();
    const next=setup(),replacement=createLiveAdapter(next.deps);await replacement.prepare();pending.resolve();await preparation;
    expect(old.getVideo?.()).toBeNull();expect(replacement.getVideo?.()).toBe(next.camera.video);replacement.dispose();
  });
});
describe('controller live geometry boundary',()=>{
  it('streams before calibration, uses actual dimensions, calibrates both hands, and stops on reset',async()=>{
    for(const hand of ['Left','Right'] as const){
      let now=0,sink:(e:AdapterEvent)=>void=()=>{};
      const video={videoWidth:1280,videoHeight:720} as HTMLVideoElement;
      const adapter:SessionAdapter={source:'live',prepare:async()=>{},getVideo:()=>video,play:emit=>{sink=emit;},stop:vi.fn(),dispose:vi.fn()};
      const c=createSessionController(adapter,undefined,()=>now);await c.startDevices();
      expect(c.frameBuffer.media).toBe(video);expect(c.frameBuffer.video).toEqual({width:1280,height:720});
      sink({type:'frame',sample:syntheticHandFrame(now,0,hand)});expect(c.getSnapshot().tracking).toBe('valid');
      c.calibrate();for(let i=1;i<=62;i++){now=i*50;sink({type:'frame',sample:syntheticHandFrame(now,i,hand)});}
      expect(c.getSnapshot()).toMatchObject({phase:'calibrated',calibration:{hand,video:{width:1280,height:720}},metrics:{estimatedPipDeg:0}});
      c.startExercise();expect(c.getSnapshot().phase).toBe('countdown');
      c.reset();expect(c.getSnapshot()).toMatchObject({phase:'idle',calibration:null,tracking:'not_started'});expect(c.frameBuffer.media).toBeNull();
      now+=50;sink({type:'frame',sample:syntheticHandFrame(now,80,hand)});expect(c.frameBuffer.current).toBeNull();c.dispose();
    }
  });
  it('throttles repeated math failures instead of rendering an error once per inference',async()=>{
    let now=0,sink:(e:AdapterEvent)=>void=()=>{};
    const adapter:SessionAdapter={source:'live',prepare:async()=>{},getVideo:()=>({videoWidth:640,videoHeight:360} as HTMLVideoElement),play:emit=>{sink=emit;},stop:vi.fn(),dispose:vi.fn()};
    const c=createSessionController(adapter,undefined,()=>now);await c.startDevices();const listener=vi.fn();c.subscribe(listener);
    for(let i=0;i<60;i++){now=i*1000/60;const sample=syntheticHandFrame(now,i);sink({type:'frame',sample:{...sample,worldLandmarks:sample.worldLandmarks.map(p=>({...p,x:0,y:0,z:0}))}});}
    expect(listener.mock.calls.length).toBeLessThanOrEqual(10);expect(c.getSnapshot().tracking).toBe('invalid');expect(c.getSnapshot().metrics.estimatedPipDeg).toBeNull();c.dispose();
  });
  it('throttles ordinary snapshots, clears hand-loss estimates and invalidates stale/hidden calibration',async()=>{
    let now=0,sink:(e:AdapterEvent)=>void=()=>{};
    const adapter:SessionAdapter={source:'live',prepare:async()=>{},getVideo:()=>({videoWidth:640,videoHeight:360} as HTMLVideoElement),play:emit=>{sink=emit;},stop:vi.fn(),dispose:vi.fn()};
    const c=createSessionController(adapter,undefined,()=>now);await c.startDevices();const listener=vi.fn();c.subscribe(listener);
    for(let i=0;i<60;i++){now=i*1000/60;sink({type:'frame',sample:syntheticHandFrame(now,i)});c.tick();}
    expect(listener.mock.calls.length).toBeLessThanOrEqual(10);
    now=1000;sink({type:'frame',sample:{sequence:60,captureTimeMs:now,selectedHand:'Right',validity:'absent',reason:'no_hand'}});
    expect(c.getSnapshot()).toMatchObject({tracking:'absent',metrics:{estimatedPipDeg:null}});
    now=1300;c.tick();expect(c.frameBuffer.current).toBeNull();expect(c.getSnapshot().tracking).toBe('invalid');
    c.calibrate();for(let i=61;i<=122;i++){now+=50;sink({type:'frame',sample:syntheticHandFrame(now,i)});}
    expect(c.getSnapshot().phase).toBe('calibrated');c.setHidden(true);expect(c.getSnapshot().calibration).toBeNull();c.dispose();
  });
});
