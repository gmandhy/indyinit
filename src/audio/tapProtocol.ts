import type { AudioImpulse } from '../lib/schemas';
import type { AcousticStatus } from '../lib/acousticTap';
/** Only compact scalar messages leave the audio thread. No PCM/transfer buffers. */
export type TapProcessorMessage = { type:'impulse'; epoch:number; impulse:AudioImpulse }
  | { type:'level'; epoch:number; sampleTimeMs:number; blockFrames:number; status:AcousticStatus }
  | { type:'error'; epoch:number; message:string };
export type TapProcessorCommand = { type:'reset'; epoch:number };
