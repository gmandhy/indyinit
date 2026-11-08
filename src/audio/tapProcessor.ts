import { createAcousticDetector } from '../lib/acousticTap';
import { AUDIO_CONFIG } from '../lib/config';
import type { TapProcessorCommand, TapProcessorMessage } from './tapProtocol';
// Ambient AudioWorklet APIs absent from lib.dom. Checked by the application tsconfig.
declare const sampleRate:number;
declare const currentFrame:number;
declare class AudioWorkletProcessor { readonly port:MessagePort; constructor(options?:unknown) }
declare function registerProcessor(name:string,processor:typeof AudioWorkletProcessor):void;
class TapProcessor extends AudioWorkletProcessor {
  private detector=createAcousticDetector(sampleRate);
  private epoch=0;
  private lastMeter=-Infinity;
  private failed=false;
  private nextFrame:number|null=null;
  constructor(){super();this.port.onmessage=(e:MessageEvent<TapProcessorCommand>)=>{
    if(e.data.type==='reset'&&Number.isSafeInteger(e.data.epoch)&&e.data.epoch>=0){this.epoch=e.data.epoch;this.detector=createAcousticDetector(sampleRate);this.failed=false;this.nextFrame=null;this.lastMeter=-Infinity;}
  };}
  private post(message:TapProcessorMessage){this.port.postMessage(message);}
  process(inputs:Float32Array[][],outputs:Float32Array[][]):boolean {
    for(const output of outputs)for(const channel of output)channel.fill(0); // connected graph, always silent
    if(this.failed)return true;
    const input=inputs[0]?.[0];
    try{
      if(!input?.length)throw new Error('missing_input: microphone supplied no samples');
      // The browser may skip render quanta while attaching a newly started input.
      // Restart the full quiet interval during startup; a gap after readiness still fails.
      if(this.nextFrame!==null&&currentFrame!==this.nextFrame&&this.detector.getState().phase==='calibrating'){
        this.detector=createAcousticDetector(sampleRate);this.lastMeter=-Infinity;
      }
      this.nextFrame=currentFrame+input.length;
      for(const impulse of this.detector.process(input,currentFrame))this.post({type:'impulse',epoch:this.epoch,impulse});
      const status=this.detector.getState(),sampleTimeMs=(currentFrame+input.length)/sampleRate*1000;
      if(status.phase==='failed')throw new Error(status.reason);
      if(sampleTimeMs-this.lastMeter>=AUDIO_CONFIG.meterIntervalMs){this.lastMeter=sampleTimeMs;this.post({type:'level',epoch:this.epoch,sampleTimeMs,blockFrames:input.length,status});}
    }catch(error){this.failed=true;this.post({type:'error',epoch:this.epoch,message:error instanceof Error?error.message:'Audio processing failed'});}
    return true;
  }
}
registerProcessor('itap-tap',TapProcessor);
