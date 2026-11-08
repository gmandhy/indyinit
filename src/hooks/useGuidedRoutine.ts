import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { FrameBuffer } from '../engine/contracts';
import type { FrameSample } from '../lib/schemas';
import { createGuidedRoutine } from '../lib/guidedRoutine';
import { FRAME_CONFIG } from '../lib/config';
import { MathInputError } from '../lib/mathValidation';

/** Score capture samples at delivery; publish only the display at 10 Hz. */
export function useGuidedRoutine(task:number,paused:boolean,frameBuffer:RefObject<FrameBuffer>,active:boolean) {
  const [engine]=useState(()=>createGuidedRoutine(task));
  const [state,setState]=useState(engine.getState);
  useEffect(()=>{
    let lastArrival=-Infinity;
    const receive=(sample:FrameSample)=>{
      if(!active||paused||document.hidden)return;
      lastArrival=performance.now();
      try {engine.observe(sample,lastArrival,frameBuffer.current.video??{width:640,height:480});}
      catch(error){if(!(error instanceof MathInputError))throw error;engine.suspend('Adjust your hand');}
    };
    const publish=()=>{
      if(!active)engine.suspend('Start camera');
      else if(paused||document.hidden)engine.suspend('Paused');
      else if(performance.now()-lastArrival>FRAME_CONFIG.maxGapMs)engine.suspend('Show your hand');
      setState(engine.getState());
    };
    const unsubscribe=frameBuffer.current.subscribeFrames?.(receive);
    publish();const timer=setInterval(publish,100);
    return ()=>{clearInterval(timer);unsubscribe?.();};
  },[engine,paused,frameBuffer,active]);
  return state;
}
