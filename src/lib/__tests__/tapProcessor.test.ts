import { it,expect,vi } from 'vitest';
import type { TapProcessorMessage } from '../../audio/tapProtocol';
it('runs the actual worklet with silent outputs, compact messages, throttled meters, variable blocks and explicit missing/clipped failures',async()=>{
  const messages:TapProcessorMessage[]=[];
  const port={onmessage:null as ((event:{data:unknown})=>void)|null,postMessage:(message:TapProcessorMessage)=>messages.push(message)};
  let Processor!:new()=>{process:(inputs:Float32Array[][],outputs:Float32Array[][])=>boolean};
  vi.stubGlobal('sampleRate',16000);vi.stubGlobal('currentFrame',0);
  vi.stubGlobal('AudioWorkletProcessor',class {port=port;});
  vi.stubGlobal('registerProcessor',(name:string,constructor:typeof Processor)=>{expect(name).toBe('itap-tap');Processor=constructor;});
  try{
    await import('../../audio/tapProcessor');const processor=new Processor();let frame=0;
    function feed(n:number,amplitude=0){vi.stubGlobal('currentFrame',frame);const out=new Float32Array(n).fill(1);expect(processor.process([[new Float32Array(n).fill(amplitude)]],[[out]])).toBe(true);expect(out.every(v=>v===0)).toBe(true);frame+=n;}
    feed(128);frame+=256;feed(128); // startup input gap restarts the quiet interval
    expect(messages.filter(m=>m.type==='error')).toHaveLength(0);
    for(let i=0;i<250;i++)feed(i%2?64:128); // 1.5 seconds of continuous quiet

    expect(messages.filter(m=>m.type==='level').length).toBeLessThanOrEqual(17);
    feed(48,.3);feed(512);expect(messages.filter(m=>m.type==='impulse')).toHaveLength(1);
    expect(messages.every(m=>!JSON.stringify(m).includes('samples'))).toBe(true);
    frame+=128;feed(128); // once ready, a lost quantum must invalidate capture
    expect(messages.at(-1)).toMatchObject({type:'error',message:expect.stringContaining('Discontinuous')});
    port.onmessage?.({data:{type:'reset',epoch:2}});processor.process([],[[new Float32Array(16).fill(1)]]);
    expect(messages.at(-1)).toMatchObject({type:'error',epoch:2,message:expect.stringContaining('missing_input')});
    port.onmessage?.({data:{type:'reset',epoch:3}});feed(16,1);expect(messages.at(-1)).toMatchObject({type:'error',epoch:3,message:expect.stringContaining('clipped')});
  }finally{vi.unstubAllGlobals();}
});
