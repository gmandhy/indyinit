import type { AdapterEvent } from '../src/engine/contracts';
/** Explicit synthetic onset offset; no inferred hardware success. Both arrival orders plus
 * unmatched motion/noise exercise the same matcher, independently of air-target scoring. */
export const SYNTHETIC_AUDIO_OFFSET_MS=25;
export function syntheticDiagnosticEvents(relativeMs:number,anchor:number):AdapterEvent[] {
  if(relativeMs<4000||relativeMs%1000!==0)return [];
  const sequence=relativeMs/1000,contact=anchor+relativeMs-50;
  const visual:AdapterEvent={type:'visual',candidate:{sequence,cycle:sequence,captureTimeMs:contact,observedAtMs:anchor+relativeMs}};
  const audio:AdapterEvent={type:'audio',impulse:{sequence,sampleTimeMs:contact+SYNTHETIC_AUDIO_OFFSET_MS,rms:.2}};
  switch(sequence%4){case 0:return [audio,visual];case 1:return [visual,audio];case 2:return [visual];default:return [audio];}
}
