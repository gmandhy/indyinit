import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInferencePump, createVisionTransport } from '../../adapters/vision';
import type { VisionWorker } from '../../adapters/vision';
import type { TrackingWorkerResponse } from '../../adapters/visionProtocol';
import { modelSample } from '../../adapters/visionProtocol';
import { syntheticHandFrame } from '../../../fixtures/syntheticHand';
import { createLiveMeasurements } from '../../adapters/liveDiagnostics';
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((a,b)=>{resolve=a;reject=b;}); return { promise, resolve, reject }; }
const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function transport() {
  const abort = new AbortController(), fault = vi.fn();
  const worker: VisionWorker = { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() };
  const probe = bitmap();
  const start = createVisionTransport(abort.signal, fault, { worker: () => worker, probe: async () => probe, origin: 'http://localhost' });
  const emit = (data: TrackingWorkerResponse) => worker.onmessage?.({ data } as MessageEvent<TrackingWorkerResponse>);
  return { abort, worker, probe, fault, start, emit };
}
afterEach(()=>vi.useRealTimers());
describe('worker transport and bounded scheduling',()=>{
  it('requires a transferred bitmap inference probe and preserves sequence/capture timestamps',async()=>{
    const t=transport();t.emit({type:'initialized'});await flush();
    expect(t.worker.postMessage).toHaveBeenCalledWith({type:'probe',bitmap:t.probe},[t.probe]);
    t.emit({type:'ready',delegate:'GPU',fallbackReason:null,probeDurationMs:11});const ready=await t.start;
    const frame={sequence:7,captureTimeMs:33},image=bitmap(),result=ready.infer(image,frame);
    expect(t.worker.postMessage).toHaveBeenLastCalledWith({type:'frame',...frame,bitmap:image},[image]);
    t.emit({type:'sample',sample:syntheticHandFrame(33,7),durationMs:4});expect((await result).sample.captureTimeMs).toBe(33);
    ready.dispose();t.emit({type:'disposed'});expect(t.worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched results, transfer failures and workers stalled at startup/result delivery',async()=>{
    vi.useFakeTimers();
    const startup=transport(),startResult=startup.start.catch(error=>error);await vi.advanceTimersByTimeAsync(30000);
    expect((await startResult).message).toMatch(/30 seconds/);await vi.advanceTimersByTimeAsync(1000);expect(startup.worker.terminate).toHaveBeenCalled();
    for(const failure of ['mismatch','transfer','stalled'] as const){
      const t=transport();t.emit({type:'initialized'});await flush();t.emit({type:'ready',delegate:'CPU',fallbackReason:'GPU failed',probeDurationMs:1});const ready=await t.start;
      const image=bitmap();if(failure==='transfer')vi.mocked(t.worker.postMessage).mockImplementation(()=>{throw new Error('clone failed');});
      const output=ready.infer(image,{sequence:1,captureTimeMs:5}).catch(error=>error);
      if(failure==='mismatch')t.emit({type:'sample',sample:syntheticHandFrame(6,2),durationMs:1});
      if(failure==='stalled')await vi.advanceTimersByTimeAsync(5000);
      expect(await output).toBeInstanceOf(Error);expect(t.fault).toHaveBeenCalledTimes(1);
      if(failure==='transfer')expect(image.close).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts pending startup, closes a late probe bitmap, and terminates even without a disposal ack',async()=>{
    vi.useFakeTimers();const t=transport(),output=t.start.catch(error=>error);
    t.emit({type:'initialized'});t.abort.abort();await flush();
    expect((await output).name).toBe('AbortError');expect(t.probe.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);expect(t.worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects unsupported bitmap creation and readiness that bypasses the actual probe',async()=>{
    vi.useFakeTimers();
    const abort=new AbortController(),worker:VisionWorker={onmessage:null,onerror:null,onmessageerror:null,postMessage:vi.fn(),terminate:vi.fn()};
    const output=createVisionTransport(abort.signal,vi.fn(),{worker:()=>worker,probe:()=>{throw new Error('createImageBitmap unsupported');},origin:'http://localhost'}).catch(error=>error);
    worker.onmessage?.({data:{type:'initialized'}} as MessageEvent<TrackingWorkerResponse>);await flush();
    expect((await output).message).toMatch(/Cannot create bitmap probe/);await vi.advanceTimersByTimeAsync(1000);
    const t=transport(),rejected=t.start.catch(error=>error);t.emit({type:'ready',delegate:'GPU',fallbackReason:null,probeDurationMs:1});
    expect((await rejected).message).toMatch(/before bitmap probe/);await vi.advanceTimersByTimeAsync(1000);expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps at most one bitmap/inference in flight, drops duplicates and stale results',async()=>{
    let now=10;const output=deferred<{sample:ReturnType<typeof syntheticHandFrame>;durationMs:number}>(),make=vi.fn(async()=>bitmap()),receive=vi.fn(),measure=vi.fn(),fault=vi.fn();
    const infer=vi.fn(()=>output.promise),pump=createInferencePump({bitmap:make,infer,now:()=>now,minIntervalMs:0,result:receive,measurement:measure,fault});
    pump.submit({sequence:1,captureTimeMs:10});pump.submit({sequence:2,captureTimeMs:11});await flush();
    expect(make).toHaveBeenCalledTimes(1);expect(infer).toHaveBeenCalledTimes(1);
    now=140;output.resolve({sample:syntheticHandFrame(10,1),durationMs:9});await flush();
    expect(receive).not.toHaveBeenCalled();expect(measure).toHaveBeenCalledWith(9,130,'valid');
    pump.submit({sequence:1,captureTimeMs:10});expect(make).toHaveBeenCalledTimes(1);pump.close();expect(fault).not.toHaveBeenCalled();
  });
  it('closes late bitmap creation after stop and suppresses old results after disposal',async()=>{
    const pending=deferred<ImageBitmap>(),image=bitmap(),infer=vi.fn(),receive=vi.fn();
    const pump=createInferencePump({bitmap:()=>pending.promise,infer,now:()=>20,minIntervalMs:0,result:receive,measurement:vi.fn(),fault:vi.fn()});
    pump.submit({sequence:1,captureTimeMs:10});pump.close();pending.resolve(image);await flush();
    expect(image.close).toHaveBeenCalledTimes(1);expect(infer).not.toHaveBeenCalled();expect(receive).not.toHaveBeenCalled();
  });
  it('ignores inference completing after stop without publishing measurements or samples',async()=>{
    const pending=deferred<{sample:ReturnType<typeof syntheticHandFrame>;durationMs:number}>(),receive=vi.fn(),measure=vi.fn(),fault=vi.fn();
    const pump=createInferencePump({bitmap:async()=>bitmap(),infer:()=>pending.promise,now:()=>50,minIntervalMs:0,result:receive,measurement:measure,fault});
    pump.submit({sequence:1,captureTimeMs:10});await flush();pump.close();pending.resolve({sample:syntheticHandFrame(10,1),durationMs:4});await flush();
    expect(receive).not.toHaveBeenCalled();expect(measure).not.toHaveBeenCalled();expect(fault).not.toHaveBeenCalled();
  });
  it('uses a visible CPU interval without queuing skipped frames',async()=>{
    let now=0;const result=vi.fn(),infer=vi.fn(async(_bitmap:ImageBitmap,frame:{sequence:number;captureTimeMs:number})=>({sample:syntheticHandFrame(frame.captureTimeMs,frame.sequence),durationMs:2}));
    const pump=createInferencePump({bitmap:async()=>bitmap(),infer,now:()=>now,minIntervalMs:50,result,measurement:vi.fn(),fault:vi.fn()});
    for(let i=0;i<=10;i++){now=i*10;pump.submit({sequence:i,captureTimeMs:now});await flush();}
    expect(infer).toHaveBeenCalledTimes(3);expect(result).toHaveBeenCalledTimes(3);pump.close();
  });
  it('maps absent/malformed/nonfinite model output explicitly and keeps image/world data separate',()=>{
    const f=syntheticHandFrame(1,0),result={landmarks:[f.imageLandmarks],worldLandmarks:[f.worldLandmarks],handedness:[[{categoryName:'Right',score:.9,index:0,displayName:''}]]};
    expect(modelSample({...result,landmarks:[f.imageLandmarks.map(p=>({...p,visibility:0,presence:0}))]},0,1)).toEqual({...f,handedness:{label:'Right',confidence:.9}});
    expect(modelSample({...result,landmarks:[]},1,2)).toMatchObject({validity:'absent',reason:'no_hand'});
    expect(modelSample({...result,worldLandmarks:[]},1,2)).toMatchObject({validity:'invalid'});
    expect(modelSample({...result,landmarks:[f.imageLandmarks.map(p=>({...p,x:NaN}))]},1,2)).toMatchObject({validity:'invalid'});
  });
  it('reports independent render/inference rates and includes discarded-result ages in rolling p95',()=>{
    let now=0;const m=createLiveMeasurements(()=>now);
    for(let i=0;i<60;i++){now=i*1000/60;m.render(now);if(i%2===0)m.inference(8,i===58?200:20);}
    now=1000;expect(m.read()).toMatchObject({renderFps:60,inferenceFps:30,inferenceDurationMs:8,resultAgeMs:200,p95ResultAgeMs:20,measuredResults:30});
    now=62000;expect(m.read()).toMatchObject({renderFps:0,inferenceFps:0,resultAgeMs:null,p95ResultAgeMs:null,measuredResults:0});
  });
});
