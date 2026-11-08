import { describe,it,expect,vi } from 'vitest';
import { createAudioAdapter } from '../../adapters/audio';
import type { AudioEnvironment,AudioEvent } from '../../adapters/audio';
function harness(){
  let time=1000;
  const track={stop:vi.fn(),getSettings:()=>({sampleRate:44100,channelCount:1,echoCancellation:true,deviceId:'never-display'}),addEventListener:vi.fn(),removeEventListener:vi.fn()};
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  const source={connect:vi.fn(),disconnect:vi.fn()};
  const node={port:{onmessage:null as ((e:unknown)=>void)|null,postMessage:vi.fn(),close:vi.fn()},connect:vi.fn(),disconnect:vi.fn(),onprocessorerror:null as (()=>void)|null};
  const context={state:'running',currentTime:.5,sampleRate:44100,resume:vi.fn(async()=>{}),close:vi.fn(async()=>{}),audioWorklet:{addModule:vi.fn(async()=>{})},createMediaStreamSource:vi.fn(()=>source),destination:{},onstatechange:null as (()=>void)|null};
  const media={getUserMedia:vi.fn(async()=>stream),getSupportedConstraints:()=>({echoCancellation:true,noiseSuppression:true,autoGainControl:true}),addEventListener:vi.fn(),removeEventListener:vi.fn()};
  const env={now:()=>time,secure:()=>true,media,context:()=>context,node:()=>node} as unknown as AudioEnvironment;
  const adapter=createAudioAdapter(env),events:AudioEvent[]=[];
  const epoch=()=>node.port.postMessage.mock.calls.at(-1)![0].epoch as number;
  const message=(data:object)=>node.port.onmessage?.({data:{epoch:epoch(),...data}});
  return {adapter,env,context,node,track,media,source,events,epoch,message,setTime:(t:number)=>{time=t;}};
}
describe('owned microphone capture lifecycle (fake devices, no hardware evidence)',()=>{
  it('resumes synchronously before permission, requests audio separately, inspects actual supported settings, maps sample clock and ignores old epochs',async()=>{
    const h=harness(),pending=h.adapter.start(e=>h.events.push(e));
    expect(h.context.resume).toHaveBeenCalledTimes(1);expect(h.media.getUserMedia).toHaveBeenCalledWith({video:false,audio:{channelCount:{ideal:1},echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    await pending;expect(h.adapter.getDiagnostics()).toMatchObject({state:'calibrating',sampleRate:44100,clock:{audioTimeSeconds:.5,sessionTimeMs:1000}});
    expect(h.adapter.getDiagnostics().settings).toContain('"echoCancellation":true');expect(h.adapter.getDiagnostics().settings).not.toContain('never-display');
    h.message({type:'level',blockFrames:128,status:{phase:'ready',reason:'Quiet',rms:0,noiseRms:0,thresholdRms:.04,elapsedMs:1500}});
    h.setTime(1100);h.message({type:'impulse',impulse:{sequence:0,sampleTimeMs:550,rms:.2}});
    expect(h.events.at(-1)).toEqual({type:'audio',impulse:{sequence:0,sampleTimeMs:1050,rms:.2}});
    const old=h.epoch();h.adapter.reset();const n=h.events.length;h.node.port.onmessage?.({data:{type:'impulse',epoch:old,impulse:{sequence:1,sampleTimeMs:600,rms:.2}}});expect(h.events).toHaveLength(n);
    h.adapter.stop();expect(h.track.stop).toHaveBeenCalledTimes(1);expect(h.node.disconnect).toHaveBeenCalled();expect(h.source.disconnect).toHaveBeenCalled();expect(h.node.port.close).toHaveBeenCalled();expect(h.context.close).toHaveBeenCalled();
    expect(h.media.removeEventListener).toHaveBeenCalledWith('devicechange',expect.any(Function));h.adapter.dispose();
  });
  it('lets startup clocks settle during quiet calibration, then freezes the ready mapping',async()=>{
    const h=harness();await h.adapter.start(e=>h.events.push(e));
    h.setTime(1200);h.context.currentTime=.51;
    h.message({type:'level',blockFrames:128,status:{phase:'calibrating',reason:'Quiet'}});
    expect(h.adapter.getDiagnostics()).toMatchObject({state:'calibrating',clock:{audioTimeSeconds:.51,sessionTimeMs:1200}});
    h.setTime(2700);h.context.currentTime=2;
    h.message({type:'level',blockFrames:128,status:{phase:'ready',reason:'Ready'}});
    const anchor=h.adapter.getDiagnostics().clock;
    h.setTime(2800);h.context.currentTime=2.1;
    h.message({type:'level',blockFrames:128,status:{phase:'ready',reason:'Ready'}});
    expect(h.adapter.getDiagnostics().clock).toEqual(anchor);
    h.message({type:'impulse',impulse:{sequence:0,sampleTimeMs:2050,rms:.2}});
    expect(h.events.at(-1)).toEqual({type:'audio',impulse:{sequence:0,sampleTimeMs:2750,rms:.2}});
    h.adapter.dispose();
  });
  it('closes a context immediately and stops late permission tracks after stop/dispose/restart',async()=>{
    for(const action of ['stop','dispose'] as const){
      const h=harness();let resolve!:(stream:unknown)=>void;
      h.media.getUserMedia.mockImplementation(()=>new Promise(r=>{resolve=r;}) as never);
      const p=h.adapter.start(()=>{});h.adapter[action]();expect(h.context.close).toHaveBeenCalled();
      resolve({getTracks:()=>[h.track],getAudioTracks:()=>[h.track]});await p;expect(h.track.stop).toHaveBeenCalledTimes(1);expect(h.context.audioWorklet.addModule).not.toHaveBeenCalled();
    }
  });
  it('releases a granted stream even while resume remains pending, and handles synchronous permission throws',async()=>{
    const h=harness();let resume!:()=>void;h.context.resume.mockImplementation(()=>new Promise<void>(r=>{resume=r;}));
    const p=h.adapter.start(()=>{});await Promise.resolve();h.adapter.stop();expect(h.track.stop).toHaveBeenCalledTimes(1);resume();await p;
    const n=harness();n.media.getUserMedia.mockImplementation(()=>{throw new Error('Synchronous device failure');});await n.adapter.start(()=>{});expect(n.adapter.getDiagnostics().state).toBe('unavailable');expect(n.context.close).toHaveBeenCalled();
  });
  it('handles permission/resume/module/processor errors without unhandled promises or surviving resources',async()=>{
    for(const failure of ['permission','resume','module','processor'] as const){
      const h=harness();if(failure==='permission')h.media.getUserMedia.mockRejectedValue(new DOMException('Denied','NotAllowedError'));
      if(failure==='resume')h.context.resume.mockRejectedValue(new Error('Resume failed'));
      if(failure==='module')h.context.audioWorklet.addModule.mockRejectedValue(new Error('Module failed'));
      await h.adapter.start(e=>h.events.push(e));if(failure==='processor')h.node.onprocessorerror?.();
      expect(h.adapter.getDiagnostics().state).toBe('unavailable');expect(h.context.close).toHaveBeenCalled();if(failure!=='permission')expect(h.track.stop).toHaveBeenCalled();
    }
  });
  it('invalidates capture on suspend, device change, track end, DSP calibration failure and clock discontinuity',async()=>{
    for(const failure of ['suspend','device','ended','dsp','clock'] as const){
      const h=harness();await h.adapter.start(e=>h.events.push(e));
      if(failure==='suspend'){h.context.state='suspended';h.context.onstatechange?.();}
      if(failure==='device')h.media.addEventListener.mock.calls[0]![1]();
      if(failure==='ended')h.track.addEventListener.mock.calls[0]![1]();
      if(failure==='dsp')h.message({type:'error',message:'noisy_calibration'});
      if(failure==='clock'){h.message({type:'level',blockFrames:128,status:{phase:'ready'}});h.setTime(1200);h.message({type:'level',sampleTimeMs:600,status:{phase:'ready'}});}
      expect(h.adapter.getDiagnostics()).toMatchObject({state:'unavailable',clock:null});expect(h.track.stop).toHaveBeenCalledTimes(1);expect(h.context.close).toHaveBeenCalled();
    }
  });
});
