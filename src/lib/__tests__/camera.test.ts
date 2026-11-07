import { describe, expect, it, vi } from 'vitest';
import { createCamera, scheduleCameraFrames } from '../../adapters/camera';
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {resolve,promise}; }
class FakeVideo extends EventTarget {
  muted=false;playsInline=false;srcObject:MediaStream|null=null;videoWidth=640;videoHeight=480;readyState=2;currentTime=0;
  play=vi.fn(async()=>{});pause=vi.fn();load=vi.fn();removeAttribute=vi.fn();
}
function media() {
  const track=Object.assign(new EventTarget(),{stop:vi.fn()});
  const stream={getTracks:()=>[track]};return {track,stream:stream as unknown as MediaStream};
}
describe('camera ownership and capture clock',()=>{
  it('acquires video independently, disposes tracks/listeners/video, and reports device events',async()=>{
    const video=new FakeVideo(),m=media(),fault=vi.fn(),getUserMedia=vi.fn(async()=>m.stream);
    const camera=createCamera(fault,{video:()=>video as unknown as HTMLVideoElement,getUserMedia});
    await camera.open(new AbortController().signal);
    expect(getUserMedia).toHaveBeenCalledWith({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:30}},audio:false});
    expect(video.srcObject).toBe(m.stream);m.track.dispatchEvent(new Event('ended'));expect(fault).toHaveBeenCalledWith(expect.stringMatching(/ended/));
    video.videoWidth=1280;video.dispatchEvent(new Event('resize'));expect(fault).toHaveBeenCalledWith(expect.stringMatching(/dimensions changed/));
    camera.close();camera.close();expect(m.track.stop).toHaveBeenCalledTimes(1);expect(video.srcObject).toBeNull();
    fault.mockClear();m.track.dispatchEvent(new Event('ended'));video.dispatchEvent(new Event('resize'));expect(fault).not.toHaveBeenCalled();
  });
  it('releases a permission grant arriving after stop/unmount, including during play()',async()=>{
    for(const point of ['permission','play'] as const){
      const video=new FakeVideo(),m=media(),permission=deferred<MediaStream>(),playing=deferred<void>(),abort=new AbortController();
      if(point==='play')video.play=vi.fn(()=>playing.promise);
      const camera=createCamera(vi.fn(),{video:()=>video as unknown as HTMLVideoElement,getUserMedia:()=>permission.promise});
      const output=camera.open(abort.signal).catch(error=>error);
      if(point==='play'){permission.resolve(m.stream);await Promise.resolve();}
      abort.abort();permission.resolve(m.stream);playing.resolve();expect(await output).toBeInstanceOf(Error);
      expect(m.track.stop).toHaveBeenCalledTimes(1);expect(video.srcObject).toBeNull();
    }
  });
  it('keeps permission errors actionable',async()=>{
    const camera=createCamera(vi.fn(),{video:()=>new FakeVideo() as unknown as HTMLVideoElement,getUserMedia:async()=>{throw new DOMException('denied','NotAllowedError');}});
    await expect(camera.open(new AbortController().signal)).rejects.toThrow(/permission denied.*Allow camera/);
  });
  it('deduplicates rAF frames by media time and cancels its only callback',()=>{
    const video=new FakeVideo(),result=vi.fn(),clock=vi.fn();let fn:FrameRequestCallback=()=>{},time=10;
    const raf=vi.fn((cb:FrameRequestCallback)=>{fn=cb;return 7;}),cancel=vi.fn();
    const stop=scheduleCameraFrames(video as unknown as HTMLVideoElement,result,clock,()=>time,raf,cancel);
    fn(10);time=11;fn(11);video.currentTime=.033;time=43;fn(43);
    expect(result.mock.calls.map(([f])=>f)).toEqual([{sequence:0,captureTimeMs:10},{sequence:1,captureTimeMs:43}]);
    expect(clock).toHaveBeenLastCalledWith('observed_currentTime');stop();stop();expect(cancel).toHaveBeenCalledTimes(1);fn(50);expect(result).toHaveBeenCalledTimes(2);
  });
  it('preserves rVFC capture metadata and uses an explicit presentation proxy when unavailable',()=>{
    const video=new FakeVideo();let fn:VideoFrameRequestCallback=()=>{};
    const request=vi.fn((cb:VideoFrameRequestCallback)=>{fn=cb;return 8;}),cancel=vi.fn();
    const v=Object.assign(video,{requestVideoFrameCallback:request,cancelVideoFrameCallback:cancel}) as unknown as HTMLVideoElement;
    const result=vi.fn(),clock=vi.fn();let time=100;
    const stop=scheduleCameraFrames(v,result,clock,()=>time,vi.fn(),vi.fn());
    fn(100,{captureTime:75,mediaTime:1,presentationTime:95} as VideoFrameCallbackMetadata);
    fn(100,{captureTime:75,mediaTime:1,presentationTime:95} as VideoFrameCallbackMetadata);
    time=133;fn(133,{mediaTime:1.033,presentationTime:130} as VideoFrameCallbackMetadata);
    expect(result.mock.calls.map(([f])=>f)).toEqual([{sequence:0,captureTimeMs:75},{sequence:1,captureTimeMs:130}]);
    expect(clock.mock.calls).toEqual([['captureTime'],['presentationTime']]);stop();expect(cancel).toHaveBeenCalledWith(8);
  });
});
