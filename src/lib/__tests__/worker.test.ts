import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackingWorkerRequest } from '../../adapters/visionProtocol';
const sdk=vi.hoisted(()=>({files:vi.fn(),create:vi.fn()}));
vi.mock('@mediapipe/tasks-vision',()=>({FilesetResolver:{forVisionTasks:sdk.files},HandLandmarker:{createFromOptions:sdk.create}}));
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const image=()=>({close:vi.fn()}) as unknown as ImageBitmap;
function model(){return {close:vi.fn(),detectForVideo:vi.fn(()=>({landmarks:[],worldLandmarks:[],handedness:[]}))};}
let post:ReturnType<typeof vi.fn>,closed:ReturnType<typeof vi.fn>;
async function send(data:TrackingWorkerRequest){
  (globalThis as unknown as {onmessage(e:MessageEvent<TrackingWorkerRequest>):void}).onmessage({data} as MessageEvent<TrackingWorkerRequest>);await flush();
}
beforeEach(async()=>{
  vi.resetModules();sdk.create.mockReset();sdk.files.mockReset().mockResolvedValue({});
  post=vi.fn();closed=vi.fn();vi.stubGlobal('postMessage',post);vi.stubGlobal('close',closed);vi.stubGlobal('onmessage',null);
  vi.stubGlobal('OffscreenCanvas',class {constructor(public width:number,public height:number){}});
  await import('../../workers/handTracking.worker');
});
afterEach(()=>vi.unstubAllGlobals());
describe('worker delegate/bitmap lifecycle',()=>{
  it('proves GPU bitmap inference and closes every received bitmap/model on frame and dispose',async()=>{
    const m=model();sdk.create.mockResolvedValue(m);await send({type:'init',origin:'http://localhost'});
    expect(sdk.files).toHaveBeenCalledWith('http://localhost/mediapipe/wasm',true);expect(post).toHaveBeenLastCalledWith({type:'initialized'});
    const probe=image();await send({type:'probe',bitmap:probe});expect(m.detectForVideo).toHaveBeenCalledWith(probe,0);expect(probe.close).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({type:'ready',delegate:'GPU',fallbackReason:null}));
    const frame=image();await send({type:'frame',bitmap:frame,sequence:1,captureTimeMs:20});expect(frame.close).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({type:'sample',sample:expect.objectContaining({sequence:1,captureTimeMs:20,validity:'absent'})}));
    await send({type:'dispose'});expect(m.close).toHaveBeenCalledTimes(1);expect(closed).toHaveBeenCalledTimes(1);
  });
  it('makes GPU initialization and bitmap-probe CPU fallbacks explicit',async()=>{
    const cpu=model();sdk.create.mockRejectedValueOnce(new Error('No GPU')).mockResolvedValue(cpu);
    await send({type:'init',origin:'http://localhost'});const probe=image();await send({type:'probe',bitmap:probe});
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({type:'ready',delegate:'CPU',fallbackReason:expect.stringMatching(/GPU initialization failed: No GPU/)}));
    await send({type:'dispose'});
  });
  it('retries a failed GPU bitmap probe on CPU, releases the GPU model, and closes failed frames',async()=>{
    const gpu=model(),cpu=model();gpu.detectForVideo.mockImplementation(()=>{throw new Error('Bitmap unsupported');});
    sdk.create.mockResolvedValueOnce(gpu).mockResolvedValueOnce(cpu);await send({type:'init',origin:'http://localhost'});
    const probe=image();await send({type:'probe',bitmap:probe});expect(gpu.close).toHaveBeenCalledTimes(1);expect(probe.close).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({delegate:'CPU',fallbackReason:expect.stringMatching(/GPU bitmap probe failed/)}));
    cpu.detectForVideo.mockImplementation(()=>{throw new Error('Device lost');});const frame=image();await send({type:'frame',sequence:1,captureTimeMs:20,bitmap:frame});
    expect(frame.close).toHaveBeenCalledTimes(1);expect(cpu.close).toHaveBeenCalledTimes(1);expect(post).toHaveBeenLastCalledWith(expect.objectContaining({type:'error',message:expect.stringMatching(/Device lost/)}));
  });
  it('closes a landmarker resolving after disposal without publishing readiness',async()=>{
    let resolve!:(m:ReturnType<typeof model>)=>void;sdk.create.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    await send({type:'init',origin:'http://localhost'});await send({type:'dispose'});const late=model();resolve(late);await flush();
    expect(late.close).toHaveBeenCalledTimes(1);expect(post).not.toHaveBeenCalledWith({type:'initialized'});
  });
});
