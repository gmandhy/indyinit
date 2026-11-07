import { describe,it,expect } from 'vitest';
import { createAcousticDetector,createCoincidenceMatcher,estimateTimingCalibration } from '../acousticTap';
const v=(t:number,sequence=0,cycle=sequence)=>({sequence,cycle,captureTimeMs:t,observedAtMs:t+30});
const a=(t:number,sequence=0)=>({sequence,sampleTimeMs:t,rms:.2});
const matcher=(offset=0)=>createCoincidenceMatcher(offset,{startMs:100,endMs:15100});
function dsp(rate=48000,blocks=[128]){
  const d=createAcousticDetector(rate);let frame=0,block=0;
  function feed(ms:number,amplitude=0){const events=[];let remaining=Math.round(ms*rate/1000);while(remaining){const n=Math.min(remaining,blocks[block++%blocks.length]!);events.push(...d.process(new Float32Array(n).fill(amplitude),frame));frame+=n;remaining-=n;}return events;}
  return {d,feed,frame:()=>frame};
}
describe('continuous acoustic DSP (synthetic PCM only)',()=>{
  it.each([8000,16000,44100,48000,96000])('uses actual sample rate %i and arbitrary blocks for rolling RMS and onset',rate=>{
    for(const blocks of [[128],[7,256,19,512]]){
      const s=dsp(rate,blocks);s.feed(1500);expect(s.d.getState().phase).toBe('ready');s.feed(23);
      const events=[...s.feed(3,.3),...s.feed(30)];expect(events).toHaveLength(1);
      expect(events[0]!.sampleTimeMs).toBeGreaterThanOrEqual(1523);expect(events[0]!.sampleTimeMs).toBeLessThan(1524);
      expect(events[0]!.rms).toBeCloseTo(.3*Math.sqrt(.3),2); // 3 ms within a 10 ms rolling window
    }
  });
  it('does not invent impulses in silence or quiet noise; adapts by elapsed time excluding impulses',()=>{
    const s=dsp();s.feed(1500,.005);const baseline=s.d.getState().noiseRms;
    expect(s.feed(1000,.006)).toEqual([]);expect(s.d.getState().noiseRms).toBeGreaterThan(baseline);
    s.feed(3,.3);const before=s.d.getState().noiseRms;s.feed(20);expect(s.d.getState().noiseRms).toBe(before);
    expect(s.d.getState().thresholdRms).toBe(.04);
  });
  it('requires release and refractory; sustained sound produces one event, no chatter',()=>{
    const s=dsp();s.feed(1500);expect(s.feed(500,.2)).toHaveLength(1);expect(s.feed(500,.2)).toEqual([]);
    s.feed(20);expect([...s.feed(3,.3),...s.feed(20)]).toHaveLength(1);
    expect([...s.feed(3,.3),...s.feed(20)]).toHaveLength(0);
    s.feed(100);expect([...s.feed(3,.3),...s.feed(20)]).toHaveLength(1);
  });
  it('rejects clipping, noisy/impulsive background, discontinuities, invalid lengths/time/nonfinite/full scale',()=>{
    const clipped=dsp();clipped.feed(1,1);expect(clipped.d.getState()).toMatchObject({phase:'failed',reason:expect.stringContaining('clipped')});
    const noisy=dsp();noisy.feed(1500,.1);expect(noisy.d.getState().phase).toBe('failed');
    const transient=dsp();transient.feed(500);transient.feed(10,.3);transient.feed(990);expect(transient.d.getState().phase).toBe('failed');
    const d=createAcousticDetector(48000);for(const samples of [new Float32Array(),new Float32Array([NaN]),new Float32Array([Infinity]),new Float32Array([1.1])])expect(()=>d.process(samples,0)).toThrow();
    expect(()=>d.process(new Float32Array(1),-.1)).toThrow();d.process(new Float32Array(1),0);expect(()=>d.process(new Float32Array(1),2)).toThrow();
    expect(()=>createAcousticDetector(0)).toThrow();expect(()=>createAcousticDetector(NaN)).toThrow();expect(()=>createAcousticDetector(48000,{releaseRatio:1})).toThrow();
  });
  it('a new owner resets calibration, sample clock and sequence',()=>{const s=dsp();s.feed(1500);s.feed(3,.3);expect(dsp().d.getState().phase).toBe('calibrating');});
});
describe('bounded symmetric temporal coincidence',()=>{
  it.each(['audio','visual'] as const)('matches nearest in %s-first arrival order with calibrated offset',first=>{
    const m=matcher(30);if(first==='audio'){expect(m.audio(a(1030),1050)).toBeNull();expect(m.visual(v(1000),1060)).toMatchObject({deltaMs:0});}
    else{expect(m.visual(v(1000),1050)).toBeNull();expect(m.audio(a(1030),1060)).toMatchObject({deltaMs:0});}
    expect(m.pending()).toEqual({visual:0,audio:0});
  });
  it('includes 80 ms tolerance / 250 ms lateness boundaries, independently; rejects stale and future',()=>{
    let m=matcher();m.visual(v(1000),1100);expect(m.audio(a(1080),1250)).not.toBeNull();
    m=matcher();m.visual(v(1000),1100);expect(m.audio(a(1080.001),1250)).toBeNull();
    m=matcher();m.visual(v(1000),1250);expect(m.audio(a(1000),1250)).not.toBeNull();
    m=matcher();expect(m.visual(v(1000),1250.001)).toBeNull();expect(m.audio(a(1000),1250.001)).toBeNull();expect(m.pending()).toEqual({visual:0,audio:0});
    expect(m.audio(a(1400,1),1300)).toBeNull();
  });
  it('retains an on-time counterpart through the tolerance horizon while rejecting new deliveries over 250 ms late',()=>{
    const m=matcher();m.visual(v(1000),1030);expect(m.audio(a(1080),1330)).toMatchObject({deltaMs:80});
    const n=matcher();n.audio(a(1080),1100);expect(n.visual(v(1000),1250)).toMatchObject({deltaMs:80});
    const o=matcher();o.visual(v(1000),1030);o.audio(a(1080),1330.001);expect(o.pending().audio).toBe(0);
  });
  it('handles out of capture order, nearest distance and deterministic ties',()=>{
    const m=matcher();m.audio(a(1100,2),1100);m.audio(a(1000,3),1100);m.audio(a(1020,1),1100);
    expect(m.visual(v(1010),1110)?.audio.sequence).toBe(3); // equal distance: earliest capture
    const n=matcher();n.audio(a(1000,4),1000);n.audio(a(1000,2),1000);expect(n.visual(v(1000),1030)?.audio.sequence).toBe(2);
  });
  it('consumes source IDs and a contact cycle once, even with altered duplicate timestamps',()=>{
    const m=matcher();m.audio(a(1000),1000);expect(m.visual(v(1000),1030)).not.toBeNull();
    m.audio(a(1040),1040);expect(m.visual(v(1040,1,0),1070)).toBeNull();
    expect(m.visual(v(1040,0,2),1070)).toBeNull();expect(m.pending()).toEqual({visual:0,audio:0});
  });
  it('expires unmatched events, bounds queues, fails closed on dedup exhaustion and resets owners',()=>{
    const m=createCoincidenceMatcher(0,{startMs:0,endMs:10000},{maxQueue:2,maxSeen:4});
    for(let i=0;i<3;i++)m.audio(a(1000+i,i),1002);expect(m.pending().audio).toBe(2);
    m.advance(1333);expect(m.pending().audio).toBe(0);m.audio(a(1400,3),1400);
    expect(()=>m.audio(a(1401,4),1401)).toThrow(/capacity/);m.reset();expect(m.audio(a(1402,5),1402)).toBeNull();
    const n=matcher();n.visual(v(1000),1030);n.reset();expect(n.audio(a(1000),1040)).toBeNull();
  });
  it('enforces both raw/corrected trial capture windows including exclusive end and bounded completion grace',()=>{
    const m=matcher();m.visual(v(15099),15129);expect(m.audio(a(15099),15349)).not.toBeNull();
    const n=matcher();n.visual(v(15100),15130);n.audio(a(15100),15130);n.visual(v(99,1),15130);expect(n.pending()).toEqual({visual:0,audio:0});
    const o=matcher(30);expect(o.audio(a(110),110)).toBeNull();expect(o.pending().audio).toBe(0);
  });
  it('rejects malformed finite/time/config values and backward delivery clocks',()=>{
    expect(()=>matcher(NaN)).toThrow();expect(()=>createCoincidenceMatcher(0,{startMs:2,endMs:1})).toThrow();
    const m=matcher();expect(()=>m.audio(a(NaN),1000)).toThrow();expect(()=>m.audio({...a(1000),rms:Infinity},1000)).toThrow();expect(()=>m.visual(v(1000,0,-1),1030)).toThrow();m.advance(2000);expect(()=>m.advance(1999)).toThrow();
  });
});
describe('spaced guided timing calibration',()=>{
  it('uses audio-minus-visual median and maximum absolute residual, never assumes zero',()=>{
    expect(estimateTimingCalibration([20,30,25].map((d,i)=>({visualTimeMs:1000+i*1000,audioTimeMs:1000+i*1000+d})))).toEqual({offsetMs:25,residualSpreadMs:5});
  });
  it('rejects missing pairs, close taps, nonfinite, excessive offset and residual uncertainty',()=>{
    for(const offsets of [[0,1],[0,0,100],[1100,1100,1100],[NaN,0,0]])expect(()=>estimateTimingCalibration(offsets.map((d,i)=>({visualTimeMs:1000+i*1000,audioTimeMs:1000+i*1000+d})))).toThrow();
    expect(()=>estimateTimingCalibration([0,1,2].map(i=>({visualTimeMs:1000+i*500,audioTimeMs:1000+i*500})))).toThrow(/Space/);
  });
});
